from fastapi import FastAPI, HTTPException

from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import Optional
import uuid
import base64 as _base64
import os
import secrets
import hmac
import hashlib
import httpx as _httpx
from datetime import datetime, timedelta, timezone
from collections import Counter
from dotenv import load_dotenv
from supabase import create_client, Client
import bcrypt
import threading
from twilio.rest import Client as TwilioClient
from apscheduler.schedulers.background import BackgroundScheduler

load_dotenv()

_twilio = None
_twilio_from    = os.getenv("TWILIO_PHONE_NUMBER", "")
_twilio_wa_from = os.getenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")
_sid   = os.getenv("TWILIO_ACCOUNT_SID", "")
_token = os.getenv("TWILIO_AUTH_TOKEN", "")
if _sid and _token:
    _twilio = TwilioClient(_sid, _token)

import resend as _resend_lib
_resend_api_key = os.getenv("RESEND_API_KEY", "")
_reminder_from_email = os.getenv("REMINDER_FROM_EMAIL", "reminders@vivapetals.com")
if _resend_api_key:
    _resend_lib.api_key = _resend_api_key

app = FastAPI(title="VivaPetals API")

@app.get("/api/ping")
def ping():
    return {"status": "ok"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Supabase client ────────────────────────────────────────────────────────────
supabase: Client = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)

# ── Email config (Resend API) ──────────────────────────────────────────────────
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
APP_URL        = os.getenv("APP_URL", "http://localhost:4200")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")

def send_verification_email(to_email: str, first_name: str, token: str):
    if not RESEND_API_KEY:
        print(f"[Email] Resend not configured — skipping. Token: {token}", flush=True)
        return
    verify_url = f"{APP_URL}/verify-email?token={token}"
    html = f"""
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;background:#fdf0f5;font-family:'Segoe UI',Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:40px 16px;">
          <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(200,75,122,0.1);">
            <tr><td style="background:linear-gradient(135deg,#c84b7a,#9c2d55);padding:32px 40px;text-align:center;">
              <div style="font-size:2rem;">🌸</div>
              <div style="color:#fff;font-size:1.5rem;font-weight:800;margin-top:8px;letter-spacing:-0.03em;">VivaPetals</div>
            </td></tr>
            <tr><td style="padding:40px;">
              <h2 style="margin:0 0 12px;color:#1e1e1e;font-size:1.35rem;font-weight:800;">Hi {first_name}, verify your email</h2>
              <p style="color:#666;line-height:1.6;margin:0 0 28px;">Thanks for signing up! Click the button below to verify your email address and activate your account.</p>
              <div style="text-align:center;margin-bottom:28px;">
                <a href="{verify_url}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#c84b7a,#9c2d55);color:#fff;text-decoration:none;border-radius:999px;font-weight:700;font-size:1rem;box-shadow:0 4px 16px rgba(200,75,122,0.35);">Verify My Email</a>
              </div>
              <p style="color:#999;font-size:0.82rem;line-height:1.6;margin:0;">This link expires in <strong>24 hours</strong>. If you didn't create an account, you can ignore this email.</p>
              <hr style="border:none;border-top:1px solid #f0e0e8;margin:24px 0;">
              <p style="color:#bbb;font-size:0.75rem;margin:0;">Or copy this link: <span style="color:#c84b7a;">{verify_url}</span></p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
    """
    try:
        with _httpx.Client() as client:
            resp = client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
                json={"from": "VivaPetals <orderhere@vivapetals.com>", "to": [to_email], "subject": "Verify your VivaPetals email", "html": html},
                timeout=10
            )
        print(f"[Email] Resend response {resp.status_code}: {resp.text}", flush=True)
    except Exception as e:
        print(f"[Email] Failed to send verification email: {e}", flush=True)

# ── Password helpers ───────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

# ── Signed token store (survives server restarts) ─────────────────────────────
_TOKEN_SECRET = os.getenv("TOKEN_SECRET") or secrets.token_hex(32)

def create_token(email: str) -> str:
    sig = hmac.new(_TOKEN_SECRET.encode(), email.encode(), hashlib.sha256).hexdigest()
    payload = _base64.urlsafe_b64encode(email.encode()).decode()
    return f"{payload}.{sig}"

def verify_token(token: str) -> str | None:
    try:
        parts = token.split(".", 1)
        if len(parts) != 2:
            return None
        email = _base64.urlsafe_b64decode(parts[0].encode() + b"==").decode()
        expected = hmac.new(_TOKEN_SECRET.encode(), email.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(parts[1], expected):
            return None
        return email
    except Exception:
        return None

# fallback for old UUID tokens still in the wild
tokens: dict = {}

def resolve_token(token: str) -> str | None:
    return verify_token(token) or tokens.get(token)

# ── Loyalty helpers ────────────────────────────────────────────────────────────

def generate_referral_code() -> str:
    return "REF" + str(uuid.uuid4())[:6].upper()

def award_points(email: str, points: int, type: str, description: str, order_id: str = None):
    """Increment loyalty_accounts balance (and earned_total if positive), insert transaction row."""
    try:
        existing = supabase.table("loyalty_accounts").select("points_balance, points_earned_total").eq("user_email", email).execute()
        if existing.data:
            row = existing.data[0]
            new_balance = max(0, row["points_balance"] + points)
            new_earned = row["points_earned_total"] + (points if points > 0 else 0)
            supabase.table("loyalty_accounts").update({
                "points_balance": new_balance,
                "points_earned_total": new_earned
            }).eq("user_email", email).execute()
        else:
            new_balance = max(0, points)
            new_earned = points if points > 0 else 0
            ref_code = generate_referral_code()
            supabase.table("loyalty_accounts").insert({
                "user_email": email,
                "points_balance": new_balance,
                "points_earned_total": new_earned,
                "referral_code": ref_code
            }).execute()
        supabase.table("loyalty_transactions").insert({
            "user_email": email,
            "type": type,
            "points": points,
            "description": description,
            "order_id": order_id
        }).execute()
    except Exception as e:
        print(f"award_points error: {e}")

def create_loyalty_account(email: str, referred_by_code: str = None) -> str:
    """Create loyalty_accounts row, award welcome bonus, handle referral signup bonus."""
    # Skip if account already exists (prevents double-awarding on duplicate verify calls)
    existing = supabase.table("loyalty_accounts").select("referral_code").eq("user_email", email).execute()
    if existing.data:
        print(f"[Loyalty] Account already exists for {email} — skipping", flush=True)
        return existing.data[0]["referral_code"]

    ref_code = generate_referral_code()
    referrer_email = None

    if referred_by_code:
        referrer = supabase.table("loyalty_accounts").select("user_email").eq("referral_code", referred_by_code).execute()
        if referrer.data:
            referrer_email = referrer.data[0]["user_email"]
        else:
            print(f"[Loyalty] Referral code {referred_by_code} not found in loyalty_accounts", flush=True)

    try:
        supabase.table("loyalty_accounts").insert({
            "user_email": email,
            "points_balance": 0,
            "points_earned_total": 0,
            "referral_code": ref_code,
            "referred_by_code": referred_by_code if referrer_email else None
        }).execute()
    except Exception as e:
        print(f"[Loyalty] Failed to create account for {email}: {e}", flush=True)

    # Welcome bonus
    award_points(email, 100, "earned_welcome", "Welcome bonus for joining VivaPetals")

    # Referral signup bonus: 200 pts to referrer
    if referrer_email:
        print(f"[Loyalty] Awarding 200 referral pts to {referrer_email} for referring {email}", flush=True)
        award_points(referrer_email, 200, "earned_referral_signup", f"Referral signup bonus — {email} joined")

    return ref_code

def send_notifications(order_id: str, status: str, phone: str):
    if not phone or status not in STATUS_MESSAGES:
        return
    msg = STATUS_MESSAGES[status].format(order_id=order_id)
    for channel, from_num, to_num in [
        ("sms",      _twilio_from,    phone),
        ("whatsapp", _twilio_wa_from, f"whatsapp:{phone}"),
    ]:
        sent = False
        try:
            if _twilio and from_num:
                _twilio.messages.create(body=msg, from_=from_num, to=to_num)
                sent = True
        except Exception:
            pass
        try:
            supabase.table("order_notifications").insert({
                "order_id": order_id, "channel": channel,
                "status": status, "message": msg,
                "phone": phone, "sent": sent
            }).execute()
        except Exception:
            pass

# ── Reminder helpers ───────────────────────────────────────────────────────────

def build_reminder_email_html(order: dict, days_before: int, is_recurrence: bool = False) -> str:
    customer_name = order.get("customer_name", "")
    first_name = customer_name.split()[0] if customer_name else "there"
    timing = "tomorrow" if days_before == 1 else f"in {days_before} days"
    kind = "Anniversary" if is_recurrence else "Scheduled"
    dt_str = order.get("delivery_datetime", "")
    formatted_date = ""
    if dt_str:
        try:
            dt = datetime.strptime(dt_str[:10], "%Y-%m-%d")
            formatted_date = f"{dt.strftime('%b')} {dt.day}, {dt.year}"
        except Exception:
            formatted_date = dt_str[:10]
    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:2rem auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:#1a1a1a;padding:1.5rem 2rem;display:flex;align-items:center;gap:0.75rem;">
      <span style="font-size:1.4rem;">🌸</span>
      <span style="color:white;font-size:1.05rem;font-weight:700;letter-spacing:0.01em;">VivaPetals</span>
      <span style="color:#888;margin-left:0.5rem;font-size:0.85rem;">/ Delivery Reminder</span>
    </div>
    <div style="background:white;padding:2rem;">
      <h1 style="font-size:1.3rem;font-weight:700;color:#111;margin:0 0 0.5rem;">
        Hello {first_name}, your {kind} delivery is {timing}!
      </h1>
      <p style="color:#666;font-size:0.95rem;line-height:1.6;margin:0 0 1.5rem;">
        We're getting your flowers ready. Here's a summary of your upcoming delivery.
      </p>
      <div style="background:#f8f9fa;border:1px solid #e4e4e7;border-radius:10px;padding:1.25rem;margin-bottom:1.5rem;">
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:0.5rem;">Order Details</div>
        <div style="font-size:0.95rem;font-weight:700;color:#111;font-family:monospace;">{order.get("id", "")}</div>
        {"<div style='font-size:0.88rem;color:#555;margin-top:0.25rem;'>Delivery: " + formatted_date + "</div>" if formatted_date else ""}
      </div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:1.25rem;margin-bottom:1.5rem;">
        <div style="font-size:0.82rem;font-weight:700;color:#15803d;margin-bottom:0.5rem;">💡 Tips for your flowers</div>
        <ul style="margin:0;padding-left:1.25rem;color:#166534;font-size:0.85rem;line-height:1.8;">
          <li>Ensure someone is available to receive the delivery</li>
          <li>Trim stems at an angle before placing in water</li>
          <li>Have a clean vase and fresh water ready</li>
        </ul>
      </div>
      <p style="color:#aaa;font-size:0.78rem;margin:0;">
        Thank you for choosing VivaPetals 🌸<br>
        If you have questions, reply to this email or visit our website.
      </p>
    </div>
  </div>
</body>
</html>
"""

def build_order_confirmation_email_html(order: dict, items: list) -> str:
    customer_name = order.get("customer_name", "")
    first_name = customer_name.split()[0] if customer_name else "there"
    order_id = order.get("id", "")
    total = order.get("total", 0)
    delivery_type = order.get("delivery_type", "immediate")
    address = order.get("customer_address", "")
    payment = order.get("payment_method", "").replace("_", " ").title()

    delivery_dt_str = order.get("delivery_datetime", "")
    delivery_line = ""
    if delivery_type == "scheduled" and delivery_dt_str:
        try:
            dt = datetime.strptime(delivery_dt_str[:16], "%Y-%m-%dT%H:%M")
            delivery_line = f"<div style='font-size:0.88rem;color:#555;margin-top:0.25rem;'>Scheduled: {dt.strftime('%b %d, %Y at %I:%M %p')}</div>"
        except Exception:
            delivery_line = f"<div style='font-size:0.88rem;color:#555;margin-top:0.25rem;'>Scheduled: {delivery_dt_str}</div>"
    else:
        delivery_line = "<div style='font-size:0.88rem;color:#555;margin-top:0.25rem;'>Immediate delivery</div>"

    items_rows = "".join(
        f"<tr><td style='padding:0.4rem 0;font-size:0.9rem;color:#333;'>{it.get('name','')}</td>"
        f"<td style='padding:0.4rem 0;font-size:0.9rem;color:#333;text-align:center;'>{it.get('quantity',1)}</td>"
        f"<td style='padding:0.4rem 0;font-size:0.9rem;color:#333;text-align:right;'>₹{it.get('price',0):.2f}</td></tr>"
        for it in items
    )

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:2rem auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:#1a1a1a;padding:1.5rem 2rem;display:flex;align-items:center;gap:0.75rem;">
      <span style="font-size:1.4rem;">🌸</span>
      <span style="color:white;font-size:1.05rem;font-weight:700;letter-spacing:0.01em;">VivaPetals</span>
      <span style="color:#888;margin-left:0.5rem;font-size:0.85rem;">/ Order Confirmed</span>
    </div>
    <div style="background:white;padding:2rem;">
      <h1 style="font-size:1.3rem;font-weight:700;color:#111;margin:0 0 0.5rem;">
        Thank you, {first_name}! Your order is confirmed 🎉
      </h1>
      <p style="color:#666;font-size:0.95rem;line-height:1.6;margin:0 0 1.5rem;">
        We've received your order and will have your flowers ready soon.
      </p>
      <div style="background:#f8f9fa;border:1px solid #e4e4e7;border-radius:10px;padding:1.25rem;margin-bottom:1.25rem;">
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:0.5rem;">Order Details</div>
        <div style="font-size:0.95rem;font-weight:700;color:#111;font-family:monospace;">{order_id}</div>
        {delivery_line}
        {"<div style='font-size:0.88rem;color:#555;margin-top:0.25rem;'>Deliver to: " + address + "</div>" if address else ""}
        {"<div style='font-size:0.88rem;color:#555;margin-top:0.25rem;'>Payment: " + payment + "</div>" if payment else ""}
      </div>
      <div style="background:#f8f9fa;border:1px solid #e4e4e7;border-radius:10px;padding:1.25rem;margin-bottom:1.25rem;">
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:0.75rem;">Items Ordered</div>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="font-size:0.78rem;color:#888;text-align:left;padding-bottom:0.4rem;">Item</th>
              <th style="font-size:0.78rem;color:#888;text-align:center;padding-bottom:0.4rem;">Qty</th>
              <th style="font-size:0.78rem;color:#888;text-align:right;padding-bottom:0.4rem;">Price</th>
            </tr>
          </thead>
          <tbody>{items_rows}</tbody>
          <tfoot>
            <tr style="border-top:1px solid #e4e4e7;">
              <td colspan="2" style="padding-top:0.6rem;font-size:0.9rem;font-weight:700;color:#111;">Total</td>
              <td style="padding-top:0.6rem;font-size:0.9rem;font-weight:700;color:#111;text-align:right;">₹{total:.2f}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div style="text-align:center;margin:1.5rem 0;">
        <a href="{APP_URL}/track?id={order_id}"
           style="display:inline-block;padding:13px 36px;background:linear-gradient(135deg,#c84b7a,#9c2d55);color:#fff;text-decoration:none;border-radius:999px;font-weight:700;font-size:0.95rem;box-shadow:0 4px 16px rgba(200,75,122,0.35);letter-spacing:0.01em;">
          Track My Order
        </a>
      </div>
      <p style="color:#aaa;font-size:0.78rem;margin:0;">
        Thank you for choosing VivaPetals 🌸<br>
        If you have questions, reply to this email or visit our website.
      </p>
    </div>
  </div>
</body>
</html>"""


def send_order_confirmation_email(order: dict, items: list) -> bool:
    to_email = order.get("customer_email")
    if not RESEND_API_KEY or not to_email:
        print(f"[Email] Resend not configured or no email — skipping order confirmation for {to_email}", flush=True)
        return False
    try:
        with _httpx.Client() as client:
            resp = client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
                json={"from": "VivaPetals <orderhere@vivapetals.com>", "to": [to_email], "subject": f"Your VivaPetals Order {order.get('id', '')} is Confirmed! 🌸", "html": build_order_confirmation_email_html(order, items)},
                timeout=10
            )
        print(f"[Email] Order confirmation response {resp.status_code}: {resp.text}", flush=True)
        return resp.status_code in (200, 201)
    except Exception as e:
        print(f"[Email] Failed to send order confirmation: {e}", flush=True)
        return False


def build_order_cancellation_email_html(order: dict) -> str:
    customer_name = order.get("customer_name", "")
    first_name = customer_name.split()[0] if customer_name else "there"
    order_id = order.get("id", "")
    total = order.get("total", 0)

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:2rem auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:#1a1a1a;padding:1.5rem 2rem;display:flex;align-items:center;gap:0.75rem;">
      <span style="font-size:1.4rem;">🌸</span>
      <span style="color:white;font-size:1.05rem;font-weight:700;letter-spacing:0.01em;">VivaPetals</span>
      <span style="color:#888;margin-left:0.5rem;font-size:0.85rem;">/ Order Cancelled</span>
    </div>
    <div style="background:white;padding:2rem;">
      <h1 style="font-size:1.3rem;font-weight:700;color:#111;margin:0 0 0.5rem;">
        Hi {first_name}, your order has been cancelled.
      </h1>
      <p style="color:#666;font-size:0.95rem;line-height:1.6;margin:0 0 1.5rem;">
        Your order has been successfully cancelled. We're sorry to see it go!
        If this was a mistake or you need help, please contact us.
      </p>
      <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:10px;padding:1.25rem;margin-bottom:1.5rem;">
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:0.5rem;">Cancelled Order</div>
        <div style="font-size:0.95rem;font-weight:700;color:#111;font-family:monospace;">{order_id}</div>
        <div style="font-size:0.88rem;color:#555;margin-top:0.25rem;">Order Total: ₹{total:.2f}</div>
      </div>
      <p style="color:#aaa;font-size:0.78rem;margin:0;">
        Thank you for choosing VivaPetals 🌸<br>
        We hope to see you again soon!
      </p>
    </div>
  </div>
</body>
</html>"""


def send_order_cancellation_email(order: dict) -> bool:
    to_email = order.get("customer_email")
    if not RESEND_API_KEY or not to_email:
        return False
    try:
        with _httpx.Client() as client:
            resp = client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
                json={"from": "VivaPetals <orderhere@vivapetals.com>", "to": [to_email], "subject": f"Your VivaPetals Order {order.get('id', '')} Has Been Cancelled", "html": build_order_cancellation_email_html(order)},
                timeout=10
            )
        print(f"[Email] Cancellation email response {resp.status_code}: {resp.text}", flush=True)
        return resp.status_code in (200, 201)
    except Exception as e:
        print(f"[Email] Failed to send cancellation email: {e}", flush=True)
        return False


def send_email_reminder(order: dict, days_before: int, is_recurrence: bool = False) -> bool:
    if not _resend_api_key or not order.get("customer_email"):
        return False
    timing = "tomorrow" if days_before == 1 else f"in {days_before} days"
    kind = "Anniversary" if is_recurrence else "Scheduled"
    try:
        _resend_lib.Emails.send({
            "from": _reminder_from_email,
            "to": [order["customer_email"]],
            "subject": f"Your VivaPetals {kind} Delivery is {timing.title()}! 🌸",
            "html": build_reminder_email_html(order, days_before, is_recurrence),
        })
        return True
    except Exception:
        return False

def send_sms_whatsapp_reminder(order: dict, days_before: int, is_recurrence: bool = False) -> dict:
    result = {"sms": False, "whatsapp": False}
    if not _twilio or not order.get("customer_phone"):
        return result
    timing = "tomorrow" if days_before == 1 else f"in {days_before} days"
    kind = "Anniversary" if is_recurrence else "Scheduled"
    dt_str = order.get("delivery_datetime", "")
    formatted_date = ""
    if dt_str:
        try:
            dt = datetime.strptime(dt_str[:10], "%Y-%m-%d")
            formatted_date = f"{dt.strftime('%b')} {dt.day}, {dt.year}"
        except Exception:
            formatted_date = dt_str[:10]
    msg = (
        f"VivaPetals Reminder: Your {kind} flower delivery "
        f"(Order {order['id']}) arrives {timing}"
        + (f" on {formatted_date}" if formatted_date else "")
        + ". Please ensure someone is available."
    )
    phone = order["customer_phone"]
    for channel, from_num, to_num in [
        ("sms",      _twilio_from,    phone),
        ("whatsapp", _twilio_wa_from, f"whatsapp:{phone}"),
    ]:
        try:
            if from_num:
                _twilio.messages.create(body=msg, from_=from_num, to=to_num)
                result[channel] = True
        except Exception:
            pass
    return result

# ── Products ───────────────────────────────────────────────────────────────────
# Hardcoded seed list. Actual products live in the Supabase `products` table and
# are loaded into the in-memory PRODUCTS cache below (load_products). This seed is
# used to populate the table on first run, and as a fallback if the DB is
# unavailable so the storefront keeps working.
_SEED_PRODUCTS = [
    {"id": 1, "name": "Red Rose Bouquet", "description": "A stunning arrangement of 12 premium red roses, perfect for expressing love and romance.", "price": 49.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2022%2C%202026%2C%2010_49_55%20PM.png", "category": "Garlands", "inStock": True},
    {"id": 2, "name": "Sunflower Delight", "description": "Bright and cheerful sunflowers that bring warmth and happiness to any space.", "price": 34.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2022%2C%202026%2C%2010_49_55%20PM.png", "category": "Garlands", "inStock": True},
    {"id": 3, "name": "Elegant Lily Collection", "description": "Pure white lilies symbolizing elegance and sophistication.", "price": 54.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2022%2C%202026%2C%2011_00_56%20PM.png", "category": "Garlands", "inStock": True},
    {"id": 4, "name": "Mixed Spring Bouquet", "description": "A colorful mix of seasonal spring flowers including tulips, daisies, and carnations.", "price": 39.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2022%2C%202026%2C%2011_01_54%20PM.png", "category": "Garlands", "inStock": True},
    {"id": 5, "name": "Pink Peony Paradise", "description": "Lush pink peonies that exude romance and charm.", "price": 64.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2022%2C%202026%2C%2010_57_56%20PM.png", "category": "Flowers", "inStock": True},
    {"id": 6, "name": "Orchid Elegance", "description": "Exotic orchids that add a touch of luxury to any setting.", "price": 79.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2005_45_22%20PM.png", "category": "Flowers", "inStock": True},
    {"id": 7, "name": "Lavender Dreams", "description": "Fragrant lavender bundles perfect for relaxation and home decor.", "price": 29.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2005_47_51%20PM.png", "category": "Flowers", "inStock": True},
    {"id": 8, "name": "Tropical Paradise", "description": "Exotic tropical flowers including birds of paradise and hibiscus.", "price": 69.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2005_49_25%20PM.png", "category": "Flowers", "inStock": True},
    {"id": 9, "name": "White Rose Serenity", "description": "Pure white roses symbolizing peace, purity, and new beginnings.", "price": 44.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2005_52_11%20PM.png", "category": "Bouquets", "inStock": True},
    {"id": 10, "name": "Tulip Festival", "description": "Vibrant tulips in assorted colors celebrating the beauty of spring.", "price": 36.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2006_50_43%20PM.png", "category": "Flowers", "inStock": True},
    {"id": 11, "name": "Carnation Charm", "description": "Long-lasting carnations in beautiful shades of pink and red.", "price": 27.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2006_58_05%20PM.png", "category": "Flowers", "inStock": True},
    {"id": 12, "name": "Premium Flower Box", "description": "Luxury arrangement in an elegant gift box, perfect for special occasions.", "price": 89.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2007_02_44%20PM.png", "category": "Gifts", "inStock": True},
    {"id": 13, "name": "Yellow Rose Sunshine", "description": "Bright yellow roses representing friendship and joy.", "price": 42.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2007_02_48%20PM.png", "category": "Flowers", "inStock": True},
    {"id": 14, "name": "Daisy Meadow", "description": "Fresh white daisies bringing simplicity and charm.", "price": 24.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2007_27_04%20PM.png", "category": "Flowers", "inStock": True},
    {"id": 15, "name": "Hydrangea Heaven", "description": "Beautiful blue hydrangeas perfect for home decoration.", "price": 52.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2007_27_38%20PM.png", "category": "Flowers", "inStock": True},
    {"id": 16, "name": "Cherry Blossom Branch", "description": "Delicate cherry blossoms symbolizing renewal and hope.", "price": 47.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2007_38_22%20PM.png", "category": "Bouquets", "inStock": True},
    {"id": 17, "name": "Gerbera Fiesta", "description": "Colorful gerbera daisies bringing vibrant energy to any room.", "price": 32.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2007_44_22%20PM.png", "category": "Flowers", "inStock": True},
    {"id": 18, "name": "Calla Lily Grace", "description": "Elegant calla lilies for sophisticated arrangements.", "price": 58.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2008_15_19%20PM.png", "category": "Flowers", "inStock": True},
    {"id": 19, "name": "Wildflower Mix", "description": "Natural wildflower bouquet with rustic charm.", "price": 35.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2008_25_33%20PM.png", "category": "Bouquets", "inStock": True},
    {"id": 20, "name": "Ranunculus Delight", "description": "Layered ranunculus blooms in soft pastel colors.", "price": 45.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2009_05_56%20PM.png", "category": "Flowers", "inStock": True},
    {"id": 21, "name": "Purple Iris Elegance", "description": "Stunning purple irises with elegant form.", "price": 38.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2026%2C%202026%2C%2010_43_21%20AM.png", "category": "Flowers", "inStock": True},
    {"id": 22, "name": "Protea Exotic", "description": "Unique South African protea flowers.", "price": 72.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2026%2C%202026%2C%2010_48_41%20AM.png", "category": "Flowers", "inStock": True},
    {"id": 23, "name": "Dahlia Dreams", "description": "Gorgeous dahlias in rich autumn colors.", "price": 48.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2021%2C%202026%2C%2011_57_47%20AM.png", "category": "Flowers", "inStock": True},
    {"id": 24, "name": "Anemone Beauty", "description": "Delicate anemones with striking dark centers.", "price": 41.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2022%2C%202026%2C%2010_49_55%20PM.png", "category": "Flowers", "inStock": True},
    {"id": 25, "name": "Chrysanthemum Burst", "description": "Full chrysanthemum blooms in various colors.", "price": 33.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2022%2C%202026%2C%2010_57_56%20PM.png", "category": "Garlands", "inStock": True},
    {"id": 26, "name": "Freesia Fragrance", "description": "Sweetly scented freesias in soft hues.", "price": 36.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2005_45_22%20PM.png", "category": "Flowers", "inStock": True},
    {"id": 27, "name": "Amaryllis Red", "description": "Bold red amaryllis for dramatic displays.", "price": 55.99, "image": "https://oydmbenbhjwclpxqlnuf.supabase.co/storage/v1/object/public/Products/ChatGPT%20Image%20Feb%2024%2C%202026%2C%2005_47_51%20PM.png", "category": "Flowers", "inStock": True},
    {"id": 28, "name": "Sweet Pea Garden", "description": "Delicate sweet peas with lovely fragrance.", "price": 31.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Flowers", "inStock": True},
    {"id": 29, "name": "Magnolia Majesty", "description": "Elegant magnolia branches for statement arrangements.", "price": 67.99, "image": "https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400", "category": "Flowers", "inStock": True},
    {"id": 30, "name": "Jasmine Bliss", "description": "Fragrant jasmine for romantic occasions.", "price": 43.99, "image": "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400", "category": "Garlands", "inStock": True},
    {"id": 31, "name": "Gardenia Perfection", "description": "Creamy gardenias with intoxicating scent.", "price": 59.99, "image": "https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400", "category": "Flowers", "inStock": True},
    {"id": 32, "name": "Zinnia Carnival", "description": "Bright zinnias in rainbow colors.", "price": 28.99, "image": "https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=400", "category": "Flowers", "inStock": True},
    {"id": 33, "name": "Cosmos Cloud", "description": "Airy cosmos flowers in pink and white.", "price": 26.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Garlands", "inStock": True},
    {"id": 34, "name": "Snapdragon Tower", "description": "Vertical snapdragons adding height to arrangements.", "price": 34.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Flowers", "inStock": True},
    {"id": 35, "name": "Petunia Paradise", "description": "Cascading petunias in vibrant shades.", "price": 23.99, "image": "https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=400", "category": "Flowers", "inStock": True},
    {"id": 36, "name": "Marigold Gold", "description": "Traditional marigolds in sunny yellow and orange, ideal for garlands.", "price": 22.99, "image": "https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=400", "category": "Garlands", "inStock": True},
    {"id": 37, "name": "Aster Autumn", "description": "Purple asters perfect for fall garlands and arrangements.", "price": 29.99, "image": "https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400", "category": "Garlands", "inStock": True},
    {"id": 38, "name": "Delphinium Blue", "description": "Tall blue delphiniums for dramatic effect.", "price": 46.99, "image": "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400", "category": "Flowers", "inStock": True},
    {"id": 39, "name": "Stock Fragrant", "description": "Sweetly scented stock in pastel shades.", "price": 37.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Flowers", "inStock": True},
    {"id": 40, "name": "Lisianthus Luxury", "description": "Rose-like lisianthus in soft colors.", "price": 51.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 41, "name": "Eucalyptus Seeded", "description": "Fresh eucalyptus for greenery arrangements.", "price": 19.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Decoration", "inStock": True},
    {"id": 42, "name": "Baby Breath Cloud", "description": "Delicate baby breath for filler or solo arrangements.", "price": 18.99, "image": "https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400", "category": "Decoration", "inStock": True},
    {"id": 43, "name": "Fern Forest", "description": "Lush fern fronds for natural arrangements.", "price": 21.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Decoration", "inStock": True},
    {"id": 44, "name": "Dusty Miller", "description": "Silver-grey dusty miller for texture.", "price": 17.99, "image": "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400", "category": "Decoration", "inStock": True},
    {"id": 45, "name": "Olive Branch", "description": "Mediterranean olive branches for rustic style.", "price": 25.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Decoration", "inStock": True},
    {"id": 46, "name": "Pink Rose Garden", "description": "Soft pink roses for romantic gestures.", "price": 47.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 47, "name": "Orange Rose Sunset", "description": "Warm orange roses for vibrant arrangements.", "price": 45.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 48, "name": "Peach Rose Blush", "description": "Delicate peach roses for elegant occasions.", "price": 48.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 49, "name": "Coral Rose Joy", "description": "Cheerful coral roses for celebrations.", "price": 46.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 50, "name": "Lavender Rose Dream", "description": "Unique lavender roses for special moments.", "price": 52.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 51, "name": "Mini Sunflower Bunch", "description": "Petite sunflowers for compact arrangements.", "price": 28.99, "image": "https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=400", "category": "Flowers", "inStock": True},
    {"id": 52, "name": "Giant Sunflower Single", "description": "Statement single giant sunflower.", "price": 15.99, "image": "https://images.unsplash.com/photo-1597848212624-a19eb35e2651?w=400", "category": "Flowers", "inStock": True},
    {"id": 53, "name": "Stargazer Lily", "description": "Fragrant stargazer lilies in pink.", "price": 56.99, "image": "https://images.unsplash.com/photo-1606041008023-472dfb5e530f?w=400", "category": "Flowers", "inStock": True},
    {"id": 54, "name": "Tiger Lily Wild", "description": "Spotted tiger lilies for exotic flair.", "price": 49.99, "image": "https://images.unsplash.com/photo-1606041008023-472dfb5e530f?w=400", "category": "Flowers", "inStock": True},
    {"id": 55, "name": "Asiatic Lily Mix", "description": "Colorful asiatic lilies in mixed hues.", "price": 44.99, "image": "https://images.unsplash.com/photo-1606041008023-472dfb5e530f?w=400", "category": "Flowers", "inStock": True},
    {"id": 56, "name": "Red Tulip Romance", "description": "Classic red tulips for love.", "price": 34.99, "image": "https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400", "category": "Flowers", "inStock": True},
    {"id": 57, "name": "Yellow Tulip Sunshine", "description": "Bright yellow tulips for happiness.", "price": 32.99, "image": "https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400", "category": "Flowers", "inStock": True},
    {"id": 58, "name": "Purple Tulip Royal", "description": "Regal purple tulips for elegance.", "price": 35.99, "image": "https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400", "category": "Flowers", "inStock": True},
    {"id": 59, "name": "White Tulip Pure", "description": "Pure white tulips for simplicity.", "price": 33.99, "image": "https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400", "category": "Flowers", "inStock": True},
    {"id": 60, "name": "Parrot Tulip Fancy", "description": "Frilly parrot tulips in mixed colors.", "price": 39.99, "image": "https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400", "category": "Flowers", "inStock": True},
    {"id": 61, "name": "White Carnation Pure", "description": "Classic white carnations for any occasion.", "price": 24.99, "image": "https://images.unsplash.com/photo-1526047932273-341f2a7631f9?w=400", "category": "Flowers", "inStock": True},
    {"id": 62, "name": "Red Carnation Love", "description": "Deep red carnations expressing love.", "price": 26.99, "image": "https://images.unsplash.com/photo-1526047932273-341f2a7631f9?w=400", "category": "Flowers", "inStock": True},
    {"id": 63, "name": "Pink Carnation Sweet", "description": "Sweet pink carnations for gratitude.", "price": 25.99, "image": "https://images.unsplash.com/photo-1526047932273-341f2a7631f9?w=400", "category": "Flowers", "inStock": True},
    {"id": 64, "name": "White Peony Bride", "description": "Bridal white peonies for weddings.", "price": 69.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Flowers", "inStock": True},
    {"id": 65, "name": "Blush Peony Romance", "description": "Soft blush peonies for romance.", "price": 66.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Flowers", "inStock": True},
    {"id": 66, "name": "Coral Peony Joy", "description": "Vibrant coral peonies for celebrations.", "price": 67.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Flowers", "inStock": True},
    {"id": 67, "name": "White Orchid Zen", "description": "Peaceful white orchids for tranquility.", "price": 74.99, "image": "https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400", "category": "Flowers", "inStock": True},
    {"id": 68, "name": "Purple Orchid Royal", "description": "Majestic purple orchids for luxury.", "price": 82.99, "image": "https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400", "category": "Flowers", "inStock": True},
    {"id": 69, "name": "Yellow Orchid Exotic", "description": "Sunny yellow orchids for brightness.", "price": 77.99, "image": "https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400", "category": "Flowers", "inStock": True},
    {"id": 70, "name": "Mixed Orchid Pot", "description": "Potted orchid mix for lasting beauty.", "price": 89.99, "image": "https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400", "category": "Bouquets", "inStock": True},
    {"id": 71, "name": "Bird of Paradise", "description": "Striking bird of paradise flowers.", "price": 62.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Flowers", "inStock": True},
    {"id": 72, "name": "Anthurium Red", "description": "Glossy red anthuriums for modern style.", "price": 54.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Flowers", "inStock": True},
    {"id": 73, "name": "Heliconia Exotic", "description": "Dramatic heliconia for tropical vibes.", "price": 58.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Flowers", "inStock": True},
    {"id": 74, "name": "Ginger Flower", "description": "Unique ginger flowers for exotic arrangements.", "price": 49.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Flowers", "inStock": True},
    {"id": 75, "name": "Plumeria Hawaiian", "description": "Fragrant Hawaiian plumeria flowers.", "price": 44.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Flowers", "inStock": True},
    {"id": 76, "name": "Birthday Celebration Box", "description": "Festive arrangement for birthdays.", "price": 79.99, "image": "https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=400", "category": "Gifts", "inStock": True},
    {"id": 77, "name": "Anniversary Deluxe", "description": "Romantic arrangement for anniversaries.", "price": 99.99, "image": "https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=400", "category": "Gifts", "inStock": True},
    {"id": 78, "name": "Get Well Wishes", "description": "Cheerful bouquet for recovery wishes.", "price": 54.99, "image": "https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=400", "category": "Bouquets", "inStock": True},
    {"id": 79, "name": "Sympathy White", "description": "Respectful white arrangement for sympathy.", "price": 74.99, "image": "https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400", "category": "Gifts", "inStock": True},
    {"id": 80, "name": "Congratulations Burst", "description": "Celebratory arrangement for achievements.", "price": 64.99, "image": "https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=400", "category": "Bouquets", "inStock": True},
    {"id": 81, "name": "Thank You Bouquet", "description": "Grateful arrangement to say thanks.", "price": 49.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Bouquets", "inStock": True},
    {"id": 82, "name": "New Baby Pink", "description": "Soft pink flowers for baby girl.", "price": 56.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Gifts", "inStock": True},
    {"id": 83, "name": "New Baby Blue", "description": "Gentle blue flowers for baby boy.", "price": 56.99, "image": "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400", "category": "Gifts", "inStock": True},
    {"id": 84, "name": "Mothers Day Special", "description": "Special arrangement for mothers.", "price": 69.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Gifts", "inStock": True},
    {"id": 85, "name": "Valentine Romance", "description": "Romantic red roses for Valentine.", "price": 79.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Gifts", "inStock": True},
    {"id": 86, "name": "Christmas Joy", "description": "Festive holiday arrangement.", "price": 72.99, "image": "https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=400", "category": "Gifts", "inStock": True},
    {"id": 87, "name": "Easter Spring", "description": "Fresh spring arrangement for Easter.", "price": 54.99, "image": "https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400", "category": "Gifts", "inStock": True},
    {"id": 88, "name": "Thanksgiving Harvest", "description": "Autumn harvest arrangement.", "price": 64.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Gifts", "inStock": True},
    {"id": 89, "name": "Succulent Garden", "description": "Long-lasting succulent arrangement.", "price": 42.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Decoration", "inStock": True},
    {"id": 90, "name": "Potted Peace Lily", "description": "Air-purifying peace lily plant.", "price": 39.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Decoration", "inStock": True},
    {"id": 91, "name": "Mini Rose Plant", "description": "Potted miniature rose plant.", "price": 34.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Decoration", "inStock": True},
    {"id": 92, "name": "Herb Garden Kit", "description": "Fresh herb plants for cooking.", "price": 29.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Decoration", "inStock": True},
    {"id": 93, "name": "Bonsai Tree", "description": "Artistic bonsai tree for decor.", "price": 89.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Decoration", "inStock": True},
    {"id": 94, "name": "Wedding Bridal Bouquet", "description": "Elegant bridal bouquet for weddings.", "price": 149.99, "image": "https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400", "category": "Bouquets", "inStock": True},
    {"id": 95, "name": "Bridesmaid Bouquet", "description": "Coordinating bridesmaid bouquet.", "price": 69.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Bouquets", "inStock": True},
    {"id": 96, "name": "Boutonniere Classic", "description": "Classic boutonniere for groom.", "price": 19.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Garlands", "inStock": True},
    {"id": 97, "name": "Corsage Elegant", "description": "Elegant wrist corsage.", "price": 29.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Garlands", "inStock": True},
    {"id": 98, "name": "Centerpiece Grand", "description": "Grand table centerpiece.", "price": 119.99, "image": "https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=400", "category": "Decoration", "inStock": True},
    {"id": 99, "name": "Flower Crown", "description": "Bohemian flower crown for events.", "price": 44.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Garlands", "inStock": True},
    {"id": 100, "name": "Dried Flower Bundle", "description": "Long-lasting dried flower arrangement.", "price": 38.99, "image": "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400", "category": "Decoration", "inStock": True},
]

# In-memory cache of products, refreshed from Supabase on startup and after every
# admin add/edit/delete. Starts as a copy of the seed so it's always populated.
PRODUCTS = list(_SEED_PRODUCTS)

def _row_to_product(r: dict) -> dict:
    return {
        "id": r["id"],
        "name": r.get("name", ""),
        "description": r.get("description", ""),
        "price": float(r.get("price", 0)),
        "image": r.get("image", ""),
        "category": r.get("category", ""),
        "inStock": r.get("in_stock", True),
    }

def load_products():
    """Refresh the in-memory PRODUCTS cache from Supabase.
    Falls back to the hardcoded seed list if the table is missing/empty."""
    global PRODUCTS
    try:
        rows = supabase.table("products").select("*").order("id").execute().data or []
        PRODUCTS = [_row_to_product(r) for r in rows] if rows else list(_SEED_PRODUCTS)
    except Exception as e:
        print(f"[Products] Could not load from DB — using seed list: {e}", flush=True)
        PRODUCTS = list(_SEED_PRODUCTS)

def seed_products():
    """Populate the products table with the seed list if it's empty."""
    try:
        existing = supabase.table("products").select("id").limit(1).execute()
        if not existing.data:
            supabase.table("products").insert([{
                "id": p["id"], "name": p["name"], "description": p["description"],
                "price": p["price"], "image": p["image"], "category": p["category"],
                "in_stock": p["inStock"],
            } for p in _SEED_PRODUCTS]).execute()
            print("[Seed] Inserted default products", flush=True)
    except Exception as e:
        print(f"[Seed] Products seeding skipped (table may not exist — run supabase_migration.sql): {e}", flush=True)

# ── Subscription plans (DB-backed config) ────────────────────────────────────────
# Plan cadence + discount live in the `subscription_plans` table so the discount
# can be tuned from the admin panel without a redeploy. Seeded on first run.
_SEED_SUBSCRIPTION_PLANS = [
    {"id": "weekly",   "label": "Weekly",    "subtitle": "Fresh flowers every day for 1 week",       "days": 7,  "discount_percent": 0,  "sort_order": 1},
    {"id": "biweekly", "label": "Bi-Weekly", "subtitle": "Fresh flowers every day for 2 weeks",      "days": 14, "discount_percent": 10, "sort_order": 2},
    {"id": "monthly",  "label": "Monthly",   "subtitle": "Fresh flowers every day for 1 full month", "days": 30, "discount_percent": 20, "sort_order": 3},
]
SUBSCRIPTION_PLANS = list(_SEED_SUBSCRIPTION_PLANS)

def load_subscription_plans():
    """Refresh the in-memory subscription plan cache from Supabase."""
    global SUBSCRIPTION_PLANS
    try:
        rows = supabase.table("subscription_plans").select("*").order("sort_order").execute().data or []
        SUBSCRIPTION_PLANS = rows if rows else list(_SEED_SUBSCRIPTION_PLANS)
    except Exception as e:
        print(f"[SubscriptionPlans] Could not load from DB — using seed: {e}", flush=True)
        SUBSCRIPTION_PLANS = list(_SEED_SUBSCRIPTION_PLANS)

def seed_subscription_plans():
    try:
        existing = supabase.table("subscription_plans").select("id").limit(1).execute()
        if not existing.data:
            supabase.table("subscription_plans").insert(_SEED_SUBSCRIPTION_PLANS).execute()
            print("[Seed] Inserted default subscription plans", flush=True)
    except Exception as e:
        print(f"[Seed] Subscription plans seeding skipped (table may not exist — run supabase_migration.sql): {e}", flush=True)

def plan_days(plan: str) -> int:
    for p in SUBSCRIPTION_PLANS:
        if p["id"] == plan:
            return p.get("days", 7)
    return 7

# ── Seed default promo/offers/bundles if tables are empty ─────────────────────

def seed_defaults():
    """Populate promo_codes, seasonal_offers, bundle_deals with defaults if empty."""
    try:
        # Promo codes
        existing = supabase.table("promo_codes").select("code").limit(1).execute()
        if not existing.data:
            supabase.table("promo_codes").insert([
                {"code": "WELCOME10", "type": "percent", "value": 10, "description": "10% off your first order", "first_order_only": True, "min_order": 0, "active": True},
                {"code": "SUMMER20",  "type": "percent", "value": 20, "description": "20% off orders above ₹500", "first_order_only": False, "min_order": 500, "active": True},
                {"code": "FLAT100",   "type": "flat",    "value": 100, "description": "₹100 off on orders above ₹800", "first_order_only": False, "min_order": 800, "active": True},
                {"code": "BUNDLE15",  "type": "percent", "value": 15, "description": "15% off on bundle deals", "first_order_only": False, "min_order": 0, "active": True},
                {"code": "FLORANVIP", "type": "percent", "value": 25, "description": "VIP exclusive — 25% off orders above ₹1000", "first_order_only": False, "min_order": 1000, "active": True},
            ]).execute()
            print("[Seed] Inserted default promo codes", flush=True)

        # Seasonal offers
        existing = supabase.table("seasonal_offers").select("id").limit(1).execute()
        if not existing.data:
            supabase.table("seasonal_offers").insert([
                {"id": "spring",  "emoji": "🌸", "title": "Spring Sale",   "subtitle": "Up to 20% off on all bouquets",  "code": "SUMMER20",  "badge": "Limited Time"},
                {"id": "bundle",  "emoji": "🎁", "title": "Bundle & Save", "subtitle": "Buy a bundle and save 15%",       "code": "BUNDLE15",  "badge": "Bundle Deal"},
                {"id": "newuser", "emoji": "🎉", "title": "New Here?",      "subtitle": "10% off your very first order",   "code": "WELCOME10", "badge": "First Order"},
                {"id": "vip",     "emoji": "💎", "title": "VIP Offer",      "subtitle": "25% off orders above ₹1000",      "code": "FLORANVIP", "badge": "VIP Only"},
            ]).execute()
            print("[Seed] Inserted default seasonal offers", flush=True)

        # Bundle deals
        existing = supabase.table("bundle_deals").select("id").limit(1).execute()
        if not existing.data:
            supabase.table("bundle_deals").insert([
                {"id": "romance",  "name": "Romance Bundle",    "description": "Perfect for date nights and anniversaries", "emoji": "❤️", "product_ids": [1, 5, 42],  "promo_code": "BUNDLE15", "savings_pct": 15},
                {"id": "wedding",  "name": "Wedding Elegance",  "description": "Everything for a perfect wedding",          "emoji": "💍", "product_ids": [94, 9, 42], "promo_code": "BUNDLE15", "savings_pct": 15},
                {"id": "birthday", "name": "Birthday Surprise", "description": "Make their birthday extra special",         "emoji": "🎂", "product_ids": [76, 4, 14], "promo_code": "BUNDLE15", "savings_pct": 15},
            ]).execute()
            print("[Seed] Inserted default bundle deals", flush=True)

    except Exception as e:
        print(f"[Seed] Error seeding defaults (tables may not exist yet — run supabase_migration.sql): {e}", flush=True)

# ── Occasions (storefront festivals — admin-managed, explicit products) ──────────
_SEED_OCCASIONS = [
    {"slug": "birthday", "title": "Birthday Celebrations", "tagline": "Make their day unforgettable",
     "story": "Birthdays are milestones worth celebrating with the most vibrant blooms you can find. Whether they turn 7 or 70, a curated flower arrangement makes every birthday feel truly special.",
     "quote": '"A bouquet of flowers is the one gift that never goes out of style."', "emoji": "🎂",
     "hero_image": "https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=1400&q=85",
     "gradient": "linear-gradient(135deg, rgba(232,67,147,0.82) 0%, rgba(255,170,80,0.72) 100%)",
     "accent_color": "#e84393", "sort_order": 1,
     "keywords": ["birthday", "celebrat", "festiv", "carnival", "congratulat", "colorful", "vibrant"]},
    {"slug": "wedding", "title": "Wedding Flowers", "tagline": "For the love story of a lifetime",
     "story": "Every wedding deserves flowers as beautiful as the vows exchanged. From bridal bouquets to sweeping table centrepieces, our wedding collection transforms any venue into a floral fairytale.",
     "quote": '"Where flowers bloom, so does hope — and love."', "emoji": "💍",
     "hero_image": "https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=1400&q=85",
     "gradient": "linear-gradient(135deg, rgba(255,240,215,0.88) 0%, rgba(220,170,130,0.80) 100%)",
     "accent_color": "#b8713a", "sort_order": 2,
     "keywords": ["wedding", "bridal", "bridesmaid", "bride", "groom", "corsage", "boutonniere", "centrepiece", "centerpiece"]},
    {"slug": "sympathy", "title": "Sympathy & Comfort", "tagline": "When words fall short, flowers speak",
     "story": "In moments of grief and loss, flowers offer something words cannot — a gentle, living reminder that love endures. Our sympathy arrangements are thoughtfully chosen to honour a life.",
     "quote": '"Grief is love with nowhere to go. Let flowers carry it gently forward."', "emoji": "🕊️",
     "hero_image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=1400&q=85",
     "gradient": "linear-gradient(135deg, rgba(210,228,255,0.90) 0%, rgba(170,200,245,0.82) 100%)",
     "accent_color": "#3a6fba", "sort_order": 3,
     "keywords": ["sympathy", "white", "pure", "serene", "peace", "lily", "serenity", "get well", "recovery"]},
    {"slug": "romance", "title": "Romance & Love", "tagline": "Say it with flowers, say it from the heart",
     "story": "Love is in the details — and nothing expresses it more beautifully than hand-picked roses and blooms chosen just for them.",
     "quote": '"Love is a flower. You\'ve got to let it grow." — John Lennon', "emoji": "❤️",
     "hero_image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=1400&q=85",
     "gradient": "linear-gradient(135deg, rgba(153,27,27,0.85) 0%, rgba(220,38,38,0.70) 100%)",
     "accent_color": "#2563eb", "sort_order": 4,
     "keywords": ["romance", "romantic", "love", "valentine", "rose", "passion", "peony", "heart"]},
    {"slug": "corporate", "title": "Corporate Gifting", "tagline": "Elevate every professional relationship",
     "story": "First impressions matter — and lasting ones matter even more. Impress clients, reward your team, or elevate your workspace with premium floral arrangements.",
     "quote": '"The best investment is one that makes people feel genuinely valued."', "emoji": "🏢",
     "hero_image": "https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=1400&q=85",
     "gradient": "linear-gradient(135deg, rgba(20,40,70,0.90) 0%, rgba(50,90,160,0.82) 100%)",
     "accent_color": "#2c4a7c", "sort_order": 5,
     "keywords": ["luxury", "premium", "grand", "deluxe", "elegant", "exotic", "centerpiece", "bonsai", "orchid"],
     "use_price_filter": True, "min_price": 55},
]

def _compute_occasion_products(occ: dict) -> list:
    ids, kws = [], [k.lower() for k in occ.get("keywords", [])]
    for p in _SEED_PRODUCTS:
        text = (p["name"] + " " + p["description"]).lower()
        if any(k in text for k in kws):
            ids.append(p["id"])
    if occ.get("use_price_filter") and occ.get("min_price"):
        for p in _SEED_PRODUCTS:
            if p["id"] not in ids and p["price"] >= occ["min_price"]:
                ids.append(p["id"])
    return ids[:12]

def seed_occasions():
    try:
        existing = supabase.table("occasions").select("slug").limit(1).execute()
        if not existing.data:
            supabase.table("occasions").insert([{
                "id": "OCC" + str(uuid.uuid4())[:8].upper(),
                "slug": o["slug"], "title": o["title"], "tagline": o["tagline"], "story": o["story"],
                "quote": o["quote"], "emoji": o["emoji"], "hero_image": o["hero_image"],
                "gradient": o["gradient"], "accent_color": o["accent_color"],
                "product_ids": _compute_occasion_products(o), "active": True, "sort_order": o["sort_order"],
            } for o in _SEED_OCCASIONS]).execute()
            print("[Seed] Inserted default occasions", flush=True)
    except Exception as e:
        print(f"[Seed] Occasions seeding skipped (run supabase_migration.sql): {e}", flush=True)

class OccasionAdmin(BaseModel):
    slug: Optional[str] = None
    title: str
    tagline: Optional[str] = ""
    story: Optional[str] = ""
    quote: Optional[str] = ""
    emoji: Optional[str] = "🎉"
    hero_image: Optional[str] = ""
    gradient: Optional[str] = ""
    accent_color: Optional[str] = "#c84b7a"
    product_ids: list[int] = []
    active: bool = True
    sort_order: Optional[int] = 100

@app.get("/api/store-occasions")
def get_store_occasions():
    try:
        return supabase.table("occasions").select("*").eq("active", True).order("sort_order").execute().data or []
    except Exception:
        return []

@app.get("/api/store-occasions/{slug}")
def get_store_occasion(slug: str):
    rows = supabase.table("occasions").select("*").eq("slug", slug).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Occasion not found")
    return rows[0]

@app.get("/api/admin/occasions")
def admin_list_occasions(token: str):
    require_admin(token)
    return supabase.table("occasions").select("*").order("sort_order").execute().data or []

@app.post("/api/admin/occasions")
def admin_create_occasion(req: OccasionAdmin, token: str):
    require_admin(token)
    slug = (req.slug or req.title).lower().strip().replace(" ", "-")
    existing = {r["slug"] for r in (supabase.table("occasions").select("slug").execute().data or [])}
    base, i = slug, 1
    while slug in existing:
        slug = f"{base}-{i}"; i += 1
    row = {
        "id": "OCC" + str(uuid.uuid4())[:8].upper(), "slug": slug, "title": req.title,
        "tagline": req.tagline, "story": req.story, "quote": req.quote, "emoji": req.emoji,
        "hero_image": req.hero_image, "gradient": req.gradient, "accent_color": req.accent_color,
        "product_ids": req.product_ids, "active": req.active, "sort_order": req.sort_order or 100,
    }
    return supabase.table("occasions").insert(row).execute().data[0]

@app.put("/api/admin/occasions/{occ_id}")
def admin_update_occasion(occ_id: str, req: OccasionAdmin, token: str):
    require_admin(token)
    data = {
        "title": req.title, "tagline": req.tagline, "story": req.story, "quote": req.quote,
        "emoji": req.emoji, "hero_image": req.hero_image, "gradient": req.gradient,
        "accent_color": req.accent_color, "product_ids": req.product_ids,
        "active": req.active, "sort_order": req.sort_order or 100,
    }
    if req.slug:
        data["slug"] = req.slug.lower().strip().replace(" ", "-")
    result = supabase.table("occasions").update(data).eq("id", occ_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Occasion not found")
    return result.data[0]

@app.delete("/api/admin/occasions/{occ_id}")
def admin_delete_occasion(occ_id: str, token: str):
    require_admin(token)
    result = supabase.table("occasions").delete().eq("id", occ_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Occasion not found")
    return {"status": "ok"}

seed_defaults()
seed_products()
load_products()
seed_subscription_plans()
load_subscription_plans()
seed_occasions()

# ── Order Status ───────────────────────────────────────────────────────────────
STATUS_MESSAGES = {
    "preparing":        "🌸 VivaPetals: Your order {order_id} is being prepared! We're arranging your blooms.",
    "out_for_delivery": "🚚 VivaPetals: Your order {order_id} is out for delivery! Our driver is on the way.",
    "delivered":        "🌺 VivaPetals: Your order {order_id} has been delivered! Thank you for choosing VivaPetals.",
    "cancelled":        "💔 VivaPetals: Your order {order_id} has been cancelled. Contact us if you need help.",
}

VALID_STATUS_TRANSITIONS = {
    "confirmed":        ["preparing", "out_for_delivery", "delivered", "cancelled"],
    "preparing":        ["confirmed", "out_for_delivery", "delivered", "cancelled"],
    "out_for_delivery": ["confirmed", "preparing", "delivered", "cancelled"],
    "delivered":        ["confirmed", "preparing", "out_for_delivery", "cancelled"],
    "cancelled":        ["confirmed", "preparing", "out_for_delivery", "delivered"],
}

# ── Pydantic Models ────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class RegisterRequest(BaseModel):
    firstName: str
    lastName: str
    email: EmailStr
    password: str
    referral_code: Optional[str] = None

class ContactRequest(BaseModel):
    name: str
    email: str
    phone: str
    subject: str
    message: str

class OrderItem(BaseModel):
    productId: int
    name: str
    price: float
    quantity: int

class PromoValidateRequest(BaseModel):
    code: str
    order_total: float
    customer_email: Optional[str] = None

class OrderRequest(BaseModel):
    items: list[OrderItem]
    total: float
    customer: dict
    delivery_type: Optional[str] = "immediate"
    delivery_datetime: Optional[str] = None
    points_redeemed: Optional[int] = 0
    promo_code: Optional[str] = None
    is_recurring: bool = False
    recurrence_type: Optional[str] = None   # 'annual'
    payment_method: Optional[str] = "cod"   # cod | credit_card | debit_card | phonepe | google_pay
    token: Optional[str] = None

class UpdateDeliveryRequest(BaseModel):
    delivery_type: str
    delivery_datetime: Optional[str] = None

class StatusUpdateRequest(BaseModel):
    status: str

class PromoCodeCreate(BaseModel):
    code: str
    type: str          # "percent" or "flat"
    value: float
    description: str
    first_order_only: bool = False
    min_order: float = 0
    active: bool = True

class ProductCreate(BaseModel):
    name: str
    description: str = ""
    price: float
    image: str = ""
    category: str
    inStock: bool = True

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    image: Optional[str] = None
    category: Optional[str] = None
    inStock: Optional[bool] = None

class SeasonalOfferCreate(BaseModel):
    emoji: str
    title: str
    subtitle: str
    code: str          # must reference an existing promo code
    badge: str

class BundleDealCreate(BaseModel):
    name: str
    description: str
    emoji: str
    product_ids: list[int]
    promo_code: str
    savings_pct: float = 15

class CartItemRequest(BaseModel):
    user_id: str
    product_id: int
    quantity: int

class SubscriptionRequest(BaseModel):
    customer_email: str
    customer_name: str
    customer_phone: Optional[str] = None
    plan: str                          # weekly | biweekly | monthly
    address: str
    items: list[dict] = []             # selected products (florist choice = empty)
    instructions: Optional[str] = None
    daily_total: Optional[float] = None
    grand_total: Optional[float] = None
    discount_percent: Optional[float] = None

# ── Products Routes ────────────────────────────────────────────────────────────

@app.get("/api/products")
def get_products(category: Optional[str] = None):
    if category:
        return [p for p in PRODUCTS if p["category"] == category]
    return PRODUCTS

@app.get("/api/products/categories")
def get_categories():
    return sorted(list(set(p["category"] for p in PRODUCTS)))

@app.get("/api/products/{product_id}")
def get_product(product_id: int):
    product = next((p for p in PRODUCTS if p["id"] == product_id), None)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product

# ── Admin: Products CRUD (Supabase) ──────────────────────────────────────────────

@app.post("/api/admin/products")
def create_product(req: ProductCreate, token: str):
    require_admin(token)
    rows = supabase.table("products").select("id").order("id", desc=True).limit(1).execute().data
    next_id = (rows[0]["id"] + 1) if rows else 1
    supabase.table("products").insert({
        "id": next_id, "name": req.name, "description": req.description,
        "price": float(req.price), "image": req.image, "category": req.category,
        "in_stock": req.inStock,
    }).execute()
    load_products()
    return next(p for p in PRODUCTS if p["id"] == next_id)

@app.put("/api/admin/products/{product_id}")
def update_product(product_id: int, req: ProductUpdate, token: str):
    require_admin(token)
    col_map = {"name": "name", "description": "description", "price": "price",
               "image": "image", "category": "category", "inStock": "in_stock"}
    data = {}
    for field, col in col_map.items():
        val = getattr(req, field)
        if val is not None:
            data[col] = float(val) if field == "price" else val
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = supabase.table("products").update(data).eq("id", product_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Product not found")
    load_products()
    return next(p for p in PRODUCTS if p["id"] == product_id)

@app.delete("/api/admin/products/{product_id}")
def delete_product(product_id: int, token: str):
    require_admin(token)
    result = supabase.table("products").delete().eq("id", product_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Product not found")
    supabase.table("product_stock").delete().eq("product_id", product_id).execute()
    load_products()
    return {"status": "ok"}

# ── Auth Routes ────────────────────────────────────────────────────────────────

@app.post("/api/auth/register")
def register(req: RegisterRequest):
    existing = supabase.table("users").select("*").eq("email", req.email).execute()

    if existing.data:
        user = existing.data[0]
        if user.get("is_verified"):
            provider = user.get("auth_provider", "email")
            if provider != "email":
                # Social user adding email+password — store password and send verification email.
                # auth_provider stays social until they click the link.
                hashed_password = hash_password(req.password)
                verification_token = secrets.token_urlsafe(32)
                token_expires = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
                supabase.table("users").update({
                    "password":                      hashed_password,
                    "first_name":                    req.firstName,
                    "last_name":                     req.lastName,
                    "verification_token":            verification_token,
                    "verification_token_expires_at": token_expires,
                }).eq("email", req.email).execute()
                threading.Thread(target=send_verification_email, args=(req.email, req.firstName, verification_token), daemon=True).start()
                return {"message": "Account created! Please check your email to verify your account."}
            raise HTTPException(status_code=400, detail="Email already registered")
        # Unverified account — resend verification with updated details
        hashed_password = hash_password(req.password)
        verification_token = secrets.token_urlsafe(32)
        token_expires = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
        supabase.table("users").update({
            "password": hashed_password,
            "first_name": req.firstName,
            "last_name": req.lastName,
            "verification_token": verification_token,
            "verification_token_expires_at": token_expires
        }).eq("email", req.email).execute()
        threading.Thread(target=send_verification_email, args=(req.email, req.firstName, verification_token), daemon=True).start()
        return { "message": "Account created! Please check your email to verify your account." }

    hashed_password = hash_password(req.password)
    verification_token = secrets.token_urlsafe(32)
    token_expires = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()

    supabase.table("users").insert({
        "email": req.email,
        "password": hashed_password,
        "first_name": req.firstName,
        "last_name": req.lastName,
        "is_verified": False,
        "verification_token": verification_token,
        "verification_token_expires_at": token_expires,
        "referred_by_code": req.referral_code or None
    }).execute()

    threading.Thread(target=send_verification_email, args=(req.email, req.firstName, verification_token), daemon=True).start()

    return { "message": "Account created! Please check your email to verify your account." }


@app.get("/api/auth/verify-email")
def verify_email(token: str):
    result = supabase.table("users").select("*").eq("verification_token", token).execute()
    if not result.data:
        raise HTTPException(status_code=400, detail="Invalid or expired verification link.")

    user = result.data[0]

    expires_at = user.get("verification_token_expires_at")
    if expires_at:
        expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if datetime.now(timezone.utc) > expiry:
            raise HTTPException(status_code=400, detail="Verification link has expired. Please request a new one.")

    if user.get("is_verified"):
        # Social user linking email+password — enable email auth and clear token.
        supabase.table("users").update({
            "auth_provider":               "email",
            "verification_token":          None,
            "verification_token_expires_at": None,
        }).eq("email", user["email"]).execute()
        return { "message": "Email verified! You can now sign in with your email and password." }

    supabase.table("users").update({
        "is_verified": True,
        "verification_token": None,
        "verification_token_expires_at": None
    }).eq("email", user["email"]).execute()

    create_loyalty_account(user["email"], user.get("referred_by_code"))

    return { "message": "Email verified successfully!" }


class ResendVerificationRequest(BaseModel):
    email: EmailStr

@app.post("/api/auth/resend-verification")
def resend_verification(req: ResendVerificationRequest):
    result = supabase.table("users").select("*").eq("email", req.email).execute()
    if not result.data:
        return { "message": "If that email is registered, a verification link has been sent." }

    user = result.data[0]
    if user.get("is_verified"):
        return { "message": "Email is already verified." }

    verification_token = secrets.token_urlsafe(32)
    token_expires = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()

    supabase.table("users").update({
        "verification_token": verification_token,
        "verification_token_expires_at": token_expires
    }).eq("email", req.email).execute()

    send_verification_email(req.email, user["first_name"], verification_token)
    return { "message": "If that email is registered, a verification link has been sent." }


class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

@app.post("/api/auth/forgot-password")
def forgot_password(req: ForgotPasswordRequest):
    result = supabase.table("users").select("*").eq("email", req.email).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="No account found with that email address.")

    user = result.data[0]
    reset_token = secrets.token_urlsafe(32)
    token_expires = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()

    supabase.table("users").update({
        "reset_token": reset_token,
        "reset_token_expires_at": token_expires
    }).eq("email", req.email).execute()

    reset_url = f"{APP_URL}/reset-password?token={reset_token}"
    html = f"""
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;background:#fdf0f5;font-family:'Segoe UI',Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:40px 16px;">
          <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(200,75,122,0.1);">
            <tr><td style="background:linear-gradient(135deg,#c84b7a,#9c2d55);padding:32px 40px;text-align:center;">
              <div style="font-size:2rem;">🌸</div>
              <div style="color:#fff;font-size:1.5rem;font-weight:800;margin-top:8px;">VivaPetals</div>
            </td></tr>
            <tr><td style="padding:40px;">
              <h2 style="margin:0 0 12px;color:#1e1e1e;font-size:1.35rem;font-weight:800;">Reset your password</h2>
              <p style="color:#666;line-height:1.6;margin:0 0 28px;">Hi {user['first_name']}, we received a request to reset your password. Click the button below to set a new one.</p>
              <div style="text-align:center;margin-bottom:28px;">
                <a href="{reset_url}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#c84b7a,#9c2d55);color:#fff;text-decoration:none;border-radius:999px;font-weight:700;font-size:1rem;box-shadow:0 4px 16px rgba(200,75,122,0.35);">Reset Password</a>
              </div>
              <p style="color:#999;font-size:0.82rem;line-height:1.6;margin:0;">This link expires in <strong>1 hour</strong>. If you didn't request this, ignore this email.</p>
              <hr style="border:none;border-top:1px solid #f0e0e8;margin:24px 0;">
              <p style="color:#bbb;font-size:0.75rem;margin:0;">Or copy: <span style="color:#c84b7a;">{reset_url}</span></p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
    """
    try:
        with _httpx.Client() as client:
            resp = client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
                json={"from": "VivaPetals <orderhere@vivapetals.com>", "to": [req.email], "subject": "Reset your VivaPetals password", "html": html},
                timeout=10
            )
        print(f"[Email] Reset email response {resp.status_code}: {resp.text}", flush=True)
    except Exception as e:
        print(f"[Email] Failed to send reset email: {e}", flush=True)

    return { "message": "If that email is registered, a reset link has been sent." }


class UpdateProfileRequest(BaseModel):
    token: str
    first_name: str
    last_name: str

class UpdateEmailRequest(BaseModel):
    token: str
    new_email: str

class ChangePasswordRequest(BaseModel):
    token: str
    current_password: str
    new_password: str

@app.get("/api/auth/me")
def get_me(token: str):
    email = resolve_token(token)
    if not email:
        raise HTTPException(status_code=401, detail="Unauthorized")
    result = supabase.table("users").select("first_name,last_name,email,auth_provider").eq("email", email).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="User not found")
    user = result.data[0]
    return {
        "email": user["email"],
        "firstName": user["first_name"],
        "lastName": user["last_name"],
        "auth_provider": user.get("auth_provider", "email")
    }

@app.put("/api/auth/profile")
def update_profile(req: UpdateProfileRequest):
    email = resolve_token(req.token)
    if not email:
        raise HTTPException(status_code=401, detail="Unauthorized")
    supabase.table("users").update({
        "first_name": req.first_name.strip(),
        "last_name": req.last_name.strip()
    }).eq("email", email).execute()
    return {"firstName": req.first_name.strip(), "lastName": req.last_name.strip(), "email": email}

@app.put("/api/auth/update-email")
def update_email(req: UpdateEmailRequest):
    email = resolve_token(req.token)
    if not email:
        raise HTTPException(status_code=401, detail="Unauthorized")
    result = supabase.table("users").select("first_name").eq("email", email).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="User not found")
    user = result.data[0]
    new_email = req.new_email.strip().lower()
    if new_email == email:
        raise HTTPException(status_code=400, detail="New email is the same as your current email.")
    existing = supabase.table("users").select("email").eq("email", new_email).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="This email is already in use.")
    # Store pending email + send verification to new address
    change_token = secrets.token_urlsafe(32)
    token_expires = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
    supabase.table("users").update({
        "pending_email": new_email,
        "email_change_token": change_token,
        "email_change_token_expires_at": token_expires
    }).eq("email", email).execute()
    # Send verification email to new address
    def send_email_change_verification():
        if not RESEND_API_KEY:
            print(f"[Email] Resend not configured — email change token: {change_token}", flush=True)
            return
        confirm_url = f"{APP_URL}/confirm-email?token={change_token}"
        html = f"""<!DOCTYPE html><html><body style="margin:0;padding:0;background:#fdf0f5;font-family:'Segoe UI',Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px;">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(200,75,122,0.1);">
        <tr><td style="background:linear-gradient(135deg,#c84b7a,#9c2d55);padding:32px 40px;text-align:center;">
        <div style="font-size:2rem;">🌸</div>
        <div style="color:#fff;font-size:1.5rem;font-weight:800;margin-top:8px;">VivaPetals</div>
        </td></tr>
        <tr><td style="padding:40px;">
        <h2 style="margin:0 0 12px;color:#1e1e1e;font-size:1.35rem;font-weight:800;">Confirm your new email address</h2>
        <p style="color:#666;line-height:1.6;margin:0 0 28px;">Hi {user['first_name']}, click below to confirm <strong>{new_email}</strong> as your new email address.</p>
        <div style="text-align:center;margin-bottom:28px;">
        <a href="{confirm_url}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#c84b7a,#9c2d55);color:#fff;text-decoration:none;border-radius:999px;font-weight:700;font-size:1rem;">Confirm New Email</a>
        </div>
        <p style="color:#999;font-size:0.82rem;">This link expires in <strong>24 hours</strong>. If you didn't request this, you can ignore this email.</p>
        </td></tr></table></td></tr></table></body></html>"""
        try:
            import httpx
            httpx.post("https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
                json={"from": "VivaPetals <orderhere@vivapetals.com>", "to": [new_email],
                      "subject": "Confirm your new email address — VivaPetals", "html": html},
                timeout=10)
        except Exception as e:
            print(f"[Email] Failed to send email change verification: {e}", flush=True)
    threading.Thread(target=send_email_change_verification, daemon=True).start()
    return {"message": f"Verification email sent to {new_email}. Please check your inbox to confirm."}

@app.get("/api/auth/confirm-email")
def confirm_email(token: str):
    result = supabase.table("users").select("*").eq("email_change_token", token).execute()
    if not result.data:
        raise HTTPException(status_code=400, detail="Invalid or expired confirmation link.")
    user = result.data[0]
    expires_at = user.get("email_change_token_expires_at")
    if expires_at:
        expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if datetime.now(timezone.utc) > expiry:
            raise HTTPException(status_code=400, detail="Confirmation link has expired. Please request a new one.")
    new_email = user.get("pending_email")
    if not new_email:
        raise HTTPException(status_code=400, detail="No pending email change found.")
    old_email = user["email"]
    supabase.table("users").update({
        "email": new_email,
        "pending_email": None,
        "email_change_token": None,
        "email_change_token_expires_at": None
    }).eq("email", old_email).execute()
    # Backfill user_id on old orders that only have the old email
    supabase.table("orders").update({"user_id": user["id"]}).eq("customer_email", old_email).is_("user_id", "null").execute()
    new_token = create_token(new_email)
    return {"message": "Email updated successfully.", "email": new_email, "token": new_token}

@app.put("/api/auth/change-password")
def change_password(req: ChangePasswordRequest):
    email = resolve_token(req.token)
    if not email:
        raise HTTPException(status_code=401, detail="Unauthorized")
    result = supabase.table("users").select("password", "auth_provider").eq("email", email).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="User not found")
    user = result.data[0]
    has_password = bool(user.get("password"))
    if not has_password:
        provider = user.get("auth_provider", "Google")
        raise HTTPException(status_code=400, detail=f"no_password:{provider.title()}")
    if not verify_password(req.current_password, user["password"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    supabase.table("users").update({"password": hash_password(req.new_password)}).eq("email", email).execute()
    return {"message": "Password updated successfully"}

@app.post("/api/auth/reset-password")
def reset_password(req: ResetPasswordRequest):
    result = supabase.table("users").select("*").eq("reset_token", req.token).execute()
    if not result.data:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link.")

    user = result.data[0]
    expires_at = user.get("reset_token_expires_at")
    if expires_at:
        expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if datetime.now(timezone.utc) > expiry:
            raise HTTPException(status_code=400, detail="Reset link has expired. Please request a new one.")

    supabase.table("users").update({
        "password": hash_password(req.new_password),
        "reset_token": None,
        "reset_token_expires_at": None
    }).eq("email", user["email"]).execute()

    return { "message": "Password reset successfully." }


@app.post("/api/auth/login")
def login(req: LoginRequest):
    result = supabase.table("users").select("*").eq("email", req.email).execute()
    if not result.data:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user = result.data[0]
    if not verify_password(req.password, user["password"]):
        provider = user.get("auth_provider", "email")
        if provider in ("google", "facebook"):
            raise HTTPException(status_code=401, detail=f"This account was created with {provider.title()}. Please sign in with {provider.title()}, or use 'Forgot Password' to set a password.")
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.get("is_verified", False):
        raise HTTPException(status_code=403, detail="Please verify your email before signing in. Check your inbox for the verification link.")

    token = create_token(req.email)

    return {
        "token": token,
        "user": {
            "id": user["id"],
            "firstName": user["first_name"],
            "lastName": user["last_name"],
            "email": user["email"],
            "is_admin": user.get("is_admin", False),
            "auth_provider": user.get("auth_provider", "email")
        }
    }

# ── Social Auth ────────────────────────────────────────────────────────────────

class SocialAuthRequest(BaseModel):
    provider: str  # 'google' or 'facebook'
    token: str     # id_token (Google) or accessToken (Facebook)

@app.post("/api/auth/social")
def social_auth(req: SocialAuthRequest):
    email: str | None = None
    first_name = "User"
    last_name = ""

    if req.provider == "google":
        try:
            # Verify access_token by calling Google's userinfo endpoint
            r = _httpx.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {req.token}"},
                timeout=10
            )
            data = r.json()
            if r.status_code != 200 or "error" in data:
                raise HTTPException(status_code=401, detail="Invalid Google token. Please try again.")
            email      = data.get("email")
            first_name = data.get("given_name") or data.get("name", "User").split()[0]
            last_name  = data.get("family_name", "")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=401, detail="Google sign-in verification failed.")

    elif req.provider == "facebook":
        try:
            r = _httpx.get(
                "https://graph.facebook.com/me",
                params={"fields": "id,name,email,first_name,last_name", "access_token": req.token},
                timeout=10
            )
            data = r.json()
            if r.status_code != 200 or "error" in data:
                raise HTTPException(status_code=401, detail="Invalid Facebook token. Please try again.")
            email      = data.get("email")
            first_name = data.get("first_name") or data.get("name", "User").split()[0]
            last_name  = data.get("last_name", "")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=401, detail="Facebook sign-in verification failed.")

    else:
        raise HTTPException(status_code=400, detail="Unsupported provider.")

    if not email:
        raise HTTPException(
            status_code=400,
            detail="We could not retrieve your email from the provider. Please ensure your account has a verified email address."
        )

    # ── Find or create user ──────────────────────────────────────────────────
    existing = supabase.table("users").select("*").eq("email", email).execute()

    if existing.data:
        user = existing.data[0]
        # Auto-verify any account that signs in via trusted OAuth provider
        if not user.get("is_verified"):
            supabase.table("users").update({"is_verified": True}).eq("email", email).execute()
            user["is_verified"] = True
    else:
        # Create a new social user — no password needed, pre-verified
        random_pw = hash_password(secrets.token_urlsafe(32))
        result = supabase.table("users").insert({
            "email":         email,
            "password":      random_pw,
            "first_name":    first_name,
            "last_name":     last_name,
            "is_verified":   True,
            "auth_provider": req.provider
        }).execute()
        user = result.data[0]
        create_loyalty_account(email)

    # Issue app session token
    token = create_token(email)

    return {
        "token": token,
        "user": {
            "id":            user["id"],
            "firstName":     user["first_name"],
            "lastName":      user["last_name"],
            "email":         user["email"],
            "is_admin":      user.get("is_admin", False),
            "auth_provider": user.get("auth_provider", req.provider)
        }
    }


# ── Admin Routes ───────────────────────────────────────────────────────────────

def require_admin(token: str):
    email = resolve_token(token)
    if not email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    result = supabase.table("users").select("is_admin").eq("email", email).execute()
    if not result.data or not result.data[0].get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return email

@app.get("/api/admin/stats")
def admin_stats(token: str):
    require_admin(token)
    all_orders = supabase.table("orders").select("id, status, total, created_at").execute().data
    today = datetime.utcnow().strftime("%Y-%m-%d")
    total_orders = len(all_orders)
    today_orders = sum(1 for o in all_orders if o.get("created_at", "").startswith(today))
    pending_count = sum(1 for o in all_orders if o.get("status") in ("confirmed", "preparing"))
    revenue_total = sum(o.get("total", 0) for o in all_orders if o.get("status") != "cancelled")
    revenue_today = sum(o.get("total", 0) for o in all_orders if o.get("created_at", "").startswith(today) and o.get("status") != "cancelled")
    return {
        "total_orders": total_orders,
        "today_orders": today_orders,
        "pending_count": pending_count,
        "revenue_total": round(revenue_total, 2),
        "revenue_today": round(revenue_today, 2)
    }

@app.get("/api/admin/orders")
def admin_orders(token: str, status: str = None):
    require_admin(token)
    query = supabase.table("orders").select("*").order("created_at", desc=True)
    if status:
        query = query.eq("status", status)
    orders = query.execute().data
    if not orders:
        return []
    order_ids = [o["id"] for o in orders]
    items_result = supabase.table("order_items").select("*").in_("order_id", order_ids).execute()
    items_by_order: dict = {}
    for item in items_result.data:
        product = next((p for p in PRODUCTS if p["id"] == item["product_id"]), None)
        item["image"] = product["image"] if product else ""
        items_by_order.setdefault(item["order_id"], []).append(item)
    for order in orders:
        order["items"] = items_by_order.get(order["id"], [])
    return orders

@app.get("/api/admin/customers")
def admin_customers(token: str):
    require_admin(token)
    users = supabase.table("users").select("id, email, first_name, last_name, created_at, is_verified").order("created_at", desc=True).execute().data or []
    orders = supabase.table("orders").select("id, customer_email, total, status, created_at").execute().data or []
    order_map: dict = {}
    for o in orders:
        em = o["customer_email"]
        if em not in order_map:
            order_map[em] = {"count": 0, "total": 0.0, "last_order": ""}
        order_map[em]["count"] += 1
        if o.get("status") != "cancelled":
            order_map[em]["total"] += o.get("total", 0)
        if o.get("created_at", "") > order_map[em]["last_order"]:
            order_map[em]["last_order"] = o["created_at"]
    result = []
    for u in users:
        em = u["email"]
        stats = order_map.get(em, {"count": 0, "total": 0.0, "last_order": ""})
        result.append({**u, "order_count": stats["count"], "total_spent": round(stats["total"], 2), "last_order": stats["last_order"]})
    return result

@app.delete("/api/admin/customers/{email}")
def admin_delete_customer(email: str, token: str):
    admin_email = require_admin(token)
    if email == admin_email:
        raise HTTPException(status_code=400, detail="You can't delete your own account")
    rows = supabase.table("users").select("id, is_admin").eq("email", email).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Customer not found")
    if rows[0].get("is_admin"):
        raise HTTPException(status_code=400, detail="Cannot delete an admin account")
    # Remove the account + their active cart; orders/subscriptions stay as records.
    try:
        supabase.table("cart_items").delete().eq("user_id", rows[0].get("id")).execute()
    except Exception:
        pass
    supabase.table("users").delete().eq("email", email).execute()
    return {"status": "ok"}

@app.get("/api/admin/analytics")
def admin_analytics(token: str):
    require_admin(token)
    all_orders = supabase.table("orders").select("id, total, status, created_at").order("created_at", desc=True).execute().data or []
    now = datetime.now(timezone.utc)
    # Revenue last 30 days by day
    revenue_by_day: dict = {}
    for i in range(30):
        day = (now - timedelta(days=29 - i)).strftime("%Y-%m-%d")
        revenue_by_day[day] = 0.0
    for o in all_orders:
        if o.get("status") == "cancelled":
            continue
        day = (o.get("created_at") or "")[:10]
        if day in revenue_by_day:
            revenue_by_day[day] += o.get("total", 0)
    revenue_chart = [{"date": d, "revenue": round(v, 2)} for d, v in revenue_by_day.items()]
    # Top products
    all_items = supabase.table("order_items").select("product_id, name, quantity, price").execute().data or []
    product_totals: dict = {}
    for item in all_items:
        pid = item["product_id"]
        if pid not in product_totals:
            product_totals[pid] = {"name": item["name"], "qty": 0, "revenue": 0.0}
        product_totals[pid]["qty"] += item.get("quantity", 1)
        product_totals[pid]["revenue"] += item.get("price", 0) * item.get("quantity", 1)
    top_products = sorted(product_totals.values(), key=lambda x: x["revenue"], reverse=True)[:10]
    for p in top_products:
        p["revenue"] = round(p["revenue"], 2)
    # Peak hours (IST offset +5:30)
    hour_counts = [0] * 24
    for o in all_orders:
        ts = o.get("created_at")
        if ts:
            try:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                ist_hour = (dt.hour + 5) % 24  # rough IST
                hour_counts[ist_hour] += 1
            except Exception:
                pass
    peak_hours = [{"hour": i, "count": hour_counts[i]} for i in range(24)]
    return {"revenue_chart": revenue_chart, "top_products": top_products, "peak_hours": peak_hours}

@app.get("/api/admin/inventory")
def admin_inventory(token: str):
    require_admin(token)
    stock_rows = supabase.table("product_stock").select("*").execute().data or []
    stock_map = {r["product_id"]: r["stock"] for r in stock_rows}
    result = []
    for p in PRODUCTS:
        stock = stock_map.get(p["id"], 50)
        result.append({"id": p["id"], "name": p["name"], "category": p["category"], "price": p["price"], "stock": stock, "low_stock": stock < 10})
    return result

class StockUpdate(BaseModel):
    stock: int

@app.patch("/api/admin/inventory/{product_id}")
def update_stock(product_id: int, req: StockUpdate, token: str):
    require_admin(token)
    existing = supabase.table("product_stock").select("product_id").eq("product_id", product_id).execute()
    if existing.data:
        supabase.table("product_stock").update({"stock": req.stock}).eq("product_id", product_id).execute()
    else:
        supabase.table("product_stock").insert({"product_id": product_id, "stock": req.stock}).execute()
    return {"product_id": product_id, "stock": req.stock}

class DeliveryZoneCreate(BaseModel):
    zone_name: str
    areas: str
    delivery_charge: float
    min_order: float = 0
    active: bool = True

class DeliveryZoneUpdate(BaseModel):
    zone_name: Optional[str] = None
    areas: Optional[str] = None
    delivery_charge: Optional[float] = None
    min_order: Optional[float] = None
    active: Optional[bool] = None

@app.get("/api/admin/delivery-zones")
def list_delivery_zones(token: str):
    require_admin(token)
    return supabase.table("delivery_zones").select("*").order("zone_name").execute().data or []

@app.post("/api/admin/delivery-zones")
def create_delivery_zone(req: DeliveryZoneCreate, token: str):
    require_admin(token)
    result = supabase.table("delivery_zones").insert({
        "zone_name": req.zone_name, "areas": req.areas,
        "delivery_charge": req.delivery_charge, "min_order": req.min_order, "active": req.active
    }).execute()
    return result.data[0]

@app.patch("/api/admin/delivery-zones/{zone_id}")
def update_delivery_zone(zone_id: int, req: DeliveryZoneUpdate, token: str):
    require_admin(token)
    update_data = {k: v for k, v in req.model_dump().items() if v is not None}
    result = supabase.table("delivery_zones").update(update_data).eq("id", zone_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Zone not found")
    return result.data[0]

@app.delete("/api/admin/delivery-zones/{zone_id}")
def delete_delivery_zone(zone_id: int, token: str):
    require_admin(token)
    supabase.table("delivery_zones").delete().eq("id", zone_id).execute()
    return {"status": "ok"}

# ── Admin: Promo Codes (Supabase) ─────────────────────────────────────────────

@app.get("/api/admin/promo-codes")
def list_promo_codes(token: str):
    require_admin(token)
    result = supabase.table("promo_codes").select("*").order("created_at", desc=True).execute()
    return result.data

@app.post("/api/admin/promo-codes")
def create_promo_code(req: PromoCodeCreate, token: str):
    require_admin(token)
    code = req.code.strip().upper()
    existing = supabase.table("promo_codes").select("code").eq("code", code).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Promo code already exists")
    result = supabase.table("promo_codes").insert({
        "code": code, "type": req.type, "value": float(req.value),
        "description": req.description, "first_order_only": req.first_order_only,
        "min_order": float(req.min_order), "active": req.active
    }).execute()
    return result.data[0]

@app.put("/api/admin/promo-codes/{code}")
def update_promo_code(code: str, req: PromoCodeCreate, token: str):
    require_admin(token)
    code = code.strip().upper()
    result = supabase.table("promo_codes").update({
        "type": req.type, "value": float(req.value), "description": req.description,
        "first_order_only": req.first_order_only, "min_order": float(req.min_order),
        "active": req.active
    }).eq("code", code).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Promo code not found")
    return result.data[0]

@app.delete("/api/admin/promo-codes/{code}")
def delete_promo_code(code: str, token: str):
    require_admin(token)
    code = code.strip().upper()
    result = supabase.table("promo_codes").delete().eq("code", code).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Promo code not found")
    return {"status": "ok"}

# ── Admin: Seasonal Offers (Supabase) ────────────────────────────────────────

@app.get("/api/admin/seasonal-offers")
def list_seasonal_offers(token: str):
    require_admin(token)
    result = supabase.table("seasonal_offers").select("*").order("created_at", desc=True).execute()
    return result.data

@app.post("/api/admin/seasonal-offers")
def create_seasonal_offer(req: SeasonalOfferCreate, token: str):
    require_admin(token)
    new_id = req.title.lower().replace(" ", "_")
    # Ensure unique id
    existing = supabase.table("seasonal_offers").select("id").execute()
    existing_ids = {o["id"] for o in existing.data}
    counter = 1
    base_id = new_id
    while new_id in existing_ids:
        new_id = f"{base_id}_{counter}"
        counter += 1
    result = supabase.table("seasonal_offers").insert({
        "id": new_id, "emoji": req.emoji, "title": req.title,
        "subtitle": req.subtitle, "code": req.code.strip().upper(), "badge": req.badge
    }).execute()
    return result.data[0]

@app.put("/api/admin/seasonal-offers/{offer_id}")
def update_seasonal_offer(offer_id: str, req: SeasonalOfferCreate, token: str):
    require_admin(token)
    result = supabase.table("seasonal_offers").update({
        "emoji": req.emoji, "title": req.title, "subtitle": req.subtitle,
        "code": req.code.strip().upper(), "badge": req.badge
    }).eq("id", offer_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Offer not found")
    return result.data[0]

@app.delete("/api/admin/seasonal-offers/{offer_id}")
def delete_seasonal_offer(offer_id: str, token: str):
    require_admin(token)
    result = supabase.table("seasonal_offers").delete().eq("id", offer_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Offer not found")
    return {"status": "ok"}

# ── Admin: Bundle Deals (Supabase) ───────────────────────────────────────────

@app.get("/api/admin/bundle-deals")
def list_bundle_deals(token: str):
    require_admin(token)
    result = supabase.table("bundle_deals").select("*").order("created_at", desc=True).execute()
    return result.data

@app.post("/api/admin/bundle-deals")
def create_bundle_deal(req: BundleDealCreate, token: str):
    require_admin(token)
    new_id = req.name.lower().replace(" ", "_")
    existing = supabase.table("bundle_deals").select("id").execute()
    existing_ids = {b["id"] for b in existing.data}
    counter = 1
    base_id = new_id
    while new_id in existing_ids:
        new_id = f"{base_id}_{counter}"
        counter += 1
    result = supabase.table("bundle_deals").insert({
        "id": new_id, "name": req.name, "description": req.description,
        "emoji": req.emoji, "product_ids": req.product_ids,
        "promo_code": req.promo_code.strip().upper(), "savings_pct": float(req.savings_pct)
    }).execute()
    return result.data[0]

@app.put("/api/admin/bundle-deals/{deal_id}")
def update_bundle_deal(deal_id: str, req: BundleDealCreate, token: str):
    require_admin(token)
    result = supabase.table("bundle_deals").update({
        "name": req.name, "description": req.description, "emoji": req.emoji,
        "product_ids": req.product_ids, "promo_code": req.promo_code.strip().upper(),
        "savings_pct": float(req.savings_pct)
    }).eq("id", deal_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Bundle deal not found")
    return result.data[0]

@app.delete("/api/admin/bundle-deals/{deal_id}")
def delete_bundle_deal(deal_id: str, token: str):
    require_admin(token)
    result = supabase.table("bundle_deals").delete().eq("id", deal_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Bundle deal not found")
    return {"status": "ok"}

# ── Contact Route ──────────────────────────────────────────────────────────────

@app.post("/api/contact")
def submit_contact(req: ContactRequest):
    supabase.table("contacts").insert({
        "name": req.name,
        "email": req.email,
        "phone": req.phone,
        "subject": req.subject,
        "message": req.message
    }).execute()
    return {"message": "Message received successfully"}

# ── Loyalty Routes ─────────────────────────────────────────────────────────────

@app.get("/api/loyalty")
def get_loyalty(email: str):
    acct_result = supabase.table("loyalty_accounts").select("*").eq("user_email", email).execute()
    if not acct_result.data:
        raise HTTPException(status_code=404, detail="No loyalty account found")
    acct = acct_result.data[0]
    txn_result = supabase.table("loyalty_transactions").select("*").eq("user_email", email).order("created_at", desc=True).limit(20).execute()
    return {**acct, "transactions": txn_result.data}

# ── Promo Routes ───────────────────────────────────────────────────────────────

@app.post("/api/promo/validate")
def validate_promo(req: PromoValidateRequest):
    code = req.code.strip().upper()
    result = supabase.table("promo_codes").select("*").eq("code", code).execute()
    if not result.data or not result.data[0]["active"]:
        raise HTTPException(status_code=404, detail="Invalid promo code")
    promo = result.data[0]
    if req.order_total < float(promo["min_order"]):
        raise HTTPException(status_code=400, detail=f"Minimum order ₹{promo['min_order']} required for this code")
    if promo["first_order_only"]:
        if not req.customer_email:
            raise HTTPException(status_code=400, detail="Code valid for first order only")
        existing_orders = supabase.table("orders").select("id").eq("customer_email", req.customer_email).execute()
        if existing_orders.data:
            raise HTTPException(status_code=400, detail="Code valid for first order only")
    if promo["type"] == "percent":
        discount_amount = round(req.order_total * float(promo["value"]) / 100, 2)
    else:
        discount_amount = min(float(promo["value"]), req.order_total)
    return {
        "valid": True,
        "code": code,
        "discount_type": promo["type"],
        "discount_value": promo["value"],
        "discount_amount": discount_amount,
        "description": promo["description"]
    }

_DEFAULT_DEAL_EMOJI = "🎟️"

def _enrich_bundles(bundles: list) -> list:
    enriched = []
    for bundle in bundles:
        product_ids = bundle["product_ids"]
        products = [p for p in PRODUCTS if p["id"] in product_ids]
        products_ordered = sorted(products, key=lambda p: product_ids.index(p["id"]))
        original_price = sum(p["price"] for p in products_ordered)
        savings_pct = float(bundle["savings_pct"])
        bundle_price = round(original_price * (1 - savings_pct / 100), 2)
        enriched.append({
            **bundle,
            "products": products_ordered,
            "original_price": round(original_price, 2),
            "bundle_price": bundle_price,
            "savings_amount": round(original_price - bundle_price, 2),
            "item_count": len(products_ordered),
        })
    return enriched

def _deal_from_promo(promo: dict, offer: dict | None) -> dict:
    """Build a home-page live-deal card from a promo code, using a curated
    seasonal_offer for display data when one exists (else sensible defaults)."""
    return {
        "id": offer["id"] if offer else promo["code"].lower(),
        "emoji": offer["emoji"] if offer else _DEFAULT_DEAL_EMOJI,
        "title": offer["title"] if offer else promo["code"],
        "subtitle": offer["subtitle"] if offer else promo.get("description", ""),
        "code": promo["code"],
        "badge": offer["badge"] if offer else "Deal",
        "discount_type": promo["type"],
        "discount_value": float(promo["value"]),
        "min_order": float(promo["min_order"]),
        "first_order_only": promo["first_order_only"],
    }

@app.get("/api/offers")
def get_offers(email: Optional[str] = None):
    offers = supabase.table("seasonal_offers").select("*").execute().data or []
    bundles = supabase.table("bundle_deals").select("*").execute().data or []
    promos = supabase.table("promo_codes").select("*").execute().data or []

    # Has this customer already ordered? Used to hide first-order-only deals.
    has_ordered = False
    if email:
        try:
            prior = (supabase.table("orders").select("id")
                     .eq("customer_email", email).neq("status", "cancelled")
                     .limit(1).execute().data)
            has_ordered = bool(prior)
        except Exception:
            has_ordered = False

    # Show a live deal for every ACTIVE promo code. Curated seasonal_offers
    # (in their stored order) come first; remaining active codes are appended.
    offer_by_code = {o["code"]: o for o in offers}
    active_promos = [p for p in promos if p.get("active")]
    promo_by_code = {p["code"]: p for p in active_promos}

    live_deals, used = [], set()
    for o in offers:
        promo = promo_by_code.get(o["code"])
        if not promo or promo["code"] in used:
            continue
        used.add(promo["code"])
        if promo["first_order_only"] and has_ordered:
            continue
        live_deals.append(_deal_from_promo(promo, o))
    for promo in active_promos:
        if promo["code"] in used:
            continue
        used.add(promo["code"])
        if promo["first_order_only"] and has_ordered:
            continue
        live_deals.append(_deal_from_promo(promo, offer_by_code.get(promo["code"])))

    return {"seasonal_offers": live_deals, "bundle_deals": _enrich_bundles(bundles)}

# ── Cart Routes ─────────────────────────────────────────────────────────────────

@app.get("/api/cart")
def get_cart(user_id: str):
    result = supabase.table("cart_items").select("*").eq("user_id", user_id).execute()
    cart = []
    for item in result.data:
        product = next((p for p in PRODUCTS if p["id"] == item["product_id"]), None)
        if product:
            cart.append({"product": product, "quantity": item["quantity"]})
    return cart

@app.post("/api/cart/item")
def upsert_cart_item(req: CartItemRequest):
    existing = supabase.table("cart_items").select("*").eq("user_id", req.user_id).eq("product_id", req.product_id).execute()
    if existing.data:
        supabase.table("cart_items").update({"quantity": req.quantity}).eq("user_id", req.user_id).eq("product_id", req.product_id).execute()
    else:
        supabase.table("cart_items").insert({"user_id": req.user_id, "product_id": req.product_id, "quantity": req.quantity}).execute()
    return {"status": "ok"}

@app.delete("/api/cart/item/{product_id}")
def remove_cart_item(product_id: int, user_id: str):
    supabase.table("cart_items").delete().eq("user_id", user_id).eq("product_id", product_id).execute()
    return {"status": "ok"}

@app.delete("/api/cart/clear")
def clear_cart(user_id: str):
    supabase.table("cart_items").delete().eq("user_id", user_id).execute()
    return {"status": "ok"}

# ── Orders Route ───────────────────────────────────────────────────────────────

@app.get("/api/orders")
def get_user_orders(email: str, token: str = None):
    # Prefer user_id lookup (survives email changes); fall back to email for old orders
    if token:
        token_email = resolve_token(token)
        if token_email:
            u = supabase.table("users").select("id").eq("email", token_email).execute()
            if u.data:
                uid = u.data[0]["id"]
                orders_result = supabase.table("orders").select("*").eq("user_id", uid).order("created_at", desc=True).execute()
                if orders_result.data:
                    orders = orders_result.data
                    order_ids = [o["id"] for o in orders]
                    items_result = supabase.table("order_items").select("*").in_("order_id", order_ids).execute()
                    items_by_order: dict = {}
                    for item in items_result.data:
                        product = next((p for p in PRODUCTS if p["id"] == item["product_id"]), None)
                        item["image"] = product["image"] if product else ""
                        items_by_order.setdefault(item["order_id"], []).append(item)
                    for o in orders:
                        o["items"] = items_by_order.get(o["id"], [])
                        o["notifications"] = []
                    return orders
    orders_result = supabase.table("orders").select("*").eq("customer_email", email).order("created_at", desc=True).execute()
    orders = orders_result.data
    if not orders:
        return []
    order_ids = [o["id"] for o in orders]
    items_result = supabase.table("order_items").select("*").in_("order_id", order_ids).execute()
    items_by_order: dict = {}
    for item in items_result.data:
        product = next((p for p in PRODUCTS if p["id"] == item["product_id"]), None)
        item["image"] = product["image"] if product else ""
        items_by_order.setdefault(item["order_id"], []).append(item)
    notifs_by_order: dict = {}
    try:
        notifs_result = supabase.table("order_notifications").select("id, order_id, channel, status, sent_at").in_("order_id", order_ids).order("sent_at").execute()
        for n in notifs_result.data:
            notifs_by_order.setdefault(n["order_id"], []).append({
                "id": n["id"], "channel": n["channel"], "status": n["status"], "sent_at": n["sent_at"]
            })
    except Exception:
        pass
    for order in orders:
        order["items"] = items_by_order.get(order["id"], [])
        order["notifications"] = notifs_by_order.get(order["id"], [])
    return orders

@app.get("/api/orders/{order_id}")
def get_order(order_id: str):
    result = supabase.table("orders").select("*").eq("id", order_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Order not found")
    order = result.data[0]
    items_result = supabase.table("order_items").select("*").eq("order_id", order_id).execute()
    items = items_result.data
    for item in items:
        product = next((p for p in PRODUCTS if p["id"] == item["product_id"]), None)
        item["image"] = product["image"] if product else ""
    order["items"] = items
    try:
        notifs_result = supabase.table("order_notifications").select("id, order_id, channel, status, sent_at").eq("order_id", order_id).order("sent_at").execute()
        order["notifications"] = [{"id": n["id"], "channel": n["channel"], "status": n["status"], "sent_at": n["sent_at"]} for n in notifs_result.data]
    except Exception:
        order["notifications"] = []
    return order

@app.patch("/api/orders/{order_id}/delivery")
def update_delivery(order_id: str, req: UpdateDeliveryRequest):
    result = supabase.table("orders").select("status").eq("id", order_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Order not found")
    if result.data[0]["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="Cannot update delivery for a cancelled order")
    supabase.table("orders").update({
        "delivery_type": req.delivery_type,
        "delivery_datetime": req.delivery_datetime
    }).eq("id", order_id).execute()
    return {"status": "updated"}

@app.patch("/api/orders/{order_id}/cancel")
def cancel_order(order_id: str):
    result = supabase.table("orders").select("*").eq("id", order_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Order not found")
    order = result.data[0]
    # Customers can only cancel before we start packing; admins cancel via status update.
    if order["status"] != "confirmed":
        raise HTTPException(status_code=400, detail="This order is already being prepared. Please contact us to cancel.")
    supabase.table("orders").update({"status": "cancelled"}).eq("id", order_id).execute()
    send_notifications(order_id, "cancelled", order.get("customer_phone") or "")
    send_order_cancellation_email(order)
    return {"status": "cancelled"}

@app.patch("/api/orders/{order_id}/status")
def update_order_status(order_id: str, req: StatusUpdateRequest):
    result = supabase.table("orders").select("*").eq("id", order_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Order not found")
    order = result.data[0]
    allowed = VALID_STATUS_TRANSITIONS.get(order["status"], [])
    if req.status not in allowed:
        raise HTTPException(status_code=400, detail=f"Cannot transition from '{order['status']}' to '{req.status}'")
    supabase.table("orders").update({"status": req.status}).eq("id", order_id).execute()
    send_notifications(order_id, req.status, order.get("customer_phone") or "")
    if req.status in ORDER_STATUS_NOTICE:
        title, phrase = ORDER_STATUS_NOTICE[req.status]
        summary = order_items_summary(order_id)
        detail = f" ({summary})" if summary else ""
        create_user_notice(order.get("customer_email"), title,
                            f"Your order {order_id}{detail} {phrase}.", "order", order_id)
    return {"status": req.status}

# ── User notices (messages the customer sees in their account) ──────────────────

def create_user_notice(email: Optional[str], title: str, message: str, ref_type: str, ref_id: str):
    if not email:
        return
    try:
        supabase.table("user_notices").insert({
            "id": "NTC" + str(uuid.uuid4())[:8].upper(),
            "customer_email": email,
            "title": title,
            "message": message or "",
            "ref_type": ref_type,
            "ref_id": ref_id,
            "read": False,
        }).execute()
    except Exception:
        pass

def order_items_summary(order_id: str) -> str:
    """'Red Rose Bouquet (#1) ×2, Sunflower (#2) ×1' for an order."""
    try:
        items = supabase.table("order_items").select("product_id, name, quantity").eq("order_id", order_id).execute().data or []
        return ", ".join(f"{it.get('name')} (#{it.get('product_id')}) ×{it.get('quantity')}" for it in items)
    except Exception:
        return ""

def booking_items_summary(items) -> str:
    """Same for a Petal Studio booking's items JSON list."""
    return ", ".join(
        f"{it.get('product_name')} (#{it.get('product_id')}) ×{it.get('quantity')}"
        for it in (items or [])
    )

# Friendly status → notice text
ORDER_STATUS_NOTICE = {
    "preparing":        ("Order being prepared",   "is now being prepared 🌸"),
    "out_for_delivery": ("Order out for delivery",  "is out for delivery 🚚 — arriving today!"),
    "delivered":        ("Order delivered",         "has been delivered ✅ — we hope you love it!"),
    "cancelled":        ("Order cancelled",         "was cancelled"),
}
SUB_STATUS_NOTICE = {
    "paused":    ("Subscription paused",   "was paused by our team"),
    "active":    ("Subscription resumed",  "is active again 🌸"),
    "cancelled": ("Subscription cancelled", "was cancelled"),
}
BOOKING_STATUS_NOTICE = {
    "confirmed":  ("Booking confirmed",  "is confirmed ✅"),
    "preparing":  ("Booking in preparation", "is being prepared 🌸"),
    "completed":  ("Booking completed",  "is complete 🎉 — thank you!"),
    "cancelled":  ("Booking cancelled",  "was cancelled"),
}

@app.get("/api/notices")
def get_notices(email: str):
    try:
        # Retention: drop notices older than 3 months, then return the rest (newest first).
        cutoff = (datetime.utcnow() - timedelta(days=90)).isoformat()
        try:
            supabase.table("user_notices").delete().eq("customer_email", email).lt("created_at", cutoff).execute()
        except Exception:
            pass
        result = supabase.table("user_notices").select("*").eq("customer_email", email).order("created_at", desc=True).execute()
        return result.data or []
    except Exception:
        return []

@app.patch("/api/notices/read")
def mark_notices_read(email: str):
    try:
        supabase.table("user_notices").update({"read": True}).eq("customer_email", email).eq("read", False).execute()
    except Exception:
        pass
    return {"status": "ok"}

@app.delete("/api/notices/{notice_id}")
def delete_notice(notice_id: str, email: str):
    supabase.table("user_notices").delete().eq("id", notice_id).eq("customer_email", email).execute()
    return {"status": "ok"}

@app.delete("/api/admin/orders/{order_id}")
def admin_delete_order(order_id: str, token: str, reason: Optional[str] = None):
    require_admin(token)
    existing = supabase.table("orders").select("customer_email").eq("id", order_id).execute().data
    email = existing[0]["customer_email"] if existing else None
    summary = order_items_summary(order_id)
    supabase.table("order_items").delete().eq("order_id", order_id).execute()
    result = supabase.table("orders").delete().eq("id", order_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Order not found")
    detail = f" ({summary})" if summary else ""
    msg = f"Your order {order_id}{detail} was cancelled and removed by our team."
    if reason:
        msg += f" Reason: {reason}"
    create_user_notice(email, "Order removed", msg, "order", order_id)
    return {"status": "ok"}

@app.post("/api/orders")
def create_order(req: OrderRequest):
    order_id = "FLR" + str(uuid.uuid4())[:8].upper()
    customer_email = req.customer.get("email", "")

    next_recurrence_date = None
    if req.is_recurring and req.recurrence_type == "annual" and req.delivery_datetime:
        try:
            d = datetime.strptime(req.delivery_datetime[:10], "%Y-%m-%d")
            next_year = d.replace(year=d.year + 1)
            next_recurrence_date = next_year.strftime("%Y-%m-%d")
        except Exception:
            pass

    # Resolve user_id from token so orders survive email changes
    user_id = None
    if req.token:
        token_email = resolve_token(req.token)
        if token_email:
            u = supabase.table("users").select("id").eq("email", token_email).execute()
            if u.data:
                user_id = u.data[0]["id"]

    try:
        supabase.table("orders").insert({
            "id": order_id,
            "user_id": user_id,
            "customer_email": customer_email,
            "customer_name": req.customer.get("name", ""),
            "customer_phone": req.customer.get("phone", ""),
            "customer_address": ", ".join(filter(None, [
                req.customer.get("address", ""),
                req.customer.get("city", ""),
                req.customer.get("state", ""),
                req.customer.get("zip", ""),
            ])),
            "total": req.total,
            "status": "confirmed",
            "delivery_type": req.delivery_type,
            "delivery_datetime": req.delivery_datetime,
            "is_recurring": req.is_recurring,
            "recurrence_type": req.recurrence_type,
            "next_recurrence_date": next_recurrence_date,
            "payment_method": req.payment_method,
        }).execute()
    except Exception as e:
        print(f"Order insert error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    if req.items:
        supabase.table("order_items").insert([
            {
                "order_id": order_id,
                "product_id": item.productId,
                "name": item.name,
                "price": item.price,
                "quantity": item.quantity
            }
            for item in req.items
        ]).execute()

    points_earned = 0
    new_balance = 0

    if customer_email:
        # Deduct redeemed points if any
        points_redeemed = req.points_redeemed or 0
        if points_redeemed > 0:
            acct = supabase.table("loyalty_accounts").select("points_balance").eq("user_email", customer_email).execute()
            if acct.data and acct.data[0]["points_balance"] >= points_redeemed:
                award_points(customer_email, -points_redeemed, "redeemed", f"Points redeemed at checkout for order {order_id}", order_id)

        # Earn points: 1 pt per ₹1 of final total
        points_earned = int(req.total)
        award_points(customer_email, points_earned, "earned_purchase", f"Points earned for order {order_id}", order_id)

        # Check first-purchase referral bonus (150 pts to referrer)
        try:
            acct_row = supabase.table("loyalty_accounts").select("referred_by_code").eq("user_email", customer_email).execute()
            if acct_row.data and acct_row.data[0].get("referred_by_code"):
                referred_by_code = acct_row.data[0]["referred_by_code"]
                prior_purchases = supabase.table("loyalty_transactions").select("id").eq("user_email", customer_email).eq("type", "earned_purchase").execute()
                if len(prior_purchases.data) == 1:  # This is their first purchase
                    referrer_acct = supabase.table("loyalty_accounts").select("user_email").eq("referral_code", referred_by_code).execute()
                    if referrer_acct.data:
                        referrer_email = referrer_acct.data[0]["user_email"]
                        award_points(referrer_email, 150, "earned_referral_purchase", f"Referral first-purchase bonus — {customer_email} made their first order")
        except Exception:
            pass

        # Get updated balance
        try:
            updated = supabase.table("loyalty_accounts").select("points_balance").eq("user_email", customer_email).execute()
            if updated.data:
                new_balance = updated.data[0]["points_balance"]
        except Exception:
            pass

    # Send order confirmation email
    order_record = {
        "id": order_id,
        "customer_email": customer_email,
        "customer_name": req.customer.get("name", ""),
        "customer_address": ", ".join(filter(None, [
            req.customer.get("address", ""),
            req.customer.get("city", ""),
            req.customer.get("state", ""),
            req.customer.get("zip", ""),
        ])),
        "total": req.total,
        "delivery_type": req.delivery_type,
        "delivery_datetime": req.delivery_datetime,
        "payment_method": req.payment_method,
    }
    items_list = [
        {"name": item.name, "price": item.price, "quantity": item.quantity}
        for item in (req.items or [])
    ]
    send_order_confirmation_email(order_record, items_list)

    return {"orderId": order_id, "status": "confirmed", "points_earned": points_earned, "new_balance": new_balance}

# ── Subscription helpers ────────────────────────────────────────────────────────

def next_delivery_date(plan: str) -> str:
    days = plan_days(plan)
    return (datetime.utcnow() + timedelta(days=days)).strftime("%Y-%m-%d")

def advance_delivery_date(plan: str, current: str) -> str:
    days = plan_days(plan)
    try:
        base = datetime.strptime(current, "%Y-%m-%d")
    except Exception:
        base = datetime.utcnow()
    return (base + timedelta(days=days)).strftime("%Y-%m-%d")

# ── Subscription Plans (DB-backed config) ────────────────────────────────────────

class SubscriptionPlanUpdate(BaseModel):
    label: Optional[str] = None
    subtitle: Optional[str] = None
    discount_percent: Optional[float] = None

@app.get("/api/subscription-plans")
def get_subscription_plans():
    return SUBSCRIPTION_PLANS

@app.get("/api/admin/subscription-plans")
def admin_list_subscription_plans(token: str):
    require_admin(token)
    return SUBSCRIPTION_PLANS

@app.put("/api/admin/subscription-plans/{plan_id}")
def admin_update_subscription_plan(plan_id: str, req: SubscriptionPlanUpdate, token: str):
    require_admin(token)
    data = {k: v for k, v in req.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = supabase.table("subscription_plans").update(data).eq("id", plan_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Plan not found")
    load_subscription_plans()
    return next(p for p in SUBSCRIPTION_PLANS if p["id"] == plan_id)

# ── Subscription Routes ─────────────────────────────────────────────────────────
# Requires a `subscriptions` Supabase table with columns:
#   id text PK, customer_email text, customer_name text, plan text,
#   style text, fixed_product_id int4, fixed_product_name text,
#   status text, next_delivery text, address text,
#   skipped_count int4 default 0, created_at timestamptz default now()

@app.get("/api/subscriptions")
def get_subscriptions(email: str):
    result = supabase.table("subscriptions").select("*").eq("customer_email", email).order("created_at", desc=True).execute()
    return result.data

@app.get("/api/admin/subscriptions")
def admin_list_subscriptions(token: str):
    require_admin(token)
    result = supabase.table("subscriptions").select("*").order("created_at", desc=True).execute()
    return result.data or []

class AdminSubscriptionUpdate(BaseModel):
    status: Optional[str] = None
    plan: Optional[str] = None
    next_delivery: Optional[str] = None
    address: Optional[str] = None
    customer_phone: Optional[str] = None
    instructions: Optional[str] = None
    admin_message: Optional[str] = None

@app.put("/api/admin/subscriptions/{sub_id}")
def admin_update_subscription(sub_id: str, req: AdminSubscriptionUpdate, token: str):
    require_admin(token)
    prev = supabase.table("subscriptions").select("status, customer_email").eq("id", sub_id).execute().data
    prev_status = prev[0]["status"] if prev else None
    email = prev[0]["customer_email"] if prev else None

    data = {k: v for k, v in req.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = supabase.table("subscriptions").update(data).eq("id", sub_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Subscription not found")

    if req.status and req.status != prev_status and req.status in SUB_STATUS_NOTICE:
        title, phrase = SUB_STATUS_NOTICE[req.status]
        msg = f"Your Bloom Plan subscription {sub_id} {phrase}."
        if req.status == "cancelled" and req.admin_message:
            msg += f" Reason: {req.admin_message}"
        create_user_notice(email, title, msg, "subscription", sub_id)
    return result.data[0]

@app.delete("/api/admin/subscriptions/{sub_id}")
def admin_delete_subscription(sub_id: str, token: str, reason: Optional[str] = None):
    require_admin(token)
    existing = supabase.table("subscriptions").select("customer_email, items").eq("id", sub_id).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Subscription not found")
    email = existing[0].get("customer_email")
    summary = booking_items_summary(existing[0].get("items"))
    # Soft-cancel: keep the record so the customer still sees it with the message.
    supabase.table("subscriptions").update({"status": "cancelled", "admin_message": reason}).eq("id", sub_id).execute()
    detail = f" ({summary})" if summary else ""
    msg = f"Your Bloom Plan subscription {sub_id}{detail} was cancelled by our team."
    if reason:
        msg += f" Reason: {reason}"
    create_user_notice(email, "Subscription cancelled", msg, "subscription", sub_id)
    return {"status": "cancelled"}

@app.post("/api/subscriptions")
def create_subscription(req: SubscriptionRequest):
    sub_id = "SUB" + str(uuid.uuid4())[:8].upper()
    # "florist" = let us pick (no items); otherwise a custom hand-picked set
    first = req.items[0] if req.items else None
    supabase.table("subscriptions").insert({
        "id": sub_id,
        "customer_email": req.customer_email,
        "customer_name": req.customer_name,
        "customer_phone": req.customer_phone,
        "plan": req.plan,
        "style": "custom" if req.items else "florist",
        "fixed_product_id": (first or {}).get("product_id"),
        "fixed_product_name": (first or {}).get("product_name"),
        "items": req.items,                       # full list — what to deliver
        "instructions": req.instructions,
        "daily_total": req.daily_total,
        "grand_total": req.grand_total,
        "discount_percent": req.discount_percent,
        "status": "active",
        "next_delivery": next_delivery_date(req.plan),
        "address": req.address,
        "skipped_count": 0,
    }).execute()
    return {"id": sub_id, "status": "active", "next_delivery": next_delivery_date(req.plan)}

@app.patch("/api/subscriptions/{sub_id}/pause")
def pause_subscription(sub_id: str):
    result = supabase.table("subscriptions").select("id").eq("id", sub_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Subscription not found")
    supabase.table("subscriptions").update({"status": "paused"}).eq("id", sub_id).execute()
    return {"status": "paused"}

@app.patch("/api/subscriptions/{sub_id}/resume")
def resume_subscription(sub_id: str):
    result = supabase.table("subscriptions").select("id").eq("id", sub_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Subscription not found")
    supabase.table("subscriptions").update({"status": "active"}).eq("id", sub_id).execute()
    return {"status": "active"}

@app.patch("/api/subscriptions/{sub_id}/skip")
def skip_subscription(sub_id: str):
    result = supabase.table("subscriptions").select("*").eq("id", sub_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Subscription not found")
    sub = result.data[0]
    new_date = advance_delivery_date(sub["plan"], sub["next_delivery"])
    new_count = (sub.get("skipped_count") or 0) + 1
    supabase.table("subscriptions").update({"next_delivery": new_date, "skipped_count": new_count}).eq("id", sub_id).execute()
    return {"status": "skipped", "next_delivery": new_date}

@app.patch("/api/subscriptions/{sub_id}/cancel")
def cancel_subscription(sub_id: str):
    result = supabase.table("subscriptions").select("id").eq("id", sub_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Subscription not found")
    supabase.table("subscriptions").update({"status": "cancelled"}).eq("id", sub_id).execute()
    return {"status": "cancelled"}

# ── Reminders Route ─────────────────────────────────────────────────────────────

@app.post("/api/reminders/send")
def send_reminders(days: str = "3,1"):
    today = datetime.utcnow().date()
    day_offsets = [int(d.strip()) for d in days.split(",") if d.strip().isdigit()]
    total_sent = 0
    summary = []

    for n in day_offsets:
        target_date = (today + timedelta(days=n)).strftime("%Y-%m-%d")
        reminder_type = f"{n}_day"

        # Upcoming scheduled deliveries (non-cancelled, non-delivered)
        scheduled = supabase.table("orders") \
            .select("*").like("delivery_datetime", f"{target_date}%") \
            .not_.in_("status", ["cancelled", "delivered"]).execute().data or []

        # Annual recurrences due (status=delivered, is_recurring=True)
        recurrence = supabase.table("orders") \
            .select("*").eq("next_recurrence_date", target_date) \
            .eq("is_recurring", True).eq("status", "delivered").execute().data or []

        for order, is_recurrence in [*[(o, False) for o in scheduled],
                                      *[(o, True) for o in recurrence]]:
            try:
                oid = order["id"]
                already = {r["channel"] for r in
                    (supabase.table("reminder_logs").select("channel")
                     .eq("order_id", oid).eq("reminder_type", reminder_type)
                     .execute().data or [])}

                # In-app notification for the upcoming delivery
                if "app" not in already:
                    timing = "tomorrow" if n == 1 else f"in {n} days"
                    verb = "recurring delivery is" if is_recurrence else "delivery is"
                    create_user_notice(
                        order.get("customer_email"),
                        f"🚚 Delivery {timing}",
                        f"Your order {oid} {verb} scheduled for {timing} ({target_date}).",
                        "order", oid,
                    )
                    supabase.table("reminder_logs").insert({
                        "order_id": oid, "reminder_type": reminder_type, "channel": "app"
                    }).execute()
                    total_sent += 1

                if "email" not in already:
                    if send_email_reminder(order, n, is_recurrence):
                        supabase.table("reminder_logs").insert({
                            "order_id": oid, "reminder_type": reminder_type, "channel": "email"
                        }).execute()
                        total_sent += 1

                res = send_sms_whatsapp_reminder(order, n, is_recurrence)
                for ch in ("sms", "whatsapp"):
                    if ch not in already and res.get(ch):
                        supabase.table("reminder_logs").insert({
                            "order_id": oid, "reminder_type": reminder_type, "channel": ch
                        }).execute()
                        total_sent += 1
            except Exception:
                pass  # one bad order never aborts the rest

        summary.append({"days_before": n, "target_date": target_date,
                         "scheduled": len(scheduled), "recurrence": len(recurrence)})

    return {"status": "ok", "total_reminders_sent": total_sent, "summary": summary}


# ── Smart Occasion Reminders ────────────────────────────────────────────────────

OCCASION_EMOJIS = {
    "birthday": "🎂", "anniversary": "💍", "valentine": "❤️",
    "mothers_day": "🌷", "fathers_day": "👔", "graduation": "🎓", "custom": "🎉"
}

class OccasionCreate(BaseModel):
    user_email: str
    title: str
    occasion_type: str = "custom"
    frequency: str = "yearly"          # yearly | monthly | weekly | biweekly
    month: int = 1
    day: int = 1
    weekday: Optional[int] = None       # 0=Sun .. 6=Sat (for weekly/biweekly)
    linked_order_id: Optional[str] = None
    notes: Optional[str] = None

class OccasionUpdate(BaseModel):
    title: Optional[str] = None
    occasion_type: Optional[str] = None
    frequency: Optional[str] = None
    month: Optional[int] = None
    day: Optional[int] = None
    weekday: Optional[int] = None
    linked_order_id: Optional[str] = None
    notes: Optional[str] = None

@app.get("/api/occasions")
def get_occasions(email: str):
    result = supabase.table("occasion_reminders").select("*").eq("user_email", email).order("month").order("day").execute()
    return result.data or []

@app.post("/api/occasions")
def create_occasion(req: OccasionCreate):
    result = supabase.table("occasion_reminders").insert(req.dict()).execute()
    return result.data[0]

@app.put("/api/occasions/{occasion_id}")
def update_occasion(occasion_id: str, req: OccasionUpdate):
    data = {k: v for k, v in req.dict().items() if v is not None}
    result = supabase.table("occasion_reminders").update(data).eq("id", occasion_id).execute()
    return result.data[0]

@app.delete("/api/occasions/{occasion_id}")
def delete_occasion(occasion_id: str):
    supabase.table("occasion_reminders").delete().eq("id", occasion_id).execute()
    return {"status": "deleted"}


def build_occasion_reminder_email(occasion: dict, days_before: int) -> str:
    title      = occasion.get("title", "Special Occasion")
    occ_type   = occasion.get("occasion_type", "custom")
    emoji      = OCCASION_EMOJIS.get(occ_type, "🎉")
    timing     = "tomorrow" if days_before == 1 else f"in {days_before} days"
    order_id   = occasion.get("linked_order_id")
    reorder_html = ""
    if order_id:
        reorder_url = f"{APP_URL}/orders/{order_id}"
        reorder_html = f"""
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:1.25rem;margin-bottom:1.25rem;">
        <div style="font-size:0.82rem;font-weight:700;color:#1d4ed8;margin-bottom:0.6rem;">🔁 Re-order Last Gift</div>
        <p style="color:#1e3a8a;font-size:0.88rem;margin:0 0 0.75rem;">
          You gifted flowers for this occasion before. Send the same arrangement again with one click.
        </p>
        <a href="{reorder_url}" style="display:inline-block;padding:0.6rem 1.4rem;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;
           text-decoration:none;border-radius:999px;font-weight:700;font-size:0.85rem;box-shadow:0 4px 12px rgba(37,99,235,0.35);">
          Re-order Now →
        </a>
      </div>"""
    shop_url = f"{APP_URL}"
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:540px;margin:2rem auto;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
    <div style="background:linear-gradient(135deg,#0f172a,#1e1b4b);padding:1.75rem 2rem;display:flex;align-items:center;gap:0.75rem;">
      <span style="font-size:1.6rem;">🌸</span>
      <div>
        <div style="color:white;font-size:1.1rem;font-weight:800;letter-spacing:0.01em;">VivaPetals</div>
        <div style="color:#94a3b8;font-size:0.8rem;margin-top:2px;">Smart Occasion Reminder</div>
      </div>
    </div>
    <div style="background:white;padding:2rem;">
      <div style="font-size:3rem;text-align:center;margin-bottom:0.5rem;">{emoji}</div>
      <h1 style="font-size:1.35rem;font-weight:800;color:#0f172a;text-align:center;margin:0 0 0.5rem;">
        {title} is {timing}!
      </h1>
      <p style="color:#64748b;font-size:0.92rem;line-height:1.6;text-align:center;margin:0 0 1.5rem;">
        Don't forget to make it special. Send fresh flowers and make someone's day unforgettable.
      </p>
      {reorder_html}
      <div style="text-align:center;margin-bottom:1.5rem;">
        <a href="{shop_url}" style="display:inline-block;padding:0.75rem 2rem;background:linear-gradient(135deg,#3b82f6,#1d4ed8);
           color:#fff;text-decoration:none;border-radius:999px;font-weight:700;font-size:0.95rem;
           box-shadow:0 4px 16px rgba(37,99,235,0.40);">
          Shop Fresh Flowers →
        </a>
      </div>
      <p style="color:#94a3b8;font-size:0.75rem;text-align:center;margin:0;">
        You're receiving this because you saved this date in VivaPetals Reminders.<br>
        <a href="{APP_URL}/reminders" style="color:#3b82f6;">Manage your reminders</a>
      </p>
    </div>
  </div>
</body>
</html>"""


def send_occasion_reminder_email(occasion: dict, days_before: int) -> bool:
    if not _resend_api_key:
        return False
    user_email = occasion.get("user_email", "")
    title      = occasion.get("title", "Special Occasion")
    timing     = "tomorrow" if days_before == 1 else f"in {days_before} days"
    try:
        _resend_lib.Emails.send({
            "from":    _reminder_from_email,
            "to":      [user_email],
            "subject": f"🌸 Reminder: {title} is {timing}!",
            "html":    build_occasion_reminder_email(occasion, days_before),
        })
        return True
    except Exception as e:
        print(f"[Occasion Reminder] Failed to send to {user_email}: {e}")
        return False


# Extend the existing /api/reminders/send to also process occasion reminders
# The enhanced version is handled by appending occasion logic inside the existing endpoint.
# We expose a dedicated endpoint so it can also be called standalone.

def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        return 31
    return (datetime(year, month + 1, 1) - timedelta(days=1)).day

def occasion_due(occ: dict, target) -> bool:
    """Is `occ` scheduled to occur on `target` (a date), given its frequency?"""
    freq = occ.get("frequency") or "yearly"
    if freq == "yearly":
        return occ.get("month") == target.month and occ.get("day") == target.day
    if freq == "monthly":
        d = min(occ.get("day") or 1, _days_in_month(target.year, target.month))
        return target.day == d
    if freq in ("weekly", "biweekly"):
        js_wd = (target.weekday() + 1) % 7          # Python Mon=0..Sun=6 → JS Sun=0..Sat=6
        if occ.get("weekday") != js_wd:
            return False
        if freq == "weekly":
            return True
        # biweekly: every other week, phased from the created date
        try:
            anchor = datetime.fromisoformat(occ["created_at"][:10]).date()
            return ((target - anchor).days // 7) % 2 == 0
        except Exception:
            return True
    return False

@app.post("/api/occasions/send-reminders")
def send_occasion_reminders(days: str = "3,1"):
    today      = datetime.utcnow().date()
    total_sent = 0
    occasions  = supabase.table("occasion_reminders").select("*").execute().data or []

    for occ in occasions:
        freq = occ.get("frequency") or "yearly"
        # Weekly/biweekly fire once (1 day before); dated occasions get 3- and 1-day nudges.
        offsets = [1] if freq in ("weekly", "biweekly") else [int(d.strip()) for d in days.split(",") if d.strip().isdigit()]
        for n in offsets:
            target = today + timedelta(days=n)
            if not occasion_due(occ, target):
                continue
            # Include the target date so recurring reminders aren't deduped across cycles.
            log_key = f"OCC-{occ['id']}-{target.isoformat()}"
            already = {r["channel"] for r in (
                supabase.table("reminder_logs").select("channel")
                .eq("order_id", log_key).eq("reminder_type", f"{n}_day")
                .execute().data or [])}
            timing = "tomorrow" if n == 1 else f"in {n} days"

            # In-app notification (shows in My Account → Notifications)
            if "app" not in already:
                create_user_notice(
                    occ.get("user_email"),
                    f"🔔 {occ.get('title')} is {timing}",
                    f"{occ.get('title')} is coming up {timing} — a lovely moment to send flowers 🌸.",
                    "reminder", occ["id"],
                )
                try:
                    supabase.table("reminder_logs").insert({
                        "order_id": log_key, "reminder_type": f"{n}_day", "channel": "app"
                    }).execute()
                except Exception:
                    pass
                total_sent += 1

            # Email reminder
            if "email" not in already:
                if send_occasion_reminder_email(occ, n):
                    try:
                        supabase.table("reminder_logs").insert({
                            "order_id": log_key, "reminder_type": f"{n}_day", "channel": "email"
                        }).execute()
                    except Exception:
                        pass

    return {"status": "ok", "occasion_reminders_sent": total_sent}


# ── Corporate Orders ────────────────────────────────────────────────────────────

class CorporateOrderRequest(BaseModel):
    company_name: Optional[str] = None
    event_type: Optional[str] = None
    theme: Optional[str] = None
    contact_name: str
    contact_email: str
    items: list[dict] = []            # [{product_id, product_name, unit_price, quantity}]
    # legacy single-product fields (kept optional for backward compatibility)
    product_id: Optional[int] = None
    product_name: Optional[str] = None
    unit_price: Optional[float] = None
    quantity: Optional[int] = None
    branding_logo_url: Optional[str] = None
    branding_message: Optional[str] = None
    delivery_address: str
    delivery_date: Optional[str] = None

def corp_discount(qty: int) -> int:
    if qty >= 50: return 15
    if qty >= 25: return 10
    if qty >= 10: return 5
    return 0

WEEKDAY_MAP = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6
}
CORP_FREQ_DAYS = {"weekly": 7, "biweekly": 14, "monthly": 30}

def next_corp_delivery(day: str, freq: str) -> str:
    today = datetime.utcnow().date()
    target = WEEKDAY_MAP.get(day.lower(), 0)
    days_ahead = (target - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7
    first = today + timedelta(days=days_ahead)
    if freq == "biweekly":
        first = first + timedelta(days=14)
    elif freq == "monthly":
        first = first + timedelta(days=30)
    return first.strftime("%Y-%m-%d")

def advance_corp_delivery(freq: str, current: str) -> str:
    days = CORP_FREQ_DAYS.get(freq, 7)
    try:
        base = datetime.strptime(current, "%Y-%m-%d")
    except Exception:
        base = datetime.utcnow()
    return (base + timedelta(days=days)).strftime("%Y-%m-%d")

@app.get("/api/corporate-orders")
def get_corporate_orders(email: str):
    result = supabase.table("corporate_orders").select("*").eq("contact_email", email).order("created_at", desc=True).execute()
    return result.data

@app.get("/api/admin/corporate-orders")
def admin_list_corporate_orders(token: str):
    require_admin(token)
    result = supabase.table("corporate_orders").select("*").order("created_at", desc=True).execute()
    return result.data or []

@app.delete("/api/admin/corporate-orders/{order_id}")
def admin_delete_corporate_order(order_id: str, token: str, reason: Optional[str] = None):
    require_admin(token)
    existing = supabase.table("corporate_orders").select("contact_email, items").eq("id", order_id).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Booking not found")
    email = existing[0].get("contact_email")
    summary = booking_items_summary(existing[0].get("items"))
    # Soft-cancel: keep the record (marked cancelled) so the customer still
    # sees it in My Studio with the admin's message.
    supabase.table("corporate_orders").update({"status": "cancelled", "admin_message": reason}).eq("id", order_id).execute()
    detail = f" ({summary})" if summary else ""
    msg = f"Your Petal Studio booking {order_id}{detail} was cancelled by our team."
    if reason:
        msg += f" Reason: {reason}"
    create_user_notice(email, "Booking cancelled", msg, "booking", order_id)
    return {"status": "cancelled"}

class CorporateStatusUpdate(BaseModel):
    status: str
    admin_message: Optional[str] = None

@app.patch("/api/admin/corporate-orders/{order_id}/status")
def admin_update_corporate_status(order_id: str, req: CorporateStatusUpdate, token: str):
    require_admin(token)
    valid = {"pending", "confirmed", "preparing", "completed", "cancelled"}
    if req.status not in valid:
        raise HTTPException(status_code=400, detail="Invalid status")
    existing = supabase.table("corporate_orders").select("contact_email, items").eq("id", order_id).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Booking not found")
    email = existing[0].get("contact_email")

    update_fields = {"status": req.status}
    if req.status == "cancelled" and req.admin_message:
        update_fields["admin_message"] = req.admin_message
    supabase.table("corporate_orders").update(update_fields).eq("id", order_id).execute()

    if req.status in BOOKING_STATUS_NOTICE:
        title, phrase = BOOKING_STATUS_NOTICE[req.status]
        summary = booking_items_summary(existing[0].get("items"))
        detail = f" ({summary})" if summary else ""
        msg = f"Your Petal Studio booking {order_id}{detail} {phrase}."
        if req.status == "cancelled" and req.admin_message:
            msg += f" Reason: {req.admin_message}"
        create_user_notice(email, title, msg, "booking", order_id)
    return {"status": req.status}

@app.post("/api/corporate-orders")
def create_corporate_order(req: CorporateOrderRequest):
    order_id = "PS" + str(uuid.uuid4())[:8].upper()

    # Build the item list (multi-product), falling back to the legacy single product.
    items = req.items or []
    if not items and req.product_id is not None:
        items = [{
            "product_id": req.product_id, "product_name": req.product_name,
            "unit_price": req.unit_price or 0, "quantity": req.quantity or 0,
        }]

    total_quantity = sum(int(i.get("quantity", 0) or 0) for i in items)
    total_amount = round(sum(float(i.get("unit_price", 0) or 0) * int(i.get("quantity", 0) or 0) for i in items), 2)
    discount = corp_discount(total_quantity)
    final_amount = round(total_amount * (1 - discount / 100), 2)

    first = items[0] if items else {}
    summary_name = first.get("product_name") or "—"
    if len(items) > 1:
        summary_name += f" + {len(items) - 1} more"

    supabase.table("corporate_orders").insert({
        "id": order_id,
        "company_name": req.company_name,
        "event_type": req.event_type,
        "theme": req.theme,
        "contact_name": req.contact_name,
        "contact_email": req.contact_email,
        "items": items,
        "product_id": first.get("product_id"),
        "product_name": summary_name,
        "quantity": total_quantity,
        "unit_price": first.get("unit_price"),
        "discount_pct": discount,
        "total_amount": total_amount,
        "final_amount": final_amount,
        "branding_logo_url": req.branding_logo_url,
        "branding_message": req.branding_message,
        "delivery_address": req.delivery_address,
        "delivery_date": req.delivery_date,
        "is_recurring": False,
        "next_delivery": None,
        "status": "pending",
    }).execute()
    return {"id": order_id, "final_amount": final_amount, "next_delivery": None}

@app.patch("/api/corporate-orders/{order_id}/cancel")
def cancel_corporate_order(order_id: str):
    result = supabase.table("corporate_orders").select("id, status").eq("id", order_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Corporate order not found")
    # Customers can only cancel while still pending; once we've confirmed/started, admin only.
    if result.data[0]["status"] != "pending":
        raise HTTPException(status_code=400, detail="This booking is already being prepared. Please contact us to cancel.")
    supabase.table("corporate_orders").update({"status": "cancelled"}).eq("id", order_id).execute()
    return {"status": "cancelled"}

@app.patch("/api/corporate-orders/{order_id}/skip")
def skip_corporate_order(order_id: str):
    result = supabase.table("corporate_orders").select("*").eq("id", order_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Corporate order not found")
    order = result.data[0]
    if not order.get("is_recurring"):
        raise HTTPException(status_code=400, detail="Only recurring orders can be skipped")
    new_date = advance_corp_delivery(order.get("recurring_frequency", "weekly"), order.get("next_delivery") or "")
    supabase.table("corporate_orders").update({"next_delivery": new_date}).eq("id", order_id).execute()
    return {"next_delivery": new_date}


# ── Personalized Recommendations ────────────────────────────────────────────────

def _enrich_products(product_ids: list, counter: Counter = None) -> list:
    """Return full product dicts for given IDs, sorted by counter frequency if provided."""
    products = [p for p in PRODUCTS if p["id"] in product_ids]
    if counter:
        products.sort(key=lambda p: counter.get(p["id"], 0), reverse=True)
    return products

@app.get("/api/recommendations")
def get_recommendations(email: str = ""):
    response = {
        "based_on_last_order": {"reason": "", "products": []},
        "popular_in_city":     {"city": "",   "products": []},
        "trending_this_week":  {"products": []},
    }

    # ── Trending this week (always computed) ────────────────────────────────────
    try:
        week_ago = (datetime.utcnow() - timedelta(days=7)).isoformat()
        recent_orders = (supabase.table("orders").select("id")
                         .gte("created_at", week_ago).neq("status", "cancelled")
                         .execute().data or [])
        if recent_orders:
            ids = [o["id"] for o in recent_orders]
            items = (supabase.table("order_items").select("product_id")
                     .in_("order_id", ids).execute().data or [])
            counter = Counter(it["product_id"] for it in items)
            top_ids = set(pid for pid, _ in counter.most_common(8))
            response["trending_this_week"]["products"] = _enrich_products(top_ids, counter)[:6]
    except Exception as e:
        print(f"[Recommendations] trending error: {e}")

    # Fallback: top-rated products if no order data yet
    if not response["trending_this_week"]["products"]:
        response["trending_this_week"]["products"] = sorted(
            [p for p in PRODUCTS if p.get("inStock")],
            key=lambda p: p.get("rating", 0), reverse=True
        )[:6]

    if not email:
        return response

    # ── Based on last order + city (requires email) ──────────────────────────────
    try:
        user_orders = (supabase.table("orders").select("id, customer_address")
                       .eq("customer_email", email).neq("status", "cancelled")
                       .order("created_at", desc=True).limit(1).execute().data or [])

        if user_orders:
            last_order = user_orders[0]
            last_id = last_order["id"]

            last_items = (supabase.table("order_items").select("product_id, name")
                          .eq("order_id", last_id).execute().data or [])
            ordered_ids = {it["product_id"] for it in last_items}
            sample_names = [it["name"] for it in last_items[:2]]

            # Find categories of what they ordered
            ordered_categories = {
                p["category"] for p in PRODUCTS if p["id"] in ordered_ids
            }

            if ordered_categories:
                similar = [
                    p for p in PRODUCTS
                    if p["category"] in ordered_categories
                    and p["id"] not in ordered_ids
                    and p.get("inStock")
                ]
                similar.sort(key=lambda p: p.get("rating", 0), reverse=True)
                names_str = " & ".join(sample_names) if sample_names else "your last order"
                response["based_on_last_order"]["reason"] = f"Because you ordered {names_str}"
                response["based_on_last_order"]["products"] = similar[:6]

            # ── Popular in their city ────────────────────────────────────────────
            address = last_order.get("customer_address", "")
            parts = [p.strip() for p in address.split(",")]
            city = parts[1] if len(parts) >= 2 else ""

            if city:
                city_orders = (supabase.table("orders").select("id")
                               .ilike("customer_address", f"%{city}%")
                               .neq("status", "cancelled").execute().data or [])
                if city_orders:
                    city_ids = [o["id"] for o in city_orders]
                    city_items = (supabase.table("order_items").select("product_id")
                                  .in_("order_id", city_ids).execute().data or [])
                    city_counter = Counter(it["product_id"] for it in city_items)
                    top_city = set(pid for pid, _ in city_counter.most_common(8))
                    response["popular_in_city"]["city"] = city
                    response["popular_in_city"]["products"] = _enrich_products(top_city, city_counter)[:6]

    except Exception as e:
        print(f"[Recommendations] personalized error: {e}")

    return response


# ── Product Reviews ──────────────────────────────────────────────────────────────

class ReviewCreate(BaseModel):
    product_id: int
    user_email: str
    author_name: str
    rating: int
    review_text: str
    photo_b64_list: list[str] = []

@app.get("/api/reviews")
def get_reviews(product_id: int):
    try:
        reviews = (supabase.table("product_reviews").select("*")
                   .eq("product_id", product_id)
                   .order("created_at", desc=True).execute().data or [])
        return reviews
    except Exception:
        return []

@app.get("/api/reviews/can-review")
def can_review_check(product_id: int, email: str = ""):
    if not email:
        return {"can_review": False, "has_purchased": False, "already_reviewed": False}
    try:
        user_orders = (supabase.table("orders").select("id")
                       .eq("customer_email", email).neq("status", "cancelled")
                       .execute().data or [])
        has_purchased = False
        if user_orders:
            oids = [o["id"] for o in user_orders]
            bought = (supabase.table("order_items").select("id")
                      .eq("product_id", product_id).in_("order_id", oids)
                      .limit(1).execute().data or [])
            has_purchased = len(bought) > 0

        existing = (supabase.table("product_reviews").select("id")
                    .eq("product_id", product_id).eq("user_email", email)
                    .limit(1).execute().data or [])
        already_reviewed = len(existing) > 0

        return {
            "can_review": not already_reviewed,
            "has_purchased": has_purchased,
            "already_reviewed": already_reviewed
        }
    except Exception:
        return {"can_review": True, "has_purchased": False, "already_reviewed": False}

@app.post("/api/reviews")
def create_review(req: ReviewCreate):
    if not (1 <= req.rating <= 5):
        raise HTTPException(status_code=422, detail="Rating must be 1–5")
    if not req.review_text.strip():
        raise HTTPException(status_code=422, detail="Review text is required")

    # Prevent duplicate reviews
    existing = (supabase.table("product_reviews").select("id")
                .eq("product_id", req.product_id).eq("user_email", req.user_email)
                .limit(1).execute().data or [])
    if existing:
        raise HTTPException(status_code=409, detail="You have already reviewed this product")

    # Verified purchase check
    has_purchased = False
    if req.user_email:
        try:
            user_orders = (supabase.table("orders").select("id")
                           .eq("customer_email", req.user_email).neq("status", "cancelled")
                           .execute().data or [])
            if user_orders:
                oids = [o["id"] for o in user_orders]
                bought = (supabase.table("order_items").select("id")
                          .eq("product_id", req.product_id).in_("order_id", oids)
                          .limit(1).execute().data or [])
                has_purchased = len(bought) > 0
        except Exception:
            pass

    # Upload photos to Supabase Storage
    photo_urls = []
    for i, b64_str in enumerate(req.photo_b64_list[:3]):
        try:
            img_bytes = _base64.b64decode(b64_str)
            path = f"{uuid.uuid4()}/{i}.jpg"
            supabase.storage.from_("review-photos").upload(
                path, img_bytes, {"content-type": "image/jpeg"}
            )
            url = supabase.storage.from_("review-photos").get_public_url(path)
            photo_urls.append(url)
        except Exception as e:
            print(f"[Reviews] Photo upload skipped: {e}")

    review_id = str(uuid.uuid4())
    result = supabase.table("product_reviews").insert({
        "id": review_id,
        "product_id": req.product_id,
        "user_email": req.user_email,
        "author_name": req.author_name,
        "rating": req.rating,
        "review_text": req.review_text.strip(),
        "photo_urls": photo_urls,
        "verified_purchase": has_purchased,
    }).execute()

    return result.data[0] if result.data else {"id": review_id}


# ── Daily reminder scheduler ──────────────────────────────────────────────────
def _run_daily_reminders():
    try:
        send_occasion_reminders()
    except Exception as e:
        print(f"[scheduler] occasion reminders error: {e}")
    try:
        send_reminders()
    except Exception as e:
        print(f"[scheduler] order reminders error: {e}")

@app.on_event("startup")
def start_scheduler():
    scheduler = BackgroundScheduler(timezone="Asia/Kolkata")
    # Run every day at 8:00 AM IST
    scheduler.add_job(_run_daily_reminders, "cron", hour=8, minute=0)
    scheduler.start()
    print("[scheduler] Daily reminder job scheduled at 08:00 IST")
