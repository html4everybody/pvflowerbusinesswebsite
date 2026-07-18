-- Run this once in your Supabase SQL editor.
-- It creates the products table (if missing) and adds any missing columns
-- needed by the current backend. Safe to re-run — all statements are IF NOT EXISTS.

-- 1. Base table
CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price       NUMERIC NOT NULL DEFAULT 0,
    image       TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT '',
    in_stock    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Merchant columns (from merchant_migration.sql + merchant_v2_migration.sql)
ALTER TABLE products ADD COLUMN IF NOT EXISTS merchant_id      UUID;
ALTER TABLE products ADD COLUMN IF NOT EXISTS merchant_price   NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS status           TEXT    NOT NULL DEFAULT 'approved';
ALTER TABLE products ADD COLUMN IF NOT EXISTS reject_reason    TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_percent NUMERIC NOT NULL DEFAULT 0;

-- 3. Catalog column (from catalog_products_migration.sql)
ALTER TABLE products ADD COLUMN IF NOT EXISTS catalog_id UUID;

-- 4. Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_products_status    ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_merchant  ON products(merchant_id);
CREATE INDEX IF NOT EXISTS idx_products_catalog   ON products(catalog_id);

-- After running this, restart your backend — it will auto-seed the 46 house
-- products into this table on startup (only runs once; idempotent).
