-- ============================================================================
-- VivaPetals — combined pending migrations
-- Run this once in the Supabase SQL editor. All statements are idempotent
-- (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS), so it's safe to re-run.
-- ============================================================================

-- ── Gift messages on orders ─────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_message TEXT;

-- ── Merchant shop-availability toggle (open/closed) ─────────────────────────
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS is_open BOOLEAN NOT NULL DEFAULT TRUE;

-- ── Merchant delivery-radius cap ────────────────────────────────────────────
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS max_delivery_km NUMERIC;

-- ── Admin-editable homepage content (hero + announcement banner) ───────────
CREATE TABLE IF NOT EXISTS site_content (
  id INTEGER PRIMARY KEY DEFAULT 1,
  hero_headline TEXT,
  hero_subheadline TEXT,
  announcement_text TEXT,
  announcement_active BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

-- ── GST / tax settings (off by default) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  gst_rate NUMERIC NOT NULL DEFAULT 0,
  gst_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 0;
