-- ============================================================================
-- VivaPetals Marketplace v7 — Petal Studio (corporate) real order routing
-- Run all at once in Supabase → SQL Editor. Idempotent & safe to re-run.
--
-- Corporate bookings previously never touched the merchant-fulfillment
-- system at all — no merchant ever saw a Petal Studio booking as something
-- to prepare. This links a confirmed booking to a real `orders` row so it
-- flows through the exact same merchant-split/payout/notification pipeline
-- a normal checkout uses.
-- ============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'retail';  -- retail | corporate | subscription
ALTER TABLE corporate_orders ADD COLUMN IF NOT EXISTS linked_order_id TEXT REFERENCES orders(id);

CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source);
