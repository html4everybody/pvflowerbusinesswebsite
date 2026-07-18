from fastapi import FastAPI, HTTPException, File, UploadFile

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

# ── Geocoding (OpenStreetMap Nominatim — free, no API key/card required) ─────
# Proxied through our own backend rather than called directly from the
# browser: lets us set a proper identifying User-Agent (Nominatim's usage
# policy asks for one; browsers won't let JS override that header), and
# gives us one place to centralize the "max ~1 req/sec" courtesy limit their
# free service asks for, instead of every visitor's browser hitting it raw.
_NOMINATIM_BASE = "https://nominatim.openstreetmap.org"
_NOMINATIM_HEADERS = {"User-Agent": "VivaPetals-FlowerDelivery/1.0 (contact via vivapetals.com)"}

def _parse_nominatim_address(item: dict) -> dict:
    addr = item.get("address", {}) or {}
    line1 = ", ".join(filter(None, [addr.get("house_number"), addr.get("road") or addr.get("pedestrian"), addr.get("suburb")]))
    city = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("municipality") or addr.get("county") or ""
    return {
        "display_name": item.get("display_name", ""),
        "address": line1 or item.get("display_name", "").split(",")[0],
        "city": city,
        "state": addr.get("state", ""),
        "pincode": addr.get("postcode", ""),
        "latitude": float(item["lat"]) if item.get("lat") else None,
        "longitude": float(item["lon"]) if item.get("lon") else None,
    }

@app.get("/api/geocode/search")
def geocode_search(q: str):
    q = (q or "").strip()
    if len(q) < 3:
        return []
    try:
        with _httpx.Client(timeout=6) as client:
            resp = client.get(f"{_NOMINATIM_BASE}/search", headers=_NOMINATIM_HEADERS, params={
                "format": "jsonv2", "addressdetails": 1, "limit": 6, "countrycodes": "in", "q": q,
            })
        resp.raise_for_status()
        return [_parse_nominatim_address(item) for item in resp.json()]
    except Exception as e:
        print(f"[Geocode] search failed: {e}", flush=True)
        raise HTTPException(status_code=502, detail="Location search is temporarily unavailable.")

@app.get("/api/geocode/reverse")
def geocode_reverse(lat: float, lon: float):
    try:
        with _httpx.Client(timeout=6) as client:
            resp = client.get(f"{_NOMINATIM_BASE}/reverse", headers=_NOMINATIM_HEADERS, params={
                "format": "jsonv2", "addressdetails": 1, "lat": lat, "lon": lon,
            })
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            raise HTTPException(status_code=404, detail="No address found for this location.")
        return _parse_nominatim_address(data)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Geocode] reverse failed: {e}", flush=True)
        raise HTTPException(status_code=502, detail="Location lookup is temporarily unavailable.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Supabase client ────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

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
    base = float(r.get("price", 0))                     # admin-set selling price
    disc = float(r.get("discount_percent", 0) or 0)     # admin-set discount
    merch = float(r.get("merchant_price", 0) or 0)      # what the merchant earns
    final = round(base * (1 - disc / 100), 2) if disc > 0 else base
    return {
        "id": r["id"],
        "name": r.get("name", ""),
        "description": r.get("description", ""),
        "price": base,                       # selling price (admin-set)
        "merchant_price": merch,             # merchant's take per unit
        "discount_percent": disc,            # admin-set discount
        "final_price": final,                # effective price customers pay
        "profit": round(final - merch, 2),   # platform margin per unit
        "status": r.get("status", "approved"),          # pending | approved | rejected
        "reject_reason": r.get("reject_reason"),
        "merchant_id": r.get("merchant_id"),
        "catalog_id": r.get("catalog_id"),   # set when this row is an admin-assigned shared listing
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
    # Guarantee every default occasion shows a handful of products.
    if len(ids) < 4:
        for p in _SEED_PRODUCTS:
            if p["id"] not in ids:
                ids.append(p["id"])
            if len(ids) >= 6:
                break
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

# ── Image upload (admin) — stores in the public "Products" storage bucket ────────
@app.post("/api/admin/upload")
async def admin_upload_image(token: str, file: UploadFile = File(...)):
    require_admin(token)
    contents = await file.read()
    if len(contents) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 8 MB).")
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"):
        ext = ".png"
    path = f"uploads/{uuid.uuid4().hex}{ext}"
    content_type = file.content_type or "image/png"
    try:
        up = _httpx.post(
            f"{SUPABASE_URL}/storage/v1/object/Products/{path}",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": content_type},
            content=contents, timeout=30,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    if up.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail=f"Upload failed ({up.status_code}): {up.text[:200]}")
    return {"url": f"{SUPABASE_URL}/storage/v1/object/public/Products/{path}"}

@app.post("/api/merchant/upload")
async def merchant_upload_image(token: str, file: UploadFile = File(...)):
    """Merchant product-image upload → Supabase Storage (same bucket as admin)."""
    require_merchant(token)
    contents = await file.read()
    if len(contents) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 8 MB).")
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"):
        ext = ".png"
    path = f"uploads/{uuid.uuid4().hex}{ext}"
    content_type = file.content_type or "image/png"
    try:
        up = _httpx.post(
            f"{SUPABASE_URL}/storage/v1/object/Products/{path}",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": content_type},
            content=contents, timeout=30,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    if up.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail=f"Upload failed ({up.status_code}): {up.text[:200]}")
    return {"url": f"{SUPABASE_URL}/storage/v1/object/public/Products/{path}"}

def seed_dummy_merchants():
    """Create two demo merchant logins + sample approved products (idempotent).
    Logins: merchant1@vivapetals.com / merchant2@vivapetals.com — pw: Merchant@123."""
    demo_img = "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=600"
    demos = [
        {"id": "00000000-0000-0000-0000-000000000101", "code": "MERCH-101",
         "email": "merchant1@vivapetals.com",
         "shop": "Rose & Bloom Studio", "slug": "rose-bloom", "phone": "+91 90000 00001",
         "products": [("Velvet Red Roses", "A dozen deep-red roses, hand-tied", 400, "Bouquets"),
                      ("Blush Peony Bunch", "Soft pink peonies for a gentle gift", 550, "Bouquets")]},
        {"id": "00000000-0000-0000-0000-000000000102", "code": "MERCH-102",
         "email": "merchant2@vivapetals.com",
         "shop": "Petal Cart", "slug": "petal-cart", "phone": "+91 90000 00002",
         "products": [("Sunny Marigold Garland", "Fresh marigold garland for festivities", 150, "Garlands"),
                      ("Mixed Daisy Jar", "Cheerful daisies in a rustic jar", 300, "Flowers")]},
    ]
    for d in demos:
        try:
            u = supabase.table("users").select("id").eq("email", d["email"]).execute().data
            if u:
                user_id = u[0]["id"]
            else:
                ins = supabase.table("users").insert({
                    "email": d["email"], "password": hash_password("Merchant@123"),
                    "first_name": d["shop"], "last_name": "", "is_verified": True,
                    "role": "merchant", "auth_provider": "email",
                }).execute()
                user_id = ins.data[0]["id"] if ins.data else None

            if not supabase.table("merchants").select("id").eq("id", d["id"]).execute().data:
                supabase.table("merchants").insert({
                    "id": d["id"], "user_id": user_id, "shop_name": d["shop"], "slug": d["slug"],
                    "phone": d["phone"], "email": d["email"], "status": "approved", "commission_rate": 0,
                    "merchant_code": d["code"],
                }).execute()
            else:
                supabase.table("merchants").update({"user_id": user_id}).eq("id", d["id"]).execute()

            existing = {p["name"] for p in (supabase.table("products").select("name").eq("merchant_id", d["id"]).execute().data or [])}
            last = supabase.table("products").select("id").order("id", desc=True).limit(1).execute().data
            next_id = (last[0]["id"] + 1) if last else 1
            new_rows = []
            for (name, desc, mprice, cat) in d["products"]:
                if name in existing:
                    continue
                new_rows.append({
                    "id": next_id, "name": name, "description": desc,
                    "price": round(mprice * 1.25),   # admin markup 25% → selling price
                    "merchant_price": mprice, "discount_percent": 0,
                    "image": demo_img, "category": cat, "in_stock": True,
                    "merchant_id": d["id"], "status": "approved",
                })
                next_id += 1
            if new_rows:
                supabase.table("products").insert(new_rows).execute()
        except Exception as e:
            print(f"[Seed] {d['shop']} skipped (run merchant_v2_migration.sql?): {e}", flush=True)
    print("[Seed] Dummy merchants ready (merchant1/merchant2@vivapetals.com / Merchant@123)", flush=True)


# Defined here (not down near the other merchant helpers) because the
# Florist's Choice bootstrap right below needs it at MODULE-LOAD time, before
# the rest of the file (where it's normally referenced) has even executed.
HOUSE_MERCHANT_ID = "00000000-0000-0000-0000-000000000001"

def _next_merchant_code() -> str:
    """Generate the next available MERCH-XXX code."""
    rows = supabase.table("merchants").select("merchant_code").like("merchant_code", "MERCH-%").execute().data or []
    nums = []
    for r in rows:
        code = r.get("merchant_code") or ""
        try:
            nums.append(int(code.split("-")[1]))
        except Exception:
            pass
    next_num = max(nums, default=1) + 1
    return f"MERCH-{next_num:03d}"

FLORISTS_CHOICE_NAME = "Florist's Choice (Bloom Plan)"
FLORISTS_CHOICE_PRODUCT_ID: Optional[int] = None

def _ensure_florists_choice_product() -> Optional[int]:
    """A 'Florist's Choice' Bloom Plan cycle has no specific product — it's a
    house-curated arrangement, not any seller's listing. We still need a
    REAL products.id to attach to the generated order_items row (a made-up
    id risks a foreign-key error, and an out-of-stock real product would
    still show up in storefront listings). This creates one house-owned
    placeholder row, hidden from the storefront the same way a rejected
    product is (status='rejected' — customers never see it, checkout never
    references it directly), and reuses it for every cycle thereafter."""
    global FLORISTS_CHOICE_PRODUCT_ID
    try:
        existing = (supabase.table("products").select("id")
                    .eq("name", FLORISTS_CHOICE_NAME).eq("merchant_id", HOUSE_MERCHANT_ID)
                    .limit(1).execute().data)
        if existing:
            FLORISTS_CHOICE_PRODUCT_ID = existing[0]["id"]
            return FLORISTS_CHOICE_PRODUCT_ID
        rows = supabase.table("products").select("id").order("id", desc=True).limit(1).execute().data
        next_id = (rows[0]["id"] + 1) if rows else 1
        supabase.table("products").insert({
            "id": next_id, "name": FLORISTS_CHOICE_NAME,
            "description": "Internal placeholder for Bloom Plan 'Florist's Choice' deliveries — do not delete.",
            "price": 0, "merchant_price": 0, "discount_percent": 0,
            "image": "", "category": "Internal", "in_stock": True,
            "merchant_id": HOUSE_MERCHANT_ID, "status": "rejected",
            "reject_reason": "Internal use only — not a real listing.",
        }).execute()
        FLORISTS_CHOICE_PRODUCT_ID = next_id
        return next_id
    except Exception as e:
        print(f"[Bloom Plan] could not set up Florist's Choice placeholder: {e}", flush=True)
        return None


# ── Schema safety ─────────────────────────────────────────────────────────────
# Some features depend on a migration file the admin may not have run yet
# (e.g. petal_studio_migration.sql adds orders.source /
# corporate_orders.linked_order_id). Referencing a column that doesn't exist
# yet fails the ENTIRE query in Postgrest — for something like orders.source
# that's used on every checkout, that means checkout itself breaks with a
# 500, not just the new feature. This lets call sites check first and
# degrade gracefully (skip the field / skip the filter) instead.
_COLUMN_EXISTS_CACHE: dict = {}

def _has_column(table: str, column: str) -> bool:
    key = (table, column)
    if key not in _COLUMN_EXISTS_CACHE:
        try:
            supabase.table(table).select(column).limit(1).execute()
            _COLUMN_EXISTS_CACHE[key] = True
        except Exception:
            _COLUMN_EXISTS_CACHE[key] = False
            print(f"[Schema] {table}.{column} not found — related features will degrade until the migration is run.", flush=True)
    return _COLUMN_EXISTS_CACHE[key]


# Seeding disabled — the database is the source of truth. We only load caches.
load_products()
load_subscription_plans()
seed_dummy_merchants()
_ensure_florists_choice_product()
load_products()

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
    discount_percent: Optional[float] = None
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

def _is_live(p: dict) -> bool:
    """Public storefront only shows admin-approved products."""
    return p.get("status", "approved") == "approved"

def _dedupe_catalog(products: list) -> list:
    """A catalog product (admin-assigned to several merchants) is the SAME
    row of `products` repeated once per merchant. Customers should see one
    card, not N duplicates — collapse them here, preferring a row that's in
    stock. Which merchant actually fulfills the order is resolved later, at
    checkout (nearest-merchant routing — not implemented yet)."""
    representative_idx: dict = {}
    out = []
    for p in products:
        cid = p.get("catalog_id")
        if not cid:
            out.append(p)
            continue
        if cid not in representative_idx:
            representative_idx[cid] = len(out)
            out.append(p)
        elif p.get("inStock") and not out[representative_idx[cid]].get("inStock"):
            out[representative_idx[cid]] = p
    return out

@app.get("/api/products")
def get_products(category: Optional[str] = None):
    live = _dedupe_catalog([p for p in PRODUCTS if _is_live(p)])
    if category:
        return [p for p in live if p["category"] == category]
    return live

@app.get("/api/products/categories")
def get_categories():
    return sorted(list(set(p["category"] for p in PRODUCTS if _is_live(p))))

@app.get("/api/products/{product_id}")
def get_product(product_id: int):
    product = next((p for p in PRODUCTS if p["id"] == product_id and _is_live(p)), None)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product

# ── Admin: Products CRUD (Supabase) ──────────────────────────────────────────────

@app.get("/api/admin/products")
def admin_list_products(token: str):
    """All products (every status) with shop names — for admin management/approvals."""
    require_admin(token)
    merchants = supabase.table("merchants").select("id, shop_name").execute().data or []
    shop_by_id = {m["id"]: m["shop_name"] for m in merchants}
    out = []
    for p in PRODUCTS:
        row = dict(p)
        row["shop_name"] = shop_by_id.get(p.get("merchant_id"), "VivaPetals")
        row["is_house"] = p.get("merchant_id") == HOUSE_MERCHANT_ID
        out.append(row)
    return out

@app.post("/api/admin/products")
def create_product(req: ProductCreate, token: str):
    require_admin(token)
    rows = supabase.table("products").select("id").order("id", desc=True).limit(1).execute().data
    next_id = (rows[0]["id"] + 1) if rows else 1
    # House-store products are live immediately with no markup (merchant_price = price).
    supabase.table("products").insert({
        "id": next_id, "name": req.name, "description": req.description,
        "price": float(req.price), "merchant_price": float(req.price),
        "image": req.image, "category": req.category, "in_stock": req.inStock,
        "merchant_id": HOUSE_MERCHANT_ID, "status": "approved",
    }).execute()
    load_products()
    return next(p for p in PRODUCTS if p["id"] == next_id)

@app.put("/api/admin/products/{product_id}")
def update_product(product_id: int, req: ProductUpdate, token: str):
    require_admin(token)
    # Admin controls the selling price + discount (their markup lives here).
    col_map = {"name": "name", "description": "description", "price": "price",
               "discount_percent": "discount_percent", "image": "image",
               "category": "category", "inStock": "in_stock"}
    data = {}
    for field, col in col_map.items():
        val = getattr(req, field)
        if val is not None:
            if field == "price":
                data[col] = float(val)
            elif field == "discount_percent":
                data[col] = max(0.0, min(100.0, float(val)))
            else:
                data[col] = val
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = supabase.table("products").update(data).eq("id", product_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Product not found")
    load_products()
    return next(p for p in PRODUCTS if p["id"] == product_id)


class ProductApproveRequest(BaseModel):
    token: str
    price: float                       # admin-set selling price
    discount_percent: float = 0


class ProductRejectRequest(BaseModel):
    token: str
    reason: str = ""


@app.patch("/api/admin/products/{product_id}/approve")
def approve_product(product_id: int, req: ProductApproveRequest):
    require_admin(req.token)
    supabase.table("products").update({
        "price": float(req.price),
        "discount_percent": max(0.0, min(100.0, float(req.discount_percent or 0))),
        "status": "approved",
        "reject_reason": None,
    }).eq("id", product_id).execute()
    load_products()
    p = next((p for p in PRODUCTS if p["id"] == product_id), None)
    if p and p.get("merchant_id") and p.get("merchant_id") != HOUSE_MERCHANT_ID:
        create_user_notice(
            _merchant_email(p["merchant_id"]), "✅ Product approved",
            f"\"{p['name']}\" is now live on VivaPetals at ₹{p['price']}.",
            "merchant_product", str(product_id),
        )
    return p or {"status": "approved"}


@app.patch("/api/admin/products/{product_id}/reject")
def reject_product(product_id: int, req: ProductRejectRequest):
    require_admin(req.token)
    reason = req.reason or "Not accepted at this time."
    supabase.table("products").update({
        "status": "rejected",
        "reject_reason": reason,
    }).eq("id", product_id).execute()
    load_products()
    p = next((p for p in PRODUCTS if p["id"] == product_id), None)
    if p and p.get("merchant_id") and p.get("merchant_id") != HOUSE_MERCHANT_ID:
        create_user_notice(
            _merchant_email(p["merchant_id"]), "❌ Product rejected",
            f"\"{p['name']}\" was not approved. Reason: {reason}",
            "merchant_product", str(product_id),
        )
    return {"status": "rejected"}

@app.delete("/api/admin/products/{product_id}")
def delete_product(product_id: int, token: str):
    require_admin(token)
    result = supabase.table("products").delete().eq("id", product_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Product not found")
    supabase.table("product_stock").delete().eq("product_id", product_id).execute()
    load_products()
    return {"status": "ok"}


# ── Admin: catalog products (shared listings across several merchants) ───────
# Same idea as roses/lilies/sunflowers sold by many florists: admin creates
# ONE listing with ONE market-wide price, assigns it to N merchants, and each
# gets their own `products` row (own id, own stock) linked by `catalog_id` —
# so checkout/order routing/payouts need no special-casing. Which assigned
# merchant actually fulfills a given order (nearest-by-location) is a later
# feature; for now the storefront shows one deduped card per catalog item and
# routes to whichever assigned, in-stock, approved row is picked at checkout.

class CatalogProductCreate(BaseModel):
    token: str
    name: str
    description: str = ""
    image: str = ""
    category: str
    price: float                 # selling price, same for every assigned merchant
    merchant_price: float        # what EACH assigned merchant earns per unit
    discount_percent: float = 0
    merchant_ids: list[str]


class CatalogProductUpdate(BaseModel):
    token: str
    name: Optional[str] = None
    description: Optional[str] = None
    image: Optional[str] = None
    category: Optional[str] = None
    price: Optional[float] = None
    merchant_price: Optional[float] = None
    discount_percent: Optional[float] = None
    merchant_ids: Optional[list[str]] = None   # full desired assignment list, if provided


@app.get("/api/admin/catalog-products")
def admin_list_catalog_products(token: str):
    require_admin(token)
    catalogs = supabase.table("catalog_products").select("*").order("created_at", desc=True).execute().data or []
    merchants = supabase.table("merchants").select("id, shop_name, city").execute().data or []
    shop_by_id = {m["id"]: m for m in merchants}
    for c in catalogs:
        rows = [p for p in PRODUCTS if p.get("catalog_id") == c["id"]]
        c["assignments"] = [{
            "merchant_id": r.get("merchant_id"),
            "shop_name": shop_by_id.get(r.get("merchant_id"), {}).get("shop_name", "Unknown"),
            "city": shop_by_id.get(r.get("merchant_id"), {}).get("city", ""),
            "product_id": r["id"],
            "inStock": r.get("inStock", True),
            "status": r.get("status"),
        } for r in rows]
    return catalogs


@app.post("/api/admin/catalog-products")
def admin_create_catalog_product(req: CatalogProductCreate):
    require_admin(req.token)
    if not req.name.strip() or not req.category.strip():
        raise HTTPException(status_code=400, detail="Name and category are required.")
    if not req.merchant_ids:
        raise HTTPException(status_code=400, detail="Assign at least one merchant.")
    price = max(0.0, float(req.price))
    merchant_price = max(0.0, float(req.merchant_price))
    discount = max(0.0, min(100.0, float(req.discount_percent or 0)))

    cat = supabase.table("catalog_products").insert({
        "name": req.name.strip(), "description": req.description, "image": req.image,
        "category": req.category.strip(), "price": price, "merchant_price": merchant_price,
        "discount_percent": discount, "status": "active",
    }).execute()
    catalog_id = cat.data[0]["id"]

    rows = supabase.table("products").select("id").order("id", desc=True).limit(1).execute().data
    next_id = (rows[0]["id"] + 1) if rows else 1
    inserts = []
    for mid in set(req.merchant_ids):
        inserts.append({
            "id": next_id, "name": req.name.strip(), "description": req.description,
            "price": price, "merchant_price": merchant_price, "discount_percent": discount,
            "image": req.image, "category": req.category.strip(), "in_stock": True,
            "merchant_id": mid, "status": "approved", "catalog_id": catalog_id,
        })
        next_id += 1
    supabase.table("products").insert(inserts).execute()
    load_products()
    return {"status": "ok", "catalog_id": catalog_id, "assigned": len(inserts)}


@app.put("/api/admin/catalog-products/{catalog_id}")
def admin_update_catalog_product(catalog_id: str, req: CatalogProductUpdate):
    require_admin(req.token)
    existing = supabase.table("catalog_products").select("*").eq("id", catalog_id).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Catalog product not found")

    # Cascade the shared fields to the master row + every linked products row
    # (catalog_products and products use identical column names for these).
    shared_fields = ("name", "description", "image", "category", "price", "merchant_price", "discount_percent")
    numeric_fields = ("price", "merchant_price", "discount_percent")
    data = {}
    for field in shared_fields:
        val = getattr(req, field)
        if val is not None:
            data[field] = float(val) if field in numeric_fields else val

    if data:
        supabase.table("catalog_products").update(data).eq("id", catalog_id).execute()
        supabase.table("products").update(data).eq("catalog_id", catalog_id).execute()

    if req.merchant_ids is not None:
        current_rows = supabase.table("products").select("id, merchant_id").eq("catalog_id", catalog_id).execute().data or []
        current_ids = {r["merchant_id"] for r in current_rows}
        wanted_ids = set(req.merchant_ids)

        # Unassign: keep the row for order history, just pull it off the storefront.
        for r in current_rows:
            if r["merchant_id"] not in wanted_ids:
                supabase.table("products").update({
                    "in_stock": False, "status": "rejected",
                    "reject_reason": "Unassigned from this catalog listing by admin.",
                }).eq("id", r["id"]).execute()

        # Assign: brand-new merchants get a fresh row with the current master pricing.
        master = supabase.table("catalog_products").select("*").eq("id", catalog_id).execute().data[0]
        new_ids = wanted_ids - current_ids
        if new_ids:
            rows = supabase.table("products").select("id").order("id", desc=True).limit(1).execute().data
            next_id = (rows[0]["id"] + 1) if rows else 1
            inserts = []
            for mid in new_ids:
                inserts.append({
                    "id": next_id, "name": master["name"], "description": master["description"],
                    "price": master["price"], "merchant_price": master["merchant_price"],
                    "discount_percent": master["discount_percent"], "image": master["image"],
                    "category": master["category"], "in_stock": True,
                    "merchant_id": mid, "status": "approved", "catalog_id": catalog_id,
                })
                next_id += 1
            supabase.table("products").insert(inserts).execute()

    load_products()
    return {"status": "ok"}


@app.delete("/api/admin/catalog-products/{catalog_id}")
def admin_archive_catalog_product(catalog_id: str, token: str):
    require_admin(token)
    supabase.table("catalog_products").update({"status": "archived"}).eq("id", catalog_id).execute()
    supabase.table("products").update({
        "in_stock": False, "status": "rejected", "reject_reason": "Catalog listing archived by admin.",
    }).eq("catalog_id", catalog_id).execute()
    load_products()
    return {"status": "archived"}


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
    result = supabase.table("users").select("*").eq("email", email).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="User not found")
    return auth_user_payload(result.data[0])

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

    return {"token": token, "user": auth_user_payload(user)}

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
        "user": auth_user_payload(user),
    }


# ── Merchant helpers & routes ────────────────────────────────────────────────

def get_user_by_email(email: str):
    r = supabase.table("users").select("*").eq("email", email).execute()
    return r.data[0] if r.data else None

def get_merchant_for_user(user_id):
    if not user_id:
        return None
    r = supabase.table("merchants").select("*").eq("user_id", user_id).limit(1).execute()
    return r.data[0] if r.data else None

def merchant_public(m):
    """Trimmed merchant object safe to embed in auth responses."""
    if not m:
        return None
    return {
        "id": m["id"],
        "shop_name": m.get("shop_name", ""),
        "slug": m.get("slug"),
        "status": m.get("status", "pending"),
        "commission_rate": m.get("commission_rate", 15),
    }

def auth_user_payload(user):
    """Standard user object returned by login / social / me — now role-aware."""
    merchant = get_merchant_for_user(user["id"])
    return {
        "id": user["id"],
        "firstName": user["first_name"],
        "lastName": user["last_name"],
        "email": user["email"],
        "is_admin": user.get("is_admin", False),
        "role": user.get("role", "customer"),
        "merchant": merchant_public(merchant),
        "auth_provider": user.get("auth_provider", "email"),
    }

def slugify(text: str) -> str:
    s = "".join(c if c.isalnum() else "-" for c in (text or "").lower())
    return "-".join(filter(None, s.split("-"))) or "shop"

def require_merchant(token: str):
    """Return the caller's APPROVED merchant record, or raise 401/403."""
    email = resolve_token(token)
    if not email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    m = get_merchant_for_user(user["id"])
    if not m:
        raise HTTPException(status_code=403, detail="Merchant access required")
    if m.get("status") != "approved":
        raise HTTPException(status_code=403, detail=f"Merchant account is {m.get('status', 'pending')}")
    return m


class MerchantApplyRequest(BaseModel):
    token: str
    shop_name: str
    description: Optional[str] = ""
    phone: Optional[str] = ""
    address: Optional[str] = ""
    city: Optional[str] = ""
    state: Optional[str] = ""
    pincode: Optional[str] = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None


@app.post("/api/merchant/apply")
def merchant_apply(req: MerchantApplyRequest):
    email = resolve_token(req.token)
    if not email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if get_merchant_for_user(user["id"]):
        existing = get_merchant_for_user(user["id"])
        raise HTTPException(status_code=400, detail=f"You already have a shop application ({existing.get('status')}).")

    shop_name = (req.shop_name or "").strip()
    if not shop_name:
        raise HTTPException(status_code=400, detail="Shop name is required")

    base = slugify(shop_name)
    slug, i = base, 1
    while supabase.table("merchants").select("id").eq("slug", slug).execute().data:
        i += 1
        slug = f"{base}-{i}"

    supabase.table("merchants").insert({
        "user_id": user["id"],
        "shop_name": shop_name,
        "slug": slug,
        "description": req.description or "",
        "phone": req.phone or "",
        "address": req.address or "", "city": req.city or "",
        "state": req.state or "", "pincode": req.pincode or "",
        "latitude": req.latitude, "longitude": req.longitude,
        "email": email,
        "status": "pending",
        "commission_rate": 15,
        "merchant_code": _next_merchant_code(),
    }).execute()
    _notify_all_admins(
        "🏪 New merchant application",
        f"\"{shop_name}\" applied to sell on VivaPetals — review it in the Merchants tab.",
        "merchant_application", email,
    )
    return {"status": "pending", "message": "Application submitted! An admin will review your shop shortly."}


@app.get("/api/merchant/me")
def merchant_me(token: str):
    email = resolve_token(token)
    if not email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = get_user_by_email(email)
    m = get_merchant_for_user(user["id"]) if user else None
    if not m:
        return {"merchant": None}
    return {"merchant": {
        "id": m["id"], "merchant_code": m.get("merchant_code", ""),
        "shop_name": m.get("shop_name", ""), "slug": m.get("slug"),
        "description": m.get("description", ""), "phone": m.get("phone", ""),
        "logo": m.get("logo", ""), "status": m.get("status", "pending"),
        "commission_rate": m.get("commission_rate", 15),
        "address": m.get("address", ""), "city": m.get("city", ""),
        "state": m.get("state", ""), "pincode": m.get("pincode", ""),
        "latitude": m.get("latitude"), "longitude": m.get("longitude"),
    }}


# ── Merchant: shop profile ───────────────────────────────────────────────────

class MerchantShopUpdate(BaseModel):
    token: str
    shop_name: Optional[str] = None
    description: Optional[str] = None
    phone: Optional[str] = None
    logo: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


@app.put("/api/merchant/shop")
def merchant_update_shop(req: MerchantShopUpdate):
    m = require_merchant(req.token)
    data = {}
    for field in ("shop_name", "description", "phone", "logo", "address", "city", "state", "pincode", "latitude", "longitude"):
        val = getattr(req, field)
        if val is not None:
            data[field] = val
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    supabase.table("merchants").update(data).eq("id", m["id"]).execute()
    return {"status": "ok", **data}


# ── Merchant: products (scoped to the caller's shop) ─────────────────────────

class MerchantProductCreate(BaseModel):
    token: str
    name: str
    description: str = ""
    merchant_price: float            # what the merchant wants to earn per unit
    image: str = ""
    category: str
    inStock: bool = True


class MerchantProductUpdate(BaseModel):
    token: str
    name: Optional[str] = None
    description: Optional[str] = None
    merchant_price: Optional[float] = None
    image: Optional[str] = None
    category: Optional[str] = None
    inStock: Optional[bool] = None


def _merchant_owns_product(product_id: int, merchant_id):
    r = supabase.table("products").select("*").eq("id", product_id).execute().data
    return r[0] if (r and r[0].get("merchant_id") == merchant_id) else None


@app.get("/api/merchant/products")
def merchant_list_products(token: str):
    m = require_merchant(token)
    # Merchant view: hide the admin's selling price / profit — show only their price.
    out = []
    for p in PRODUCTS:
        if p.get("merchant_id") != m["id"]:
            continue
        out.append({
            "id": p["id"], "name": p["name"], "description": p["description"],
            "merchant_price": p["merchant_price"], "image": p["image"],
            "category": p["category"], "inStock": p["inStock"],
            "status": p["status"], "reject_reason": p.get("reject_reason"),
            "catalog_id": p.get("catalog_id"),   # set = admin-assigned shared listing (price locked)
        })
    return out


@app.post("/api/merchant/products")
def merchant_create_product(req: MerchantProductCreate):
    m = require_merchant(req.token)
    rows = supabase.table("products").select("id").order("id", desc=True).limit(1).execute().data
    next_id = (rows[0]["id"] + 1) if rows else 1
    mp = max(0.0, float(req.merchant_price))
    # New products start PENDING; selling price seeded to merchant price until admin sets it.
    supabase.table("products").insert({
        "id": next_id, "name": req.name, "description": req.description,
        "price": mp, "merchant_price": mp, "discount_percent": 0,
        "image": req.image, "category": req.category, "in_stock": req.inStock,
        "merchant_id": m["id"], "status": "pending",
    }).execute()
    load_products()
    return {"status": "pending", "id": next_id}


@app.put("/api/merchant/products/{product_id}")
def merchant_update_product(product_id: int, req: MerchantProductUpdate):
    m = require_merchant(req.token)
    existing = _merchant_owns_product(product_id, m["id"])
    if not existing:
        raise HTTPException(status_code=403, detail="Not your product")

    if existing.get("catalog_id"):
        # Admin-assigned shared listing — price/name/etc are locked market-wide.
        # A merchant may only toggle their own stock on it.
        if req.inStock is None:
            raise HTTPException(status_code=403, detail="This product is managed by admin — you can only update stock.")
        for field in ("name", "description", "merchant_price", "image", "category"):
            if getattr(req, field) is not None:
                raise HTTPException(status_code=403, detail="This product is managed by admin — you can only update stock.")
        supabase.table("products").update({"in_stock": req.inStock}).eq("id", product_id).execute()
        load_products()
        return {"status": existing.get("status"), "id": product_id}

    col_map = {"name": "name", "description": "description",
               "merchant_price": "merchant_price", "image": "image",
               "category": "category", "inStock": "in_stock"}
    data = {}
    for field, col in col_map.items():
        val = getattr(req, field)
        if val is not None:
            data[col] = float(val) if field == "merchant_price" else val
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    # Changing the merchant price on a live product sends it back for re-approval,
    # so the storefront never shows a product the admin hasn't re-priced.
    if "merchant_price" in data and float(data["merchant_price"]) != float(existing.get("merchant_price", 0)) \
            and existing.get("status") == "approved":
        data["status"] = "pending"
    supabase.table("products").update(data).eq("id", product_id).execute()
    load_products()
    return {"status": data.get("status", existing.get("status")), "id": product_id}


@app.delete("/api/merchant/products/{product_id}")
def merchant_delete_product(product_id: int, token: str):
    m = require_merchant(token)
    existing = _merchant_owns_product(product_id, m["id"])
    if not existing:
        raise HTTPException(status_code=403, detail="Not your product")
    if existing.get("catalog_id"):
        raise HTTPException(status_code=403, detail="This is an admin catalog listing — contact admin to be removed from it.")
    supabase.table("products").delete().eq("id", product_id).execute()
    supabase.table("product_stock").delete().eq("product_id", product_id).execute()
    load_products()
    return {"status": "ok"}


# ── Merchant: orders (their fulfillment parts) + stats ───────────────────────

MERCHANT_STATUS_FLOW = {
    "confirmed": ["preparing", "out_for_delivery", "delivered"],
    "preparing": ["out_for_delivery", "delivered"],
    "out_for_delivery": ["delivered"],
    "delivered": [], "cancelled": [],
}

ORDER_STATUS_RANK = {"confirmed": 0, "preparing": 1, "out_for_delivery": 2, "delivered": 3}


def _compute_order_status(part_statuses: list) -> str:
    """Pure: an order is only as "done" as its least-advanced active
    (non-cancelled) merchant part — all-cancelled -> cancelled; otherwise the
    minimum rank among the rest. Mirrors how Amazon/Myntra show one order
    status until every seller's package has shipped/delivered."""
    active = [s for s in part_statuses if s != "cancelled"]
    return "cancelled" if not active else min(active, key=lambda s: ORDER_STATUS_RANK.get(s, 0))


def _recompute_order_status_from_parts(order_id: str):
    """Keep the parent `orders.status` in sync after a merchant updates their
    part of an order. Notifies the customer (in-app + SMS/WhatsApp) only if
    the status actually changed, reusing the same pipeline the admin's direct
    status endpoint uses — including crediting loyalty points on delivery.
    This matters because in the marketplace, a THIRD-PARTY MERCHANT marking
    their own part delivered (not admin) is the normal path — without this,
    points would only ever be credited on the rare order an admin happens to
    set 'delivered' directly."""
    parts = supabase.table("order_merchant_parts").select("status").eq("order_id", order_id).execute().data or []
    if not parts:
        return
    new_status = _compute_order_status([p["status"] for p in parts])

    order = supabase.table("orders").select("*").eq("id", order_id).execute().data
    if not order:
        return
    old_status = order[0].get("status")
    if old_status == new_status or old_status == "cancelled":
        return  # no-op, or a cancelled order stays cancelled regardless of part churn

    supabase.table("orders").update({"status": new_status}).eq("id", order_id).execute()
    if new_status == "delivered":
        award_delivery_points(order[0])
    elif new_status == "cancelled":
        refund_redeemed_points(order[0])
    send_notifications(order_id, new_status, order[0].get("customer_phone") or "")
    if new_status in ORDER_STATUS_NOTICE:
        title, phrase = ORDER_STATUS_NOTICE[new_status]
        create_user_notice(order[0].get("customer_email"), title, f"Your order #{order_id} {phrase}.", "order", order_id)

    if order[0].get("source") == "corporate":
        _sync_corporate_booking_status(order_id, new_status)


# Retail/merchant fulfillment statuses don't share a vocabulary with a Petal
# Studio booking's own lifecycle (pending → confirmed → preparing →
# completed → cancelled, admin-managed) — map one onto the other so "My
# Studio" actually reflects real merchant progress instead of freezing at
# 'confirmed' forever once merchants start fulfilling the linked order.
_CORPORATE_STATUS_FROM_ORDER = {
    "confirmed": "confirmed", "preparing": "preparing",
    "out_for_delivery": "preparing", "delivered": "completed", "cancelled": "cancelled",
}


def _sync_corporate_booking_status(linked_order_id: str, order_status: str):
    if not _has_column("corporate_orders", "linked_order_id"):
        return
    mapped = _CORPORATE_STATUS_FROM_ORDER.get(order_status)
    if not mapped:
        return
    booking = supabase.table("corporate_orders").select("id, status, contact_email").eq("linked_order_id", linked_order_id).execute().data
    if not booking or booking[0].get("status") in ("cancelled", "completed") or booking[0].get("status") == mapped:
        return  # no matching booking, already terminal, or no change
    supabase.table("corporate_orders").update({"status": mapped}).eq("id", booking[0]["id"]).execute()
    if mapped in BOOKING_STATUS_NOTICE:
        title, phrase = BOOKING_STATUS_NOTICE[mapped]
        create_user_notice(booking[0].get("contact_email"), title,
                            f"Your Petal Studio booking #{booking[0]['id']} {phrase}.", "booking", booking[0]["id"])


def _merchant_email(merchant_id) -> Optional[str]:
    if not merchant_id:
        return None
    r = supabase.table("merchants").select("email").eq("id", merchant_id).execute().data
    return r[0].get("email") if r else None


def _notify_all_admins(title: str, message: str, ref_type: str, ref_id: str):
    admins = supabase.table("users").select("email").eq("is_admin", True).execute().data or []
    for a in admins:
        create_user_notice(a.get("email"), title, message, ref_type, ref_id)


@app.get("/api/merchant/orders")
def merchant_orders(token: str):
    m = require_merchant(token)
    parts = (supabase.table("order_merchant_parts").select("*")
             .eq("merchant_id", m["id"]).order("created_at", desc=True).execute().data or [])
    if not parts:
        return []
    order_ids = list({p["order_id"] for p in parts})
    orders = supabase.table("orders").select("*").in_("id", order_ids).execute().data or []
    orders_by_id = {o["id"]: o for o in orders}
    items = (supabase.table("order_items").select("*")
             .in_("order_id", order_ids).eq("merchant_id", m["id"]).execute().data or [])
    items_by_order = {}
    for it in items:
        items_by_order.setdefault(it["order_id"], []).append(it)

    out = []
    for p in parts:
        o = orders_by_id.get(p["order_id"], {})
        out.append({
            "order_id": p["order_id"],
            "status": p.get("status", "confirmed"),
            "payout": p.get("payout", 0),               # merchant's earnings only
            "payout_status": p.get("payout_status", "unpaid"),
            "delivery_date": p.get("delivery_date"),
            "created_at": p.get("created_at"),
            "customer_name": o.get("customer_name", ""),
            "customer_phone": o.get("customer_phone", ""),
            "customer_address": o.get("customer_address", ""),
            "delivery_type": o.get("delivery_type"),
            "items": [{"name": it.get("name"), "quantity": it.get("quantity")}
                      for it in items_by_order.get(p["order_id"], [])],
            "next_statuses": MERCHANT_STATUS_FLOW.get(p.get("status", "confirmed"), []),
        })
    return out


class MerchantOrderStatusUpdate(BaseModel):
    token: str
    status: str
    delivery_date: Optional[str] = None


@app.patch("/api/merchant/orders/{order_id}/status")
def merchant_update_order_status(order_id: str, req: MerchantOrderStatusUpdate):
    m = require_merchant(req.token)
    if req.status not in ("confirmed", "preparing", "out_for_delivery", "delivered", "cancelled"):
        raise HTTPException(status_code=400, detail="Invalid status")
    data = {"status": req.status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if req.delivery_date is not None:
        data["delivery_date"] = req.delivery_date
    r = (supabase.table("order_merchant_parts").update(data)
         .eq("order_id", order_id).eq("merchant_id", m["id"]).execute())
    if not r.data:
        raise HTTPException(status_code=404, detail="Order part not found")
    _recompute_order_status_from_parts(order_id)
    return {"status": req.status}


@app.get("/api/merchant/stats")
def merchant_stats(token: str):
    m = require_merchant(token)
    parts = supabase.table("order_merchant_parts").select("*").eq("merchant_id", m["id"]).execute().data or []
    active = [p for p in parts if p.get("status") != "cancelled"]
    my_products = [p for p in PRODUCTS if p.get("merchant_id") == m["id"]]
    live_count = sum(1 for p in my_products if p.get("status") == "approved")
    pending_products = sum(1 for p in my_products if p.get("status") == "pending")
    status_counts = Counter(p.get("status", "confirmed") for p in parts)

    # Earnings breakdown — mirrors a seller-panel "balance" view:
    #   in_progress: not delivered yet, so nothing is payable yet
    #   pending_payout: delivered, admin hasn't settled it yet (money owed)
    #   paid_out: delivered AND settled (money already sent)
    paid_out = round(sum(float(p.get("payout", 0) or 0) for p in active if p.get("payout_status") == "paid"), 2)
    pending_payout = round(sum(float(p.get("payout", 0) or 0) for p in active
                               if p.get("status") == "delivered" and p.get("payout_status") != "paid"), 2)
    in_progress_value = round(sum(float(p.get("payout", 0) or 0) for p in active if p.get("status") != "delivered"), 2)

    return {
        "shop_name": m.get("shop_name", ""),
        "product_count": len(my_products),
        "live_products": live_count,
        "pending_products": pending_products,
        "order_count": len(parts),
        "pending_count": status_counts.get("confirmed", 0) + status_counts.get("preparing", 0),
        "paid_out": paid_out,
        "pending_payout": pending_payout,
        "in_progress_value": in_progress_value,
        "status_counts": dict(status_counts),
    }


# ── Admin: merchant management ───────────────────────────────────────────────

class MerchantStatusRequest(BaseModel):
    token: str
    status: str            # pending | approved | suspended


class MerchantCommissionRequest(BaseModel):
    token: str
    commission_rate: float


@app.get("/api/admin/merchants")
def admin_list_merchants(token: str):
    require_admin(token)
    merchants = supabase.table("merchants").select("*").order("created_at", desc=True).execute().data or []
    # Attach a product count per merchant (cheap, marketplace is small).
    prods = supabase.table("products").select("merchant_id").execute().data or []
    counts = Counter(p.get("merchant_id") for p in prods)
    for m in merchants:
        m["product_count"] = counts.get(m["id"], 0)
    return merchants


# ── Admin: payouts (merchant settlement ledger) ──────────────────────────────
# The customer pays VivaPetals in full — there's no split-payment gateway.
# Instead this is an internal ledger: once a merchant's part of an order is
# marked `delivered`, their payout becomes DUE. Admin settles it manually
# (after actually paying the merchant, e.g. bank transfer) and records that
# here — individually per order, or in one bulk "pay all" action per shop.

def _aggregate_payouts(parts: list, shop_by_id: dict) -> dict:
    """Pure aggregation over order_merchant_parts rows into the admin payout
    summary: per-merchant pending/paid totals + platform-wide totals.
    Cancelled parts never owe anything. A part only counts toward "pending"
    once its fulfillment status is 'delivered' — see module docstring above
    admin_payouts_summary for why."""
    by_merchant: dict = {}
    total_pending = total_paid = total_commission = 0.0
    for p in parts:
        if p.get("status") == "cancelled":
            continue
        mid = p.get("merchant_id")
        row = by_merchant.setdefault(mid, {
            "merchant_id": mid, "shop_name": shop_by_id.get(mid, "Unknown"),
            "pending_amount": 0.0, "pending_count": 0, "paid_amount": 0.0, "paid_count": 0,
        })
        payout = float(p.get("payout", 0) or 0)
        total_commission += float(p.get("commission", 0) or 0)
        if p.get("payout_status") == "paid":
            row["paid_amount"] += payout
            row["paid_count"] += 1
            total_paid += payout
        elif p.get("status") == "delivered":
            row["pending_amount"] += payout
            row["pending_count"] += 1
            total_pending += payout

    merchant_rows = sorted(by_merchant.values(), key=lambda r: r["pending_amount"], reverse=True)
    for r in merchant_rows:
        r["pending_amount"] = round(r["pending_amount"], 2)
        r["paid_amount"] = round(r["paid_amount"], 2)

    return {
        "total_pending": round(total_pending, 2),
        "total_paid": round(total_paid, 2),
        "total_commission": round(total_commission, 2),
        "merchants": merchant_rows,
    }


@app.get("/api/admin/payouts")
def admin_payouts_summary(token: str):
    require_admin(token)
    parts = supabase.table("order_merchant_parts").select("*").execute().data or []
    merchants = supabase.table("merchants").select("id, shop_name").execute().data or []
    shop_by_id = {m["id"]: m["shop_name"] for m in merchants}
    return _aggregate_payouts(parts, shop_by_id)


@app.get("/api/admin/payouts/{merchant_id}")
def admin_payouts_for_merchant(merchant_id: str, token: str):
    require_admin(token)
    parts = (supabase.table("order_merchant_parts").select("*")
             .eq("merchant_id", merchant_id).neq("status", "cancelled")
             .order("created_at", desc=True).execute().data or [])
    return parts


class PayoutMarkPaidRequest(BaseModel):
    token: str
    note: Optional[str] = ""


@app.patch("/api/admin/payouts/{part_id}/pay")
def admin_mark_payout_paid(part_id: str, req: PayoutMarkPaidRequest):
    require_admin(req.token)
    existing = supabase.table("order_merchant_parts").select("status, payout_status, merchant_id, payout, order_id").eq("id", part_id).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Payout not found")
    if existing[0].get("status") != "delivered":
        raise HTTPException(status_code=400, detail="Only delivered orders can be settled.")
    if existing[0].get("payout_status") == "paid":
        raise HTTPException(status_code=400, detail="Already paid.")
    supabase.table("order_merchant_parts").update({
        "payout_status": "paid", "paid_at": datetime.now(timezone.utc).isoformat(), "payout_note": req.note or "",
    }).eq("id", part_id).execute()
    create_user_notice(
        _merchant_email(existing[0].get("merchant_id")), "💰 Payout settled",
        f"₹{existing[0].get('payout')} for order #{existing[0].get('order_id')} has been paid to you.",
        "merchant_payout", part_id,
    )
    return {"status": "paid"}


@app.post("/api/admin/payouts/{merchant_id}/pay-all")
def admin_pay_all_for_merchant(merchant_id: str, req: PayoutMarkPaidRequest):
    require_admin(req.token)
    due = (supabase.table("order_merchant_parts").select("id, payout")
           .eq("merchant_id", merchant_id).eq("status", "delivered").eq("payout_status", "unpaid")
           .execute().data or [])
    if not due:
        return {"status": "ok", "paid_count": 0, "paid_amount": 0}
    ids = [d["id"] for d in due]
    total = round(sum(float(d.get("payout", 0) or 0) for d in due), 2)
    supabase.table("order_merchant_parts").update({
        "payout_status": "paid", "paid_at": datetime.now(timezone.utc).isoformat(), "payout_note": req.note or "",
    }).in_("id", ids).execute()
    create_user_notice(
        _merchant_email(merchant_id), "💰 Payout settled",
        f"{len(ids)} order(s) totalling ₹{total} have been paid to you.",
        "merchant_payout", merchant_id,
    )
    return {"status": "ok", "paid_count": len(ids), "paid_amount": total}


def _sync_user_role(user_id, status):
    """Keep users.role in step with merchant status (never demote an admin)."""
    if not user_id:
        return
    u = supabase.table("users").select("is_admin").eq("id", user_id).execute().data
    if u and u[0].get("is_admin"):
        return
    supabase.table("users").update({"role": "merchant" if status == "approved" else "customer"}).eq("id", user_id).execute()


@app.patch("/api/admin/merchants/{merchant_id}/status")
def admin_set_merchant_status(merchant_id: str, req: MerchantStatusRequest):
    require_admin(req.token)
    if req.status not in ("pending", "approved", "suspended"):
        raise HTTPException(status_code=400, detail="Invalid status")
    r = supabase.table("merchants").update({"status": req.status}).eq("id", merchant_id).execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Merchant not found")
    _sync_user_role(r.data[0].get("user_id"), req.status)
    email = r.data[0].get("email")
    if req.status == "approved":
        create_user_notice(email, "🎉 Shop approved!",
                            "Your VivaPetals shop is live — you can now add products and start selling.",
                            "merchant_status", merchant_id)
    elif req.status == "suspended":
        create_user_notice(email, "Shop suspended",
                            "Your VivaPetals shop has been suspended. Contact support for details.",
                            "merchant_status", merchant_id)
    return {"status": req.status}


@app.patch("/api/admin/merchants/{merchant_id}/commission")
def admin_set_merchant_commission(merchant_id: str, req: MerchantCommissionRequest):
    require_admin(req.token)
    rate = max(0.0, min(100.0, float(req.commission_rate)))
    r = supabase.table("merchants").update({"commission_rate": rate}).eq("id", merchant_id).execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Merchant not found")
    return {"commission_rate": rate}


class AdminCreateMerchantRequest(BaseModel):
    token: str
    email: EmailStr
    password: str
    shop_name: str
    contact_name: Optional[str] = ""
    phone: Optional[str] = ""
    address: Optional[str] = ""
    city: Optional[str] = ""
    state: Optional[str] = ""
    pincode: Optional[str] = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None


@app.post("/api/admin/merchants/create")
def admin_create_merchant(req: AdminCreateMerchantRequest):
    """Admin provisions a merchant: a verified login + an approved shop."""
    require_admin(req.token)
    email = req.email.lower().strip()
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    if not req.shop_name.strip():
        raise HTTPException(status_code=400, detail="Shop name is required.")
    if supabase.table("users").select("id").eq("email", email).execute().data:
        raise HTTPException(status_code=400, detail="A user with this email already exists.")

    ins = supabase.table("users").insert({
        "email": email,
        "password": hash_password(req.password),
        "first_name": (req.contact_name or req.shop_name).strip(),
        "last_name": "",
        "is_verified": True,
        "role": "merchant",
        "auth_provider": "email",
    }).execute()
    user_id = ins.data[0]["id"] if ins.data else None

    base = slugify(req.shop_name)
    slug, i = base, 1
    while supabase.table("merchants").select("id").eq("slug", slug).execute().data:
        i += 1
        slug = f"{base}-{i}"
    m = supabase.table("merchants").insert({
        "user_id": user_id,
        "shop_name": req.shop_name.strip(),
        "slug": slug,
        "phone": req.phone or "",
        "address": req.address or "", "city": req.city or "",
        "state": req.state or "", "pincode": req.pincode or "",
        "latitude": req.latitude, "longitude": req.longitude,
        "email": email,
        "status": "approved",
        "commission_rate": 0,
        "merchant_code": _next_merchant_code(),
    }).execute()
    return {"status": "ok", "email": email, "shop_name": req.shop_name.strip(),
            "merchant": m.data[0] if m.data else None}


# ── Admin Routes ───────────────────────────────────────────────────────────────

def require_admin(token: str):
    email = resolve_token(token)
    if not email:
        raise HTTPException(status_code=401, detail="Not authenticated")
    result = supabase.table("users").select("is_admin").eq("email", email).execute()
    if not result.data or not result.data[0].get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return email

IST = timezone(timedelta(hours=5, minutes=30))

def _ist_dt(ts):
    """Parse a stored (UTC) timestamp and convert to IST; None if unparseable."""
    try:
        dt = datetime.fromisoformat((ts or "").replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(IST)
    except Exception:
        return None

def _ist_day(ts):
    d = _ist_dt(ts)
    return d.strftime("%Y-%m-%d") if d else ""

@app.get("/api/admin/stats")
def admin_stats(token: str):
    require_admin(token)
    all_orders = supabase.table("orders").select("id, status, total, created_at").execute().data or []
    today = datetime.now(IST).strftime("%Y-%m-%d")
    def valid(o): return o.get("status") != "cancelled"
    total_orders = len(all_orders)
    today_orders = sum(1 for o in all_orders if _ist_day(o.get("created_at")) == today)
    pending_count = sum(1 for o in all_orders if o.get("status") in ("confirmed", "preparing"))
    revenue_total = sum(o.get("total", 0) for o in all_orders if valid(o))
    revenue_today = sum(o.get("total", 0) for o in all_orders if valid(o) and _ist_day(o.get("created_at")) == today)
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

    # Which merchant(s) are actually fulfilling each order — admin needs to
    # see this even though customers never do (see _resolve_order_merchants).
    parts = supabase.table("order_merchant_parts").select("*").in_("order_id", order_ids).execute().data or []
    merchant_rows = supabase.table("merchants").select("id, shop_name").execute().data or []
    shop_by_id = {m["id"]: m["shop_name"] for m in merchant_rows}
    parts_by_order: dict = {}
    for p in parts:
        parts_by_order.setdefault(p["order_id"], []).append({
            "merchant_id": p["merchant_id"],
            "shop_name": "VivaPetals (in-house)" if p["merchant_id"] == HOUSE_MERCHANT_ID else shop_by_id.get(p["merchant_id"], "Unknown seller"),
            "status": p.get("status"),
            "payout_status": p.get("payout_status", "unpaid"),
            "payout": p.get("payout", 0),
        })

    for order in orders:
        order["items"] = items_by_order.get(order["id"], [])
        order["merchants"] = parts_by_order.get(order["id"], [])
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
    cancelled_ids = {o["id"] for o in all_orders if o.get("status") == "cancelled"}
    now_ist = datetime.now(IST)

    # Revenue last 30 days by IST day (excluding cancelled)
    revenue_by_day: dict = {}
    for i in range(30):
        day = (now_ist - timedelta(days=29 - i)).strftime("%Y-%m-%d")
        revenue_by_day[day] = 0.0
    for o in all_orders:
        if o.get("status") == "cancelled":
            continue
        day = _ist_day(o.get("created_at"))
        if day in revenue_by_day:
            revenue_by_day[day] += o.get("total", 0)
    revenue_chart = [{"date": d, "revenue": round(v, 2)} for d, v in revenue_by_day.items()]

    # Top products (excluding items from cancelled orders)
    all_items = supabase.table("order_items").select("order_id, product_id, name, quantity, price").execute().data or []
    product_totals: dict = {}
    for item in all_items:
        if item.get("order_id") in cancelled_ids:
            continue
        pid = item["product_id"]
        if pid not in product_totals:
            product_totals[pid] = {"name": item["name"], "qty": 0, "revenue": 0.0}
        product_totals[pid]["qty"] += item.get("quantity", 1)
        product_totals[pid]["revenue"] += item.get("price", 0) * item.get("quantity", 1)
    top_products = sorted(product_totals.values(), key=lambda x: x["revenue"], reverse=True)[:10]
    for p in top_products:
        p["revenue"] = round(p["revenue"], 2)

    # Peak hours by IST hour (excluding cancelled)
    hour_counts = [0] * 24
    for o in all_orders:
        if o.get("status") == "cancelled":
            continue
        d = _ist_dt(o.get("created_at"))
        if d:
            hour_counts[d.hour] += 1
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

def _send_contact_notification(name: str, email: str, phone: str, subject: str, message: str):
    if not RESEND_API_KEY:
        return
    subject_labels = {
        "general": "General Inquiry", "order": "Order Status",
        "delivery": "Delivery Question", "feedback": "Feedback", "other": "Other"
    }
    subject_label = subject_labels.get(subject, subject.title() if subject else "General Inquiry")
    owner_html = f"""
    <!DOCTYPE html><html><body style="margin:0;padding:0;background:#fdf0f5;font-family:'Segoe UI',Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:40px 16px;">
          <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(200,75,122,0.1);">
            <tr><td style="background:linear-gradient(135deg,#c84b7a,#9c2d55);padding:28px 40px;text-align:center;">
              <div style="color:#fff;font-size:1.3rem;font-weight:800;letter-spacing:-0.03em;">🌸 VivaPetals — New Message</div>
            </td></tr>
            <tr><td style="padding:32px 40px;">
              <p style="margin:0 0 20px;color:#555;font-size:0.95rem;">You have a new contact form submission:</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr><td style="padding:10px 0;border-bottom:1px solid #f0e0e8;color:#999;font-size:0.83rem;width:110px;">Name</td><td style="padding:10px 0;border-bottom:1px solid #f0e0e8;color:#1e1e1e;font-weight:600;">{name}</td></tr>
                <tr><td style="padding:10px 0;border-bottom:1px solid #f0e0e8;color:#999;font-size:0.83rem;">Email</td><td style="padding:10px 0;border-bottom:1px solid #f0e0e8;color:#1e1e1e;"><a href="mailto:{email}" style="color:#c84b7a;">{email}</a></td></tr>
                <tr><td style="padding:10px 0;border-bottom:1px solid #f0e0e8;color:#999;font-size:0.83rem;">Phone</td><td style="padding:10px 0;border-bottom:1px solid #f0e0e8;color:#1e1e1e;">{phone or '—'}</td></tr>
                <tr><td style="padding:10px 0;border-bottom:1px solid #f0e0e8;color:#999;font-size:0.83rem;">Subject</td><td style="padding:10px 0;border-bottom:1px solid #f0e0e8;color:#1e1e1e;">{subject_label}</td></tr>
              </table>
              <div style="margin-top:20px;padding:16px;background:#fdf0f5;border-radius:10px;border-left:4px solid #c84b7a;">
                <p style="margin:0;color:#1e1e1e;font-size:0.93rem;line-height:1.7;white-space:pre-wrap;">{message}</p>
              </div>
              <div style="margin-top:24px;text-align:center;">
                <a href="mailto:{email}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#c84b7a,#9c2d55);color:#fff;text-decoration:none;border-radius:999px;font-weight:700;font-size:0.9rem;">Reply to {name}</a>
              </div>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>
    """
    customer_html = f"""
    <!DOCTYPE html><html><body style="margin:0;padding:0;background:#fdf0f5;font-family:'Segoe UI',Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:40px 16px;">
          <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(200,75,122,0.1);">
            <tr><td style="background:linear-gradient(135deg,#c84b7a,#9c2d55);padding:32px 40px;text-align:center;">
              <div style="font-size:2rem;">🌸</div>
              <div style="color:#fff;font-size:1.5rem;font-weight:800;margin-top:8px;letter-spacing:-0.03em;">VivaPetals</div>
            </td></tr>
            <tr><td style="padding:40px;">
              <h2 style="margin:0 0 12px;color:#1e1e1e;font-size:1.25rem;font-weight:800;">Hi {name}, we got your message!</h2>
              <p style="color:#666;line-height:1.6;margin:0 0 20px;">Thanks for reaching out. We've received your message and will get back to you within <strong>24 hours</strong>.</p>
              <div style="padding:16px;background:#fdf0f5;border-radius:10px;border-left:4px solid #c84b7a;margin-bottom:24px;">
                <p style="margin:0 0 6px;color:#999;font-size:0.78rem;font-weight:600;text-transform:uppercase;">Your message</p>
                <p style="margin:0;color:#1e1e1e;font-size:0.9rem;line-height:1.6;white-space:pre-wrap;">{message}</p>
              </div>
              <p style="color:#999;font-size:0.83rem;line-height:1.6;margin:0;">If you need urgent help, WhatsApp us at <a href="https://wa.me/918555097536" style="color:#c84b7a;">+91 85550 97536</a>.</p>
              <hr style="border:none;border-top:1px solid #f0e0e8;margin:24px 0;">
              <p style="color:#bbb;font-size:0.75rem;margin:0;text-align:center;">VivaPetals · orderhere@vivapetals.com</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>
    """
    try:
        with _httpx.Client() as client:
            client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
                json={"from": "VivaPetals <orderhere@vivapetals.com>", "to": ["orderhere@vivapetals.com"], "subject": f"New message from {name} — {subject_label}", "html": owner_html},
                timeout=10
            )
            client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
                json={"from": "VivaPetals <orderhere@vivapetals.com>", "to": [email], "subject": "We received your message — VivaPetals", "html": customer_html},
                timeout=10
            )
    except Exception as e:
        print(f"[Email] Contact notification failed: {e}", flush=True)


@app.post("/api/contact")
def submit_contact(req: ContactRequest):
    supabase.table("contacts").insert({
        "name": req.name,
        "email": req.email,
        "phone": req.phone,
        "subject": req.subject,
        "message": req.message
    }).execute()
    _send_contact_notification(req.name, req.email, req.phone, req.subject, req.message)
    return {"message": "Message received successfully"}

# ── Loyalty: earn on delivery, refund on cancel ─────────────────────────────────

def award_delivery_points(order: dict):
    """Credit purchase points once an order is delivered (idempotent)."""
    email = order.get("customer_email")
    oid = order.get("id")
    if not email or not oid:
        return
    already = supabase.table("loyalty_transactions").select("id").eq("order_id", oid).eq("type", "earned_purchase").execute().data
    if already:
        return
    pts = int(order.get("total", 0) or 0)
    if pts > 0:
        award_points(email, pts, "earned_purchase", f"Points earned for delivered order {oid}", oid)
    # First delivered order → referral bonus for the referrer
    try:
        acct = supabase.table("loyalty_accounts").select("referred_by_code").eq("user_email", email).execute()
        code = acct.data[0].get("referred_by_code") if acct.data else None
        if code:
            prior = supabase.table("loyalty_transactions").select("id").eq("user_email", email).eq("type", "earned_purchase").execute()
            if len(prior.data or []) == 1:
                ref = supabase.table("loyalty_accounts").select("user_email").eq("referral_code", code).execute()
                if ref.data:
                    award_points(ref.data[0]["user_email"], 150, "earned_referral_purchase",
                                 f"Referral first-purchase bonus — {email}'s first delivered order")
    except Exception:
        pass

def refund_redeemed_points(order: dict):
    """Give back points that were redeemed on an order when it's cancelled (idempotent)."""
    email = order.get("customer_email")
    oid = order.get("id")
    if not email or not oid:
        return
    already = supabase.table("loyalty_transactions").select("id").eq("order_id", oid).eq("type", "refund_redeemed").execute().data
    if already:
        return
    txns = supabase.table("loyalty_transactions").select("points").eq("order_id", oid).eq("type", "redeemed").execute().data or []
    redeemed = sum(-int(t.get("points", 0) or 0) for t in txns)  # stored negative
    if redeemed > 0:
        award_points(email, redeemed, "refund_redeemed", f"Redeemed points refunded — order {oid} cancelled", oid)

# ── Loyalty Routes ─────────────────────────────────────────────────────────────

@app.get("/api/loyalty")
def get_loyalty(email: str):
    acct_result = supabase.table("loyalty_accounts").select("*").eq("user_email", email).execute()
    if not acct_result.data:
        raise HTTPException(status_code=404, detail="No loyalty account found")
    acct = acct_result.data[0]
    txn_result = supabase.table("loyalty_transactions").select("*").eq("user_email", email).order("created_at", desc=True).limit(20).execute()
    # Points on the way — will credit once these orders are delivered
    pending_points = 0
    try:
        orders = supabase.table("orders").select("total, status").eq("customer_email", email).execute().data or []
        pending_points = sum(int(o.get("total", 0) or 0) for o in orders if o.get("status") not in ("delivered", "cancelled"))
    except Exception:
        pending_points = 0
    return {**acct, "transactions": txn_result.data, "pending_points": pending_points}

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
    # Corporate (Petal Studio) bookings are deliberately excluded here — the
    # customer already sees full booking context (theme, branding, status)
    # in My Studio; surfacing the bare linked order too would look like an
    # unexplained duplicate. Bloom Plan orders DO belong here — My
    # Subscriptions only shows the subscription itself, not per-delivery
    # tracking, so this is the only place a customer can track one delivery.
    #
    exclude_corporate = _has_column("orders", "source")

    # Prefer user_id lookup (survives email changes); fall back to email for old orders
    if token:
        token_email = resolve_token(token)
        if token_email:
            u = supabase.table("users").select("id").eq("email", token_email).execute()
            if u.data:
                uid = u.data[0]["id"]
                query = supabase.table("orders").select("*").eq("user_id", uid)
                if exclude_corporate:
                    query = query.neq("source", "corporate")
                orders_result = query.order("created_at", desc=True).execute()
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
    query = supabase.table("orders").select("*").eq("customer_email", email)
    if exclude_corporate:
        query = query.neq("source", "corporate")
    orders_result = query.order("created_at", desc=True).execute()
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

def _cascade_status_to_parts(order_id: str, status: str):
    """Admin's (or the customer's cancel button's) direct control over the
    TOP-level order previously never touched order_merchant_parts at all —
    a cancelled order's merchant parts stayed 'confirmed' forever (so a
    merchant might still think they need to prepare it, and could even end
    up marked deliverable/payable for something that was cancelled), and an
    admin marking an order 'delivered' directly never made the merchant's
    part payable either. Fix: cancellation is an order-wide kill switch and
    applies to every not-yet-terminal part (with a heads-up to any affected
    third-party merchant); forward-progress statuses only apply to the
    house merchant's own part, since third-party merchants report their own
    prep progress via their own dashboard (merchant_update_order_status)."""
    if status not in ("preparing", "out_for_delivery", "delivered", "cancelled"):
        return
    parts = supabase.table("order_merchant_parts").select("id, merchant_id, status").eq("order_id", order_id).execute().data or []
    for p in parts:
        if p.get("status") in ("cancelled", "delivered"):
            continue  # terminal — never overwrite history
        if status != "cancelled" and p.get("merchant_id") != HOUSE_MERCHANT_ID:
            continue  # third-party progress is self-reported, not admin-forced
        supabase.table("order_merchant_parts").update({"status": status}).eq("id", p["id"]).execute()
        if status == "cancelled" and p.get("merchant_id") != HOUSE_MERCHANT_ID:
            create_user_notice(
                _merchant_email(p["merchant_id"]), "Order cancelled",
                f"Order #{order_id} was cancelled — no need to prepare it.",
                "merchant_order", order_id,
            )


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
    _cascade_status_to_parts(order_id, "cancelled")
    refund_redeemed_points(order)
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
    _cascade_status_to_parts(order_id, req.status)
    # Points: earn on delivery, refund redeemed on cancellation
    if req.status == "delivered":
        award_delivery_points(order)
    elif req.status == "cancelled":
        refund_redeemed_points(order)
    send_notifications(order_id, req.status, order.get("customer_phone") or "")
    if req.status in ORDER_STATUS_NOTICE:
        title, phrase = ORDER_STATUS_NOTICE[req.status]
        create_user_notice(order.get("customer_email"), title,
                            f"Your order #{order_id} {phrase}.", "order", order_id)
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
    """'Red Rose Bouquet x2, Sunflower x1' for an order."""
    try:
        items = supabase.table("order_items").select("name, quantity").eq("order_id", order_id).execute().data or []
        return ", ".join(f"{it.get('name')} x{it.get('quantity')}" for it in items)
    except Exception:
        return ""

def booking_items_summary(items) -> str:
    """Same for a Petal Studio booking's items JSON list."""
    return ", ".join(
        f"{it.get('product_name')} x{it.get('quantity')}"
        for it in (items or [])
    )

# Friendly status → notice text
ORDER_STATUS_NOTICE = {
    "preparing":        ("Order being prepared",   "is now being prepared"),
    "out_for_delivery": ("Order out for delivery",  "is out for delivery — arriving today!"),
    "delivered":        ("Order delivered",         "has been delivered. We hope you love it!"),
    "cancelled":        ("Order cancelled",         "was cancelled"),
}
SUB_STATUS_NOTICE = {
    "paused":    ("Subscription paused",   "was paused by our team"),
    "active":    ("Subscription resumed",  "is active again"),
    "cancelled": ("Subscription cancelled", "was cancelled"),
}
BOOKING_STATUS_NOTICE = {
    "confirmed":  ("Booking confirmed",  "is confirmed"),
    "preparing":  ("Booking in preparation", "is being prepared"),
    "completed":  ("Booking completed",  "is complete. Thank you!"),
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

@app.patch("/api/notices/{notice_id}/read")
def mark_one_notice_read(notice_id: str, email: str):
    try:
        supabase.table("user_notices").update({"read": True}).eq("id", notice_id).eq("customer_email", email).execute()
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
    supabase.table("order_items").delete().eq("order_id", order_id).execute()
    result = supabase.table("orders").delete().eq("id", order_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Order not found")
    msg = f"Your order #{order_id} was cancelled and removed by our team."
    if reason:
        msg += f" Reason: {reason}"
    create_user_notice(email, "Order removed", msg, "order", order_id)
    return {"status": "ok"}


# ── Order → merchant routing (consolidation) ─────────────────────────────────
# Goal: a customer's order should land at as FEW merchants as possible. A
# merchant's own unique product pins the order to that merchant with no
# ambiguity. Shared catalog items (same product carried by several merchants)
# should then preferentially go to a merchant the order is already pinned to
# — no need to split the order across shops just because a catalog item's
# "default" row belonged to someone else. Only when nothing pins the order
# (or the pinned merchant doesn't carry that item) do we fall back to picking
# any merchant that has it in stock.
#
# TODO(delivery-routing): once customer + merchant coordinates are used for
# real distance-based delivery, that fallback step should pick the NEAREST
# in-stock assigned merchant instead of just the first one. Merchant lat/lng
# is already stored (see merchants.latitude/longitude) for exactly this.

def _resolve_order_merchants(items: list) -> dict:
    """Map each cart line's product id -> (merchant_id, merchant_price),
    consolidating catalog (shared) items onto whichever merchant the order
    is already pinned to via a unique product, where possible."""
    products_by_id = {p["id"]: p for p in PRODUCTS}
    catalog_siblings: dict = {}
    for p in PRODUCTS:
        cid = p.get("catalog_id")
        if cid:
            catalog_siblings.setdefault(cid, []).append(p)

    # Pin the order to whichever merchant(s) own a unique (non-catalog) item
    # in the cart. The merchant with the most pinned quantity becomes the
    # "primary" merchant catalog items should consolidate onto.
    pinned_qty = Counter()
    for item in items:
        p = products_by_id.get(item.productId)
        if p and not p.get("catalog_id"):
            pinned_qty[p.get("merchant_id") or HOUSE_MERCHANT_ID] += item.quantity
    primary_merchant = pinned_qty.most_common(1)[0][0] if pinned_qty else None
    pinned_merchants = set(pinned_qty.keys())

    resolved = {}
    for item in items:
        p = products_by_id.get(item.productId)
        if not p:
            resolved[item.productId] = (HOUSE_MERCHANT_ID, 0.0)
            continue

        cid = p.get("catalog_id")
        if not cid:
            # Unique product — always fulfilled by its own (only) merchant.
            resolved[item.productId] = (p.get("merchant_id") or HOUSE_MERCHANT_ID, float(p.get("merchant_price", 0) or 0))
            continue

        live = {s["merchant_id"]: s for s in catalog_siblings.get(cid, [])
                if s.get("status") == "approved" and s.get("inStock")}
        if not live:
            # Nothing currently sellable for this catalog item anywhere —
            # keep whatever row the customer was shown so checkout can proceed.
            resolved[item.productId] = (p.get("merchant_id") or HOUSE_MERCHANT_ID, float(p.get("merchant_price", 0) or 0))
            continue

        if primary_merchant in live:
            chosen = live[primary_merchant]
        else:
            other_pin = next((mid for mid in pinned_merchants if mid in live), None)
            chosen = live[other_pin] if other_pin else next(iter(live.values()))  # TODO: nearest-by-location
        resolved[item.productId] = (chosen["merchant_id"], float(chosen.get("merchant_price", 0) or 0))

    return resolved


def _place_order_items(order_id: str, items: list, delivery_datetime: Optional[str], source: str = "retail") -> None:
    """Shared by retail checkout and Petal Studio bookings: resolve each line
    to the merchant who should fulfill it, insert order_items, split into
    order_merchant_parts, and notify the assigned merchant(s). For a
    'corporate' booking that ends up split across more than one merchant,
    also flags admins — large event orders benefit from single-seller
    coordination more than an everyday retail basket does."""
    if not items:
        return
    product_meta = _resolve_order_merchants(items)
    supabase.table("order_items").insert([
        {
            "order_id": order_id,
            "product_id": item.productId,
            "name": item.name,
            "price": item.price,
            "quantity": item.quantity,
            "merchant_id": product_meta.get(item.productId, (HOUSE_MERCHANT_ID, 0))[0],
        }
        for item in items
    ]).execute()

    delivery_day = (delivery_datetime or "")[:10] or None
    agg = {}
    for item in items:
        mid, mprice = product_meta.get(item.productId, (HOUSE_MERCHANT_ID, float(item.price)))
        a = agg.setdefault(mid, {"subtotal": 0.0, "payout": 0.0, "qty": 0})
        a["subtotal"] += float(item.price) * int(item.quantity)
        a["payout"] += mprice * int(item.quantity)
        a["qty"] += int(item.quantity)
    if not agg:
        return

    parts = []
    for mid, a in agg.items():
        subtotal = round(a["subtotal"], 2)
        payout = round(a["payout"], 2)
        parts.append({
            "order_id": order_id,
            "merchant_id": mid,
            "subtotal": subtotal,
            "commission": round(subtotal - payout, 2),   # platform profit
            "payout": payout,                            # merchant earnings
            "status": "confirmed",
            "delivery_date": delivery_day,
        })
    SOURCE_LABELS = {
        "corporate":    {"noun": "Booking",       "notice_title": "🎉 New Petal Studio booking"},
        "subscription": {"noun": "Bloom Plan order", "notice_title": "🌸 New Bloom Plan delivery"},
        "retail":       {"noun": "Order",         "notice_title": "🌸 New order"},
    }
    label = SOURCE_LABELS.get(source, SOURCE_LABELS["retail"])
    try:
        supabase.table("order_merchant_parts").insert(parts).execute()
        # Tell each assigned merchant they have something new to pack
        # (the house merchant IS the admin, so skip — they already see
        # every order in their own dashboard).
        for mid, a in agg.items():
            if mid == HOUSE_MERCHANT_ID:
                continue
            create_user_notice(
                _merchant_email(mid), label["notice_title"],
                f"{label['noun']} #{order_id} — {a['qty']} item(s) to prepare. You'll earn ₹{round(a['payout'], 2)}.",
                "merchant_order", order_id,
            )
        distinct_sellers = [mid for mid in agg if mid != HOUSE_MERCHANT_ID]
        if source == "corporate" and len(distinct_sellers) > 1:
            _notify_all_admins(
                "⚠️ Event booking spans multiple sellers",
                f"Booking #{order_id} needs {len(distinct_sellers)} different merchants to fulfill — you may want to coordinate delivery timing manually.",
                "corporate_multi_merchant", order_id,
            )
    except Exception as e:
        print(f"[Order] merchant parts insert error: {e}", flush=True)


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

    items_subtotal = sum(float(item.price) * int(item.quantity) for item in (req.items or []))
    shipping_fee = 0.0 if items_subtotal >= 50 else 9.99
    discount_amount = round(max(0.0, items_subtotal + shipping_fee - req.total), 2)

    order_row = {
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
        "shipping_fee": shipping_fee,
        "discount_amount": discount_amount,
        "promo_code": (req.promo_code or "").strip().upper() or None,
        "points_redeemed": req.points_redeemed or 0,
    }
    if _has_column("orders", "source"):
        order_row["source"] = "retail"
    if _has_column("orders", "latitude"):
        order_row["latitude"] = req.customer.get("latitude")
        order_row["longitude"] = req.customer.get("longitude")
    try:
        supabase.table("orders").insert(order_row).execute()
    except Exception as e:
        print(f"Order insert error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    _place_order_items(order_id, req.items, req.delivery_datetime, source="retail")

    points_pending = 0
    new_balance = 0

    if customer_email:
        # Deduct redeemed points now (they're used for the checkout discount)
        points_redeemed = req.points_redeemed or 0
        if points_redeemed > 0:
            acct = supabase.table("loyalty_accounts").select("points_balance").eq("user_email", customer_email).execute()
            if acct.data and acct.data[0]["points_balance"] >= points_redeemed:
                award_points(customer_email, -points_redeemed, "redeemed", f"Points redeemed at checkout for order {order_id}", order_id)

        # Points are EARNED only on delivery — report what's pending, don't credit yet.
        points_pending = int(req.total)

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

    return {"orderId": order_id, "status": "confirmed", "points_pending": points_pending, "new_balance": new_balance}

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


# ── Bloom Plan: turn a due delivery cycle into a REAL, merchant-routed order ──
# Previously a subscription never created any order at all — only reminder
# messages went out, so no merchant ever saw a Bloom Plan delivery to
# prepare. This runs daily (see _run_daily_reminders), ~1 day ahead of each
# active subscription's `next_delivery` so the merchant has prep lead time.

def _generate_subscription_orders(force: bool = False) -> dict:
    """force=True ignores the due-date check and processes every active
    subscription regardless of next_delivery — for deliberately testing that
    a subscription routes to the right merchant, without waiting for its
    actual delivery date. NOTE: this still advances next_delivery on success,
    same as the real daily run, so it does shift that subscription's future
    schedule — only use it knowingly (e.g. via the admin "force" toggle)."""
    today = datetime.now(IST).date()
    due_by = (today + timedelta(days=1)).strftime("%Y-%m-%d")  # tomorrow, or overdue
    query = supabase.table("subscriptions").select("*").eq("status", "active")
    if not force:
        query = query.lte("next_delivery", due_by)
    subs = query.execute().data or []
    summary = {"checked": len(subs), "generated": 0, "flagged": 0, "errors": 0}
    for sub in subs:
        try:
            outcome = _generate_one_subscription_order(sub)
            if outcome in summary:
                summary[outcome] += 1
        except Exception as e:
            summary["errors"] += 1
            print(f"[Bloom Plan] order generation failed for {sub.get('id')}: {e}", flush=True)
    return summary


def _generate_one_subscription_order(sub: dict) -> str:
    """Returns 'generated', 'flagged' (needs admin attention), or 'errors'."""
    sub_id = sub["id"]
    delivery_date = sub.get("next_delivery")
    items_raw = sub.get("items") or []

    if not items_raw:
        # Florist's Choice — always the house's own curated arrangement, not
        # any specific seller's product (see _ensure_florists_choice_product).
        if not FLORISTS_CHOICE_PRODUCT_ID:
            print(f"[Bloom Plan] no Florist's Choice placeholder product — skipping {sub_id}", flush=True)
            return "errors"
        order_items = [OrderItem(
            productId=FLORISTS_CHOICE_PRODUCT_ID, name="Florist's Choice (Bloom Plan)",
            price=float(sub.get("daily_total") or 0), quantity=1,
        )]
    else:
        # Don't silently substitute if a pick is no longer sellable — flag
        # admin + let the customer know there's a hiccup, then retry next run.
        products_by_id = {p["id"]: p for p in PRODUCTS}
        unavailable = [it.get("product_name") or f"#{it.get('product_id')}" for it in items_raw
                       if not (products_by_id.get(it.get("product_id"))
                               and products_by_id[it["product_id"]].get("status") == "approved"
                               and products_by_id[it["product_id"]].get("inStock"))]
        if unavailable:
            _notify_all_admins(
                "⚠️ Bloom Plan needs attention",
                f"Subscription #{sub_id} — can't fulfil {', '.join(unavailable)} for the {delivery_date} delivery. Please review and update the customer's picks.",
                "subscription_issue", sub_id,
            )
            create_user_notice(
                sub.get("customer_email"), "A quick update on your Bloom Plan",
                "We're sorting out your next delivery and will confirm shortly — sorry for the wait!",
                "subscription", sub_id,
            )
            return "flagged"  # next_delivery NOT advanced — retried automatically tomorrow

        order_items = [
            OrderItem(
                productId=it["product_id"], name=it.get("product_name") or "Item",
                price=float(it.get("daily_cost") or 0), quantity=int(it.get("quantity") or 1),
            )
            for it in items_raw
        ]

    order_id = "FLR" + str(uuid.uuid4())[:8].upper()
    total = float(sub.get("daily_total") or sum(oi.price * oi.quantity for oi in order_items))
    order_row = {
        "id": order_id,
        "customer_email": sub.get("customer_email"),
        "customer_name": sub.get("customer_name", ""),
        "customer_phone": sub.get("customer_phone", ""),
        "customer_address": sub.get("address", ""),
        "total": total,
        "status": "confirmed",
        "delivery_type": "scheduled",
        "delivery_datetime": delivery_date,
        "is_recurring": True,
        "recurrence_type": sub.get("plan"),
        "payment_method": "subscription",
    }
    if _has_column("orders", "source"):
        order_row["source"] = "subscription"
    try:
        supabase.table("orders").insert(order_row).execute()
    except Exception as e:
        print(f"[Bloom Plan] order insert failed for {sub_id}: {e}", flush=True)
        return "errors"

    _place_order_items(order_id, order_items, delivery_date, source="subscription")

    # Only advance to the next cycle once this one is safely generated.
    new_next = advance_delivery_date(sub.get("plan"), delivery_date)
    supabase.table("subscriptions").update({"next_delivery": new_next}).eq("id", sub_id).execute()
    # No separate "delivery confirmed" notice here on purpose — this order
    # now exists with delivery_datetime = tomorrow, so the SAME daily run's
    # send_reminders() pass (see _run_daily_reminders) will pick it up and
    # send the customer the normal "delivery tomorrow" SMS/WhatsApp/in-app
    # reminder through the existing, already-tested pipeline — avoids
    # double-notifying for the same delivery.
    return "generated"


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
    subs = result.data or []
    if not subs:
        return []

    # Which shop(s) will actually fulfil each subscription — computable up
    # front from the picked products' fixed ownership, even before the first
    # delivery cycle has ever been generated (see _generate_one_subscription_order).
    products_by_id = {p["id"]: p for p in PRODUCTS}
    merchant_rows = supabase.table("merchants").select("id, shop_name").execute().data or []
    shop_by_id = {m["id"]: m["shop_name"] for m in merchant_rows}

    for sub in subs:
        items = sub.get("items") or []
        if not items:
            sub["merchant_names"] = ["VivaPetals (Florist's Choice)"]
            continue
        seen, names = set(), []
        for it in items:
            p = products_by_id.get(it.get("product_id"))
            mid = (p.get("merchant_id") if p else None) or HOUSE_MERCHANT_ID
            if mid in seen:
                continue
            seen.add(mid)
            names.append("VivaPetals (in-house)" if mid == HOUSE_MERCHANT_ID else shop_by_id.get(mid, "Unknown seller"))
        sub["merchant_names"] = names or ["VivaPetals (in-house)"]
    return subs

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
        msg = f"Your Bloom Plan #{sub_id} {phrase}."
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
    # Soft-cancel: keep the record so the customer still sees it with the message.
    supabase.table("subscriptions").update({"status": "cancelled", "admin_message": reason}).eq("id", sub_id).execute()
    msg = f"Your Bloom Plan #{sub_id} was cancelled by our team."
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


@app.post("/api/admin/subscriptions/generate")
def admin_generate_subscription_orders(token: str, force: bool = False):
    """Manually run the Bloom Plan → real-order generation pass instead of
    waiting for the 8am cron. By default only processes subscriptions
    actually due tomorrow (or overdue) — same as the real cron. force=True
    processes EVERY active subscription regardless of its delivery date, for
    deliberately testing merchant routing; it still advances next_delivery
    on success, so it does shift that subscription's future schedule."""
    require_admin(token)
    return _generate_subscription_orders(force=force)


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
    select_cols = "contact_email, linked_order_id" if _has_column("corporate_orders", "linked_order_id") else "contact_email"
    existing = supabase.table("corporate_orders").select(select_cols).eq("id", order_id).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Booking not found")
    email = existing[0].get("contact_email")
    linked_id = existing[0].get("linked_order_id")
    if linked_id:
        supabase.table("orders").update({"status": "cancelled"}).eq("id", linked_id).execute()
        _cascade_status_to_parts(linked_id, "cancelled")
    # Soft-cancel: keep the record (marked cancelled) so the customer still
    # sees it in My Studio with the admin's message.
    supabase.table("corporate_orders").update({"status": "cancelled", "admin_message": reason}).eq("id", order_id).execute()
    msg = f"Your Petal Studio booking #{order_id} was cancelled by our team."
    if reason:
        msg += f" Reason: {reason}"
    create_user_notice(email, "Booking cancelled", msg, "booking", order_id)
    return {"status": "cancelled"}

class CorporateStatusUpdate(BaseModel):
    status: str
    admin_message: Optional[str] = None


def _create_linked_corporate_order(booking: dict) -> Optional[str]:
    """Build a real orders/order_items/order_merchant_parts trail for a
    just-confirmed Petal Studio booking, so the assigned merchant(s) see it
    in their own dashboard exactly like any other order — previously a
    corporate booking never routed to merchants at all, confirmed or not.
    The booking's bulk discount is applied proportionally to each line so
    order-item subtotals sum to what the customer is actually charged;
    merchant payout stays flat (their own price × qty), so the discount
    comes out of the platform's margin, not the merchant's earnings."""
    items = booking.get("items") or []
    total_amount = float(booking.get("total_amount", 0) or 0)
    final_amount = float(booking.get("final_amount", 0) or 0)
    ratio = (final_amount / total_amount) if total_amount else 1.0

    order_items = [
        OrderItem(
            productId=it.get("product_id"), name=it.get("product_name") or "Item",
            price=round(float(it.get("unit_price", 0) or 0) * ratio, 2),
            quantity=int(it.get("quantity", 0) or 0),
        )
        for it in items if it.get("product_id") is not None and int(it.get("quantity", 0) or 0) > 0
    ]
    if not order_items:
        return None

    order_id = "FLR" + str(uuid.uuid4())[:8].upper()
    order_row = {
        "id": order_id,
        "customer_email": booking.get("contact_email"),
        "customer_name": booking.get("contact_name", ""),
        "customer_phone": "",
        "customer_address": booking.get("delivery_address", ""),
        "total": final_amount,
        "status": "confirmed",
        "delivery_type": "scheduled",
        "delivery_datetime": booking.get("delivery_date"),
        "is_recurring": False,
        "payment_method": "corporate_invoice",
    }
    if _has_column("orders", "source"):
        order_row["source"] = "corporate"
    try:
        supabase.table("orders").insert(order_row).execute()
    except Exception as e:
        print(f"[Corporate] linked order creation failed: {e}", flush=True)
        return None

    _place_order_items(order_id, order_items, booking.get("delivery_date"), source="corporate")
    return order_id


@app.patch("/api/admin/corporate-orders/{order_id}/status")
def admin_update_corporate_status(order_id: str, req: CorporateStatusUpdate, token: str):
    require_admin(token)
    valid = {"pending", "confirmed", "preparing", "completed", "cancelled"}
    if req.status not in valid:
        raise HTTPException(status_code=400, detail="Invalid status")
    existing = supabase.table("corporate_orders").select("*").eq("id", order_id).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Booking not found")
    booking = existing[0]
    email = booking.get("contact_email")

    update_fields = {"status": req.status}
    if req.status == "cancelled" and req.admin_message:
        update_fields["admin_message"] = req.admin_message

    has_linking = _has_column("corporate_orders", "linked_order_id")
    # First confirmation routes the booking to its merchant(s) for real. Only
    # attempted once the migration's actually been run — without the column
    # to persist linked_order_id, we can't tell "already linked" from "not
    # yet", and would risk creating a duplicate linked order (and duplicate
    # merchant notifications) on every re-save.
    if has_linking and req.status == "confirmed" and not booking.get("linked_order_id"):
        linked_id = _create_linked_corporate_order(booking)
        if linked_id:
            update_fields["linked_order_id"] = linked_id

    if has_linking and req.status == "cancelled" and booking.get("linked_order_id"):
        supabase.table("orders").update({"status": "cancelled"}).eq("id", booking["linked_order_id"]).execute()
        _cascade_status_to_parts(booking["linked_order_id"], "cancelled")

    supabase.table("corporate_orders").update(update_fields).eq("id", order_id).execute()

    if req.status in BOOKING_STATUS_NOTICE:
        title, phrase = BOOKING_STATUS_NOTICE[req.status]
        msg = f"Your Petal Studio booking #{order_id} {phrase}."
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
        # Must run BEFORE send_reminders() below — a Bloom Plan cycle
        # generated here (delivery tomorrow) needs to already exist in
        # `orders` so the SAME run's reminder scan picks it up and texts
        # the customer, instead of waiting an extra day.
        _generate_subscription_orders()
    except Exception as e:
        print(f"[scheduler] Bloom Plan generation error: {e}")
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
