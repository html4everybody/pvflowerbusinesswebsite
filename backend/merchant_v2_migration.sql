-- ============================================================================
-- VivaPetals Marketplace v2 — product approval + dual pricing (admin markup)
-- Run all at once in Supabase → SQL Editor. Idempotent & safe to re-run.
--
-- Model: the MERCHANT sets `merchant_price` (what they earn). The ADMIN sets
-- `price` (the selling price shown to customers) + `discount_percent`. Platform
-- profit = price - merchant_price. Products go through an approval workflow.
-- ============================================================================

-- merchant_price: what the seller wants to earn per unit
ALTER TABLE products ADD COLUMN IF NOT EXISTS merchant_price NUMERIC NOT NULL DEFAULT 0;

-- status: pending (awaiting admin) | approved (live) | rejected
ALTER TABLE products ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';

-- reason shown to the merchant when a product is rejected
ALTER TABLE products ADD COLUMN IF NOT EXISTS reject_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

-- Note: two dummy merchant accounts + sample products are seeded automatically
-- by the backend on startup (seed_dummy_merchants) so passwords are hashed
-- correctly. Logins:  merchant1@vivapetals.com / merchant2@vivapetals.com
--                     password (both):  Merchant@123
