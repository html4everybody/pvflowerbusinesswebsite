from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import uuid
import os
from datetime import datetime, timedelta
from dotenv import load_dotenv
from supabase import create_client, Client
import bcrypt
from twilio.rest import Client as TwilioClient

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
_reminder_from_email = os.getenv("REMINDER_FROM_EMAIL", "reminders@floranflowers.com")
if _resend_api_key:
    _resend_lib.api_key = _resend_api_key

app = FastAPI(title="FloranFlowers API")

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

# ── Password helpers ───────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

# ── In-memory token store ──────────────────────────────────────────────────────
tokens: dict = {}

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
    except Exception:
        pass  # Silently fail so orders/registrations still succeed

def create_loyalty_account(email: str, referred_by_code: str = None) -> str:
    """Create loyalty_accounts row, award welcome bonus, handle referral signup bonus."""
    ref_code = generate_referral_code()
    referred_by = None
    if referred_by_code:
        referrer = supabase.table("loyalty_accounts").select("user_email").eq("referral_code", referred_by_code).execute()
        if referrer.data:
            referred_by = referred_by_code
    try:
        supabase.table("loyalty_accounts").insert({
            "user_email": email,
            "points_balance": 0,
            "points_earned_total": 0,
            "referral_code": ref_code,
            "referred_by_code": referred_by
        }).execute()
    except Exception:
        pass
    # Welcome bonus
    award_points(email, 100, "earned_welcome", "Welcome bonus for joining FloranFlowers")
    # Referral signup bonus: 200 pts to referrer
    if referred_by_code and referred_by:
        referrer_result = supabase.table("loyalty_accounts").select("user_email").eq("referral_code", referred_by_code).execute()
        if referrer_result.data:
            referrer_email = referrer_result.data[0]["user_email"]
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
      <span style="color:white;font-size:1.05rem;font-weight:700;letter-spacing:0.01em;">FloranFlowers</span>
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
        Thank you for choosing FloranFlowers 🌸<br>
        If you have questions, reply to this email or visit our website.
      </p>
    </div>
  </div>
</body>
</html>
"""

def send_email_reminder(order: dict, days_before: int, is_recurrence: bool = False) -> bool:
    if not _resend_api_key or not order.get("customer_email"):
        return False
    timing = "tomorrow" if days_before == 1 else f"in {days_before} days"
    kind = "Anniversary" if is_recurrence else "Scheduled"
    try:
        _resend_lib.Emails.send({
            "from": _reminder_from_email,
            "to": [order["customer_email"]],
            "subject": f"Your FloranFlowers {kind} Delivery is {timing.title()}! 🌸",
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
        f"FloranFlowers Reminder: Your {kind} flower delivery "
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

# ── Products (in-memory) ───────────────────────────────────────────────────────
PRODUCTS = [
    {"id": 1, "name": "Red Rose Bouquet", "description": "A stunning arrangement of 12 premium red roses, perfect for expressing love and romance.", "price": 49.99, "image": "https://res.cloudinary.com/duf4t01vy/image/upload/v1771819102/ChatGPT_Image_Feb_22_2026_10_57_56_PM_nxsgri.png", "category": "Garlands", "inStock": True},
    {"id": 2, "name": "Sunflower Delight", "description": "Bright and cheerful sunflowers that bring warmth and happiness to any space.", "price": 34.99, "image": "https://res.cloudinary.com/duf4t01vy/image/upload/v1771818621/ChatGPT_Image_Feb_22_2026_10_49_55_PM_zopiuw.png", "category": "Garlands", "inStock": True},
    {"id": 3, "name": "Elegant Lily Collection", "description": "Pure white lilies symbolizing elegance and sophistication.", "price": 54.99, "image": "https://res.cloudinary.com/duf4t01vy/image/upload/v1771819265/ChatGPT_Image_Feb_22_2026_11_00_56_PM_vrgztm.png", "category": "Garlands", "inStock": True},
    {"id": 4, "name": "Mixed Spring Bouquet", "description": "A colorful mix of seasonal spring flowers including tulips, daisies, and carnations.", "price": 39.99, "image": "https://res.cloudinary.com/duf4t01vy/image/upload/v1771819326/ChatGPT_Image_Feb_22_2026_11_01_54_PM_ehrqxd.png", "category": "Garlands", "inStock": True},
    {"id": 5, "name": "Pink Peony Paradise", "description": "Lush pink peonies that exude romance and charm.", "price": 64.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Flowers", "inStock": True},
    {"id": 6, "name": "Orchid Elegance", "description": "Exotic orchids that add a touch of luxury to any setting.", "price": 79.99, "image": "https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400", "category": "Flowers", "inStock": True},
    {"id": 7, "name": "Lavender Dreams", "description": "Fragrant lavender bundles perfect for relaxation and home decor.", "price": 29.99, "image": "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400", "category": "Flowers", "inStock": True},
    {"id": 8, "name": "Tropical Paradise", "description": "Exotic tropical flowers including birds of paradise and hibiscus.", "price": 69.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Flowers", "inStock": True},
    {"id": 9, "name": "White Rose Serenity", "description": "Pure white roses symbolizing peace, purity, and new beginnings.", "price": 44.99, "image": "https://images.unsplash.com/photo-1559563362-c667ba5f5480?w=400", "category": "Bouquets", "inStock": True},
    {"id": 10, "name": "Tulip Festival", "description": "Vibrant tulips in assorted colors celebrating the beauty of spring.", "price": 36.99, "image": "https://images.unsplash.com/photo-1520763185298-1b434c919102?w=400", "category": "Flowers", "inStock": True},
    {"id": 11, "name": "Carnation Charm", "description": "Long-lasting carnations in beautiful shades of pink and red.", "price": 27.99, "image": "https://images.unsplash.com/photo-1526047932273-341f2a7631f9?w=400", "category": "Flowers", "inStock": True},
    {"id": 12, "name": "Premium Flower Box", "description": "Luxury arrangement in an elegant gift box, perfect for special occasions.", "price": 89.99, "image": "https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=400", "category": "Gifts", "inStock": True},
    {"id": 13, "name": "Yellow Rose Sunshine", "description": "Bright yellow roses representing friendship and joy.", "price": 42.99, "image": "https://images.unsplash.com/photo-1455659817273-f96807779a8a?w=400", "category": "Flowers", "inStock": True},
    {"id": 14, "name": "Daisy Meadow", "description": "Fresh white daisies bringing simplicity and charm.", "price": 24.99, "image": "https://images.unsplash.com/photo-1606041008023-472dfb5e530f?w=400", "category": "Flowers", "inStock": True},
    {"id": 15, "name": "Hydrangea Heaven", "description": "Beautiful blue hydrangeas perfect for home decoration.", "price": 52.99, "image": "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=400", "category": "Flowers", "inStock": True},
    {"id": 16, "name": "Cherry Blossom Branch", "description": "Delicate cherry blossoms symbolizing renewal and hope.", "price": 47.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Bouquets", "inStock": True},
    {"id": 17, "name": "Gerbera Fiesta", "description": "Colorful gerbera daisies bringing vibrant energy to any room.", "price": 32.99, "image": "https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=400", "category": "Flowers", "inStock": True},
    {"id": 18, "name": "Calla Lily Grace", "description": "Elegant calla lilies for sophisticated arrangements.", "price": 58.99, "image": "https://images.unsplash.com/photo-1606041008023-472dfb5e530f?w=400", "category": "Flowers", "inStock": True},
    {"id": 19, "name": "Wildflower Mix", "description": "Natural wildflower bouquet with rustic charm.", "price": 35.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Bouquets", "inStock": True},
    {"id": 20, "name": "Ranunculus Delight", "description": "Layered ranunculus blooms in soft pastel colors.", "price": 45.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 21, "name": "Purple Iris Elegance", "description": "Stunning purple irises with elegant form.", "price": 38.99, "image": "https://images.unsplash.com/photo-1566873535350-a3f5d4a804b7?w=400", "category": "Flowers", "inStock": True},
    {"id": 22, "name": "Protea Exotic", "description": "Unique South African protea flowers.", "price": 72.99, "image": "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=400", "category": "Flowers", "inStock": True},
    {"id": 23, "name": "Dahlia Dreams", "description": "Gorgeous dahlias in rich autumn colors.", "price": 48.99, "image": "https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=400", "category": "Flowers", "inStock": True},
    {"id": 24, "name": "Anemone Beauty", "description": "Delicate anemones with striking dark centers.", "price": 41.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
    {"id": 25, "name": "Chrysanthemum Burst", "description": "Full chrysanthemum blooms in various colors.", "price": 33.99, "image": "https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=400", "category": "Garlands", "inStock": True},
    {"id": 26, "name": "Freesia Fragrance", "description": "Sweetly scented freesias in soft hues.", "price": 36.99, "image": "https://images.unsplash.com/photo-1606041008023-472dfb5e530f?w=400", "category": "Flowers", "inStock": True},
    {"id": 27, "name": "Amaryllis Red", "description": "Bold red amaryllis for dramatic displays.", "price": 55.99, "image": "https://images.unsplash.com/photo-1518882605630-8eb920bc4c49?w=400", "category": "Flowers", "inStock": True},
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

# ── Promo Codes (in-memory) ────────────────────────────────────────────────────
PROMO_CODES = {
    "WELCOME10": {"type": "percent", "value": 10, "description": "10% off your first order", "first_order_only": True, "min_order": 0, "active": True},
    "SUMMER20":  {"type": "percent", "value": 20, "description": "20% off orders above ₹500", "first_order_only": False, "min_order": 500, "active": True},
    "FLAT100":   {"type": "flat",    "value": 100, "description": "₹100 off on orders above ₹800", "first_order_only": False, "min_order": 800, "active": True},
    "BUNDLE15":  {"type": "percent", "value": 15, "description": "15% off on bundle deals", "first_order_only": False, "min_order": 0, "active": True},
    "FLORANVIP": {"type": "percent", "value": 25, "description": "VIP exclusive — 25% off orders above ₹1000", "first_order_only": False, "min_order": 1000, "active": True},
}

SEASONAL_OFFERS = [
    {"id": "spring",  "emoji": "🌸", "title": "Spring Sale",    "subtitle": "Up to 20% off on all bouquets",     "code": "SUMMER20",  "badge": "Limited Time"},
    {"id": "bundle",  "emoji": "🎁", "title": "Bundle & Save",  "subtitle": "Buy a bundle and save 15%",          "code": "BUNDLE15",  "badge": "Bundle Deal"},
    {"id": "newuser", "emoji": "🎉", "title": "New Here?",       "subtitle": "10% off your very first order",      "code": "WELCOME10", "badge": "First Order"},
    {"id": "vip",     "emoji": "💎", "title": "VIP Offer",       "subtitle": "25% off orders above ₹1000",         "code": "FLORANVIP", "badge": "VIP Only"},
]

BUNDLE_DEALS = [
    {"id": "romance",  "name": "Romance Bundle",    "description": "Perfect for date nights and anniversaries", "emoji": "❤️", "product_ids": [1, 5, 42],   "promo_code": "BUNDLE15", "savings_pct": 15},
    {"id": "wedding",  "name": "Wedding Elegance",  "description": "Everything for a perfect wedding",           "emoji": "💍", "product_ids": [94, 9, 42],  "promo_code": "BUNDLE15", "savings_pct": 15},
    {"id": "birthday", "name": "Birthday Surprise", "description": "Make their birthday extra special",          "emoji": "🎂", "product_ids": [76, 4, 14],  "promo_code": "BUNDLE15", "savings_pct": 15},
]

# ── Order Status ───────────────────────────────────────────────────────────────
STATUS_MESSAGES = {
    "preparing":        "🌸 FloranFlowers: Your order {order_id} is being prepared! We're arranging your blooms.",
    "out_for_delivery": "🚚 FloranFlowers: Your order {order_id} is out for delivery! Our driver is on the way.",
    "delivered":        "🌺 FloranFlowers: Your order {order_id} has been delivered! Thank you for choosing FloranFlowers.",
    "cancelled":        "💔 FloranFlowers: Your order {order_id} has been cancelled. Contact us if you need help.",
}

VALID_STATUS_TRANSITIONS = {
    "confirmed":        ["preparing", "cancelled"],
    "preparing":        ["out_for_delivery", "cancelled"],
    "out_for_delivery": ["delivered"],
    "delivered":        [],
    "cancelled":        [],
}

# ── Pydantic Models ────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str

class RegisterRequest(BaseModel):
    firstName: str
    lastName: str
    email: str
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

class UpdateDeliveryRequest(BaseModel):
    delivery_type: str
    delivery_datetime: Optional[str] = None

class StatusUpdateRequest(BaseModel):
    status: str

class CartItemRequest(BaseModel):
    user_id: str
    product_id: int
    quantity: int

class SubscriptionRequest(BaseModel):
    customer_email: str
    customer_name: str
    plan: str                          # weekly | biweekly | monthly
    style: str                         # seasonal | fixed
    fixed_product_id: Optional[int] = None
    fixed_product_name: Optional[str] = None
    address: str

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

# ── Auth Routes ────────────────────────────────────────────────────────────────

@app.post("/api/auth/register")
def register(req: RegisterRequest):
    existing = supabase.table("users").select("email").eq("email", req.email).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed_password = hash_password(req.password)

    result = supabase.table("users").insert({
        "email": req.email,
        "password": hashed_password,
        "first_name": req.firstName,
        "last_name": req.lastName
    }).execute()

    user = result.data[0]
    token = str(uuid.uuid4())
    tokens[token] = req.email

    create_loyalty_account(req.email, req.referral_code)

    return {
        "token": token,
        "user": {
            "id": user["id"],
            "firstName": user["first_name"],
            "lastName": user["last_name"],
            "email": user["email"]
        }
    }

@app.post("/api/auth/login")
def login(req: LoginRequest):
    result = supabase.table("users").select("*").eq("email", req.email).execute()
    if not result.data:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user = result.data[0]
    if not verify_password(req.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = str(uuid.uuid4())
    tokens[token] = req.email

    return {
        "token": token,
        "user": {
            "id": user["id"],
            "firstName": user["first_name"],
            "lastName": user["last_name"],
            "email": user["email"]
        }
    }

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
    promo = PROMO_CODES.get(code)
    if not promo or not promo["active"]:
        raise HTTPException(status_code=404, detail="Invalid promo code")
    if req.order_total < promo["min_order"]:
        raise HTTPException(status_code=400, detail=f"Minimum order ₹{promo['min_order']} required for this code")
    if promo["first_order_only"]:
        if not req.customer_email:
            raise HTTPException(status_code=400, detail="Code valid for first order only")
        existing_orders = supabase.table("orders").select("id").eq("customer_email", req.customer_email).execute()
        if existing_orders.data:
            raise HTTPException(status_code=400, detail="Code valid for first order only")
    if promo["type"] == "percent":
        discount_amount = round(req.order_total * promo["value"] / 100, 2)
    else:
        discount_amount = min(promo["value"], req.order_total)
    return {
        "valid": True,
        "code": code,
        "discount_type": promo["type"],
        "discount_value": promo["value"],
        "discount_amount": discount_amount,
        "description": promo["description"]
    }

@app.get("/api/offers")
def get_offers():
    enriched_bundles = []
    for bundle in BUNDLE_DEALS:
        products = [p for p in PRODUCTS if p["id"] in bundle["product_ids"]]
        # preserve order of product_ids
        products_ordered = sorted(products, key=lambda p: bundle["product_ids"].index(p["id"]))
        original_price = sum(p["price"] for p in products_ordered)
        bundle_price = round(original_price * (1 - bundle["savings_pct"] / 100), 2)
        enriched_bundles.append({
            **bundle,
            "products": products_ordered,
            "original_price": round(original_price, 2),
            "bundle_price": bundle_price
        })
    return {"seasonal_offers": SEASONAL_OFFERS, "bundle_deals": enriched_bundles}

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
def get_user_orders(email: str):
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
    if order["status"] not in ("confirmed", "preparing"):
        raise HTTPException(status_code=400, detail="Only confirmed or preparing orders can be cancelled")
    supabase.table("orders").update({"status": "cancelled"}).eq("id", order_id).execute()
    send_notifications(order_id, "cancelled", order.get("customer_phone") or "")
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
    return {"status": req.status}

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

    supabase.table("orders").insert({
        "id": order_id,
        "customer_email": customer_email,
        "customer_name": req.customer.get("name", ""),
        "customer_phone": req.customer.get("phone", ""),
        "total": req.total,
        "status": "confirmed",
        "delivery_type": req.delivery_type,
        "delivery_datetime": req.delivery_datetime,
        "is_recurring": req.is_recurring,
        "recurrence_type": req.recurrence_type,
        "next_recurrence_date": next_recurrence_date,
    }).execute()

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

    return {"orderId": order_id, "status": "confirmed", "points_earned": points_earned, "new_balance": new_balance}

# ── Subscription helpers ────────────────────────────────────────────────────────

PLAN_INTERVALS = {"weekly": 7, "biweekly": 14, "monthly": 30}

def next_delivery_date(plan: str) -> str:
    days = PLAN_INTERVALS.get(plan, 7)
    return (datetime.utcnow() + timedelta(days=days)).strftime("%Y-%m-%d")

def advance_delivery_date(plan: str, current: str) -> str:
    days = PLAN_INTERVALS.get(plan, 7)
    try:
        base = datetime.strptime(current, "%Y-%m-%d")
    except Exception:
        base = datetime.utcnow()
    return (base + timedelta(days=days)).strftime("%Y-%m-%d")

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

@app.post("/api/subscriptions")
def create_subscription(req: SubscriptionRequest):
    sub_id = "SUB" + str(uuid.uuid4())[:8].upper()
    supabase.table("subscriptions").insert({
        "id": sub_id,
        "customer_email": req.customer_email,
        "customer_name": req.customer_name,
        "plan": req.plan,
        "style": req.style,
        "fixed_product_id": req.fixed_product_id,
        "fixed_product_name": req.fixed_product_name,
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

# ── Corporate Orders ────────────────────────────────────────────────────────────

class CorporateOrderRequest(BaseModel):
    company_name: str
    contact_name: str
    contact_email: str
    product_id: int
    product_name: str
    unit_price: float
    quantity: int
    branding_logo_url: Optional[str] = None
    branding_message: Optional[str] = None
    delivery_address: str
    delivery_date: Optional[str] = None
    is_recurring: bool = False
    recurring_day: Optional[str] = None
    recurring_frequency: Optional[str] = None

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

@app.post("/api/corporate-orders")
def create_corporate_order(req: CorporateOrderRequest):
    order_id = "CGT" + str(uuid.uuid4())[:8].upper()
    discount = corp_discount(req.quantity)
    total_amount = round(req.unit_price * req.quantity, 2)
    final_amount = round(total_amount * (1 - discount / 100), 2)
    nd = None
    if req.is_recurring and req.recurring_day and req.recurring_frequency:
        nd = next_corp_delivery(req.recurring_day, req.recurring_frequency)
    supabase.table("corporate_orders").insert({
        "id": order_id,
        "company_name": req.company_name,
        "contact_name": req.contact_name,
        "contact_email": req.contact_email,
        "product_id": req.product_id,
        "product_name": req.product_name,
        "quantity": req.quantity,
        "unit_price": req.unit_price,
        "discount_pct": discount,
        "total_amount": total_amount,
        "final_amount": final_amount,
        "branding_logo_url": req.branding_logo_url,
        "branding_message": req.branding_message,
        "delivery_address": req.delivery_address,
        "delivery_date": req.delivery_date,
        "is_recurring": req.is_recurring,
        "recurring_day": req.recurring_day,
        "recurring_frequency": req.recurring_frequency,
        "next_delivery": nd,
        "status": "pending",
    }).execute()
    return {"id": order_id, "final_amount": final_amount, "next_delivery": nd}

@app.patch("/api/corporate-orders/{order_id}/cancel")
def cancel_corporate_order(order_id: str):
    result = supabase.table("corporate_orders").select("id").eq("id", order_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Corporate order not found")
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
