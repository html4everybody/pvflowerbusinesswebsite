-- ============================================================================
-- VivaPetals Marketplace v3 — shared catalog products + merchant location
-- Run all at once in Supabase → SQL Editor. Idempotent & safe to re-run.
--
-- Model: the ADMIN creates a "catalog product" (e.g. "Red Roses Bouquet") with
-- ONE base price (what each assigned merchant earns) and ONE selling price
-- (what customers pay, same across the whole market). The admin assigns it to
-- several merchants; each gets their own row in `products` (so all existing
-- order/checkout/payout logic keeps working unchanged), linked together via
-- `catalog_id`. Merchants can only toggle stock on these — price/name/etc
-- stay admin-controlled. This is separate from a merchant's own unique
-- products, which still go through the existing submit → admin-approve flow.
-- ============================================================================

-- 1. Merchant location — stored now so a later "nearest merchant" delivery
--    router can use it without another migration. Distance logic itself is
--    NOT implemented yet (deferred per product decision).
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS address   TEXT NOT NULL DEFAULT '';
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS city      TEXT NOT NULL DEFAULT '';
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS state     TEXT NOT NULL DEFAULT '';
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS pincode   TEXT NOT NULL DEFAULT '';
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS latitude  NUMERIC;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS longitude NUMERIC;

-- 2. Catalog products — the admin's master listing (one row per shared item).
CREATE TABLE IF NOT EXISTS catalog_products (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL,
    description       TEXT NOT NULL DEFAULT '',
    image             TEXT NOT NULL DEFAULT '',
    category          TEXT NOT NULL DEFAULT '',
    price             NUMERIC NOT NULL DEFAULT 0,   -- selling price (same everywhere)
    merchant_price    NUMERIC NOT NULL DEFAULT 0,   -- what each assigned merchant earns per unit
    discount_percent  NUMERIC NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'active',  -- active | archived
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Link products rows back to their catalog parent. Each assigned merchant
--    gets their own `products` row (own id, own merchant_id, own stock) so
--    checkout/order_items/order_merchant_parts need ZERO changes — a catalog
--    row IS just a normal product row with catalog_id set.
ALTER TABLE products ADD COLUMN IF NOT EXISTS catalog_id UUID REFERENCES catalog_products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_catalog   ON products(catalog_id);
CREATE INDEX IF NOT EXISTS idx_catalog_status      ON catalog_products(status);
