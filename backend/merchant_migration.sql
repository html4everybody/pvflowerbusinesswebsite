-- ============================================================================
-- VivaPetals Marketplace — Merchant role foundation
-- Run all at once in Supabase → SQL Editor. Idempotent & safe to re-run.
-- ============================================================================

-- 1. Roles on users ----------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'customer';
UPDATE users SET role = 'admin' WHERE is_admin = TRUE AND role <> 'admin';

-- 2. Merchants (shop) table --------------------------------------------------
CREATE TABLE IF NOT EXISTS merchants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    shop_name       TEXT NOT NULL,
    slug            TEXT UNIQUE,
    logo            TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    phone           TEXT NOT NULL DEFAULT '',
    email           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | suspended
    commission_rate NUMERIC NOT NULL DEFAULT 15,        -- platform % per sale
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. House merchant (the official VivaPetals store), fixed id, 0% commission --
INSERT INTO merchants (id, user_id, shop_name, slug, status, commission_rate, description)
VALUES ('00000000-0000-0000-0000-000000000001',
        (SELECT id FROM users WHERE is_admin = TRUE LIMIT 1),
        'VivaPetals', 'vivapetals', 'approved', 0, 'Official VivaPetals store')
ON CONFLICT (id) DO NOTHING;

-- 4. Product ownership + merchant-set discount -------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS merchant_id      UUID REFERENCES merchants(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_percent NUMERIC NOT NULL DEFAULT 0;
UPDATE products SET merchant_id = '00000000-0000-0000-0000-000000000001' WHERE merchant_id IS NULL;

-- 5. Stamp each order line with its merchant ---------------------------------
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id);
UPDATE order_items SET merchant_id = '00000000-0000-0000-0000-000000000001' WHERE merchant_id IS NULL;

-- 6. Per-merchant fulfillment part of an order (own status + delivery date) ---
CREATE TABLE IF NOT EXISTS order_merchant_parts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    merchant_id   UUID NOT NULL REFERENCES merchants(id),
    subtotal      NUMERIC NOT NULL DEFAULT 0,
    commission    NUMERIC NOT NULL DEFAULT 0,   -- platform's cut
    payout        NUMERIC NOT NULL DEFAULT 0,   -- merchant's net
    status        TEXT NOT NULL DEFAULT 'confirmed',
    delivery_date TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id, merchant_id)
);

-- 7. Backfill parts for all existing orders (house merchant, 0% commission) ---
INSERT INTO order_merchant_parts (order_id, merchant_id, subtotal, commission, payout, status, delivery_date)
SELECT oi.order_id,
       oi.merchant_id,
       SUM(oi.price * oi.quantity),
       0,
       SUM(oi.price * oi.quantity),
       COALESCE(o.status, 'confirmed'),
       LEFT(o.delivery_datetime, 10)
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
GROUP BY oi.order_id, oi.merchant_id, o.status, o.delivery_datetime
ON CONFLICT (order_id, merchant_id) DO NOTHING;

-- 8. Indexes for fast merchant-scoped queries --------------------------------
CREATE INDEX IF NOT EXISTS idx_products_merchant     ON products(merchant_id);
CREATE INDEX IF NOT EXISTS idx_order_items_merchant  ON order_items(merchant_id);
CREATE INDEX IF NOT EXISTS idx_omp_merchant          ON order_merchant_parts(merchant_id);
CREATE INDEX IF NOT EXISTS idx_omp_order             ON order_merchant_parts(order_id);
CREATE INDEX IF NOT EXISTS idx_merchants_user        ON merchants(user_id);
