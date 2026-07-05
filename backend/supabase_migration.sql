-- ============================================================================
-- VivaPetals: Supabase Migration for Promo Codes, Seasonal Offers, Bundle Deals
-- Run this SQL in your Supabase Dashboard → SQL Editor → New Query
-- ============================================================================

-- 0a. Subscriptions (Bloom Plan) — recurring flower deliveries.
CREATE TABLE IF NOT EXISTS subscriptions (
    id                 TEXT PRIMARY KEY,
    customer_email     TEXT NOT NULL,
    customer_name      TEXT NOT NULL DEFAULT '',
    customer_phone     TEXT,
    plan               TEXT NOT NULL,
    style              TEXT NOT NULL DEFAULT 'florist',
    fixed_product_id   INTEGER,
    fixed_product_name TEXT,
    items              JSONB NOT NULL DEFAULT '[]',
    instructions       TEXT,
    daily_total        NUMERIC,
    grand_total        NUMERIC,
    discount_percent   NUMERIC,
    status             TEXT NOT NULL DEFAULT 'active',
    next_delivery      TEXT NOT NULL DEFAULT '',
    address            TEXT NOT NULL DEFAULT '',
    skipped_count      INTEGER NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- If the subscriptions table already exists from an earlier run, add the new columns:
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS customer_phone   TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS items            JSONB NOT NULL DEFAULT '[]';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS instructions     TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS daily_total      NUMERIC;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS grand_total      NUMERIC;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS discount_percent NUMERIC;

-- 0. Products (admin-managed catalog). Rows are auto-seeded by the backend on
--    first run from the built-in list, so no INSERTs are needed here.
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

-- 0b. Subscription Plans (cadence + discount, editable from the admin panel).
--     Rows are auto-seeded by the backend on first run.
CREATE TABLE IF NOT EXISTS subscription_plans (
    id               TEXT PRIMARY KEY,
    label            TEXT NOT NULL,
    subtitle         TEXT NOT NULL DEFAULT '',
    days             INTEGER NOT NULL DEFAULT 7,
    discount_percent NUMERIC NOT NULL DEFAULT 0,
    sort_order       INTEGER NOT NULL DEFAULT 0
);

-- 1. Promo Codes
CREATE TABLE IF NOT EXISTS promo_codes (
    code        TEXT PRIMARY KEY,
    type        TEXT NOT NULL CHECK (type IN ('percent', 'flat')),
    value       NUMERIC NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    first_order_only BOOLEAN NOT NULL DEFAULT FALSE,
    min_order   NUMERIC NOT NULL DEFAULT 0,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Seasonal Offers (Live Deals displayed on homepage)
CREATE TABLE IF NOT EXISTS seasonal_offers (
    id          TEXT PRIMARY KEY,
    emoji       TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL,
    subtitle    TEXT NOT NULL DEFAULT '',
    code        TEXT NOT NULL REFERENCES promo_codes(code) ON DELETE CASCADE,
    badge       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Bundle Deals (Bundle Offers displayed on homepage)
CREATE TABLE IF NOT EXISTS bundle_deals (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    emoji       TEXT NOT NULL DEFAULT '',
    product_ids INTEGER[] NOT NULL DEFAULT '{}',
    promo_code  TEXT NOT NULL REFERENCES promo_codes(code) ON DELETE CASCADE,
    savings_pct NUMERIC NOT NULL DEFAULT 15,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- Seed data (same defaults that were previously hardcoded in main.py)
-- These INSERT statements use ON CONFLICT DO NOTHING so they're safe to re-run
-- ============================================================================

-- Promo codes
INSERT INTO promo_codes (code, type, value, description, first_order_only, min_order, active) VALUES
    ('WELCOME10', 'percent', 10, '10% off your first order', TRUE, 0, TRUE),
    ('SUMMER20',  'percent', 20, '20% off orders above ₹500', FALSE, 500, TRUE),
    ('FLAT100',   'flat',    100, '₹100 off on orders above ₹800', FALSE, 800, TRUE),
    ('BUNDLE15',  'percent', 15, '15% off on bundle deals', FALSE, 0, TRUE),
    ('FLORANVIP', 'percent', 25, 'VIP exclusive — 25% off orders above ₹1000', FALSE, 1000, TRUE)
ON CONFLICT (code) DO NOTHING;

-- Seasonal offers
INSERT INTO seasonal_offers (id, emoji, title, subtitle, code, badge) VALUES
    ('spring',  '🌸', 'Spring Sale',   'Up to 20% off on all bouquets',    'SUMMER20',  'Limited Time'),
    ('bundle',  '🎁', 'Bundle & Save', 'Buy a bundle and save 15%',         'BUNDLE15',  'Bundle Deal'),
    ('newuser', '🎉', 'New Here?',      '10% off your very first order',     'WELCOME10', 'First Order'),
    ('vip',     '💎', 'VIP Offer',      '25% off orders above ₹1000',        'FLORANVIP', 'VIP Only')
ON CONFLICT (id) DO NOTHING;

-- Bundle deals
INSERT INTO bundle_deals (id, name, description, emoji, product_ids, promo_code, savings_pct) VALUES
    ('romance',  'Romance Bundle',    'Perfect for date nights and anniversaries', '❤️', ARRAY[1, 5, 42],  'BUNDLE15', 15),
    ('wedding',  'Wedding Elegance',  'Everything for a perfect wedding',          '💍', ARRAY[94, 9, 42], 'BUNDLE15', 15),
    ('birthday', 'Birthday Surprise', 'Make their birthday extra special',         '🎂', ARRAY[76, 4, 14], 'BUNDLE15', 15)
ON CONFLICT (id) DO NOTHING;
