-- ============================================================================
-- VivaPetals — combined pending migrations
-- Run this once in the Supabase SQL editor. All statements are idempotent
-- (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS), so it's safe to re-run if
-- you're ever unsure what's already applied.
--
-- (Petal Rewards tables and delivery_pricing.base_price from the previous
-- batch are already applied — this file now only has what's new.)
-- ============================================================================

-- ── Historically-accurate points-discount display ───────────────────────────
-- The redemption rate is admin-editable and can change after an order is
-- placed — storing the actual ₹ value computed at order time (instead of
-- every page recomputing it from points_redeemed ÷ whatever the rate
-- happens to be later) is what keeps an old order's displayed breakdown
-- accurate forever. Defaults to 0 and is only populated for new orders.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_discount_amount NUMERIC DEFAULT 0;

-- ── Optional delivery coordinates for Bloom Plan subscriptions and Petal
-- Studio corporate bookings ─────────────────────────────────────────────────
-- Without these, a merchant's delivery-radius cap silently can't be
-- enforced for these two order types (it already works for retail
-- checkout, which has always captured coordinates). Columns are
-- nullable/unused until the respective frontend forms add a location
-- picker; the backend already reads them if present.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS longitude NUMERIC;

ALTER TABLE corporate_orders ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE corporate_orders ADD COLUMN IF NOT EXISTS longitude NUMERIC;

-- ── COD vs prepaid settlement direction ─────────────────────────────────────
-- Pay-on-Delivery orders: the merchant's own delivery person collects the
-- full price at the door, so the merchant owes VivaPetals its commission
-- back — the OPPOSITE direction from every other payment method, where
-- VivaPetals collects up front and owes the merchant their payout. Without
-- this column every order is treated as the "we owe them" direction, which
-- is wrong for COD. Existing rows default to 'platform_collected' (their
-- pre-existing, correct behavior).
ALTER TABLE order_merchant_parts ADD COLUMN IF NOT EXISTS collection_type TEXT DEFAULT 'platform_collected';

-- ── Delivery photo proof ─────────────────────────────────────────────────────
-- A merchant can attach a photo when marking their part delivered; shown to
-- the customer on order-detail/track-order as delivery confirmation.
ALTER TABLE order_merchant_parts ADD COLUMN IF NOT EXISTS delivery_photo_url TEXT;
