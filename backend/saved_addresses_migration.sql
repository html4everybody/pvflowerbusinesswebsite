-- Run once in Supabase SQL Editor. New table, safe to run any time.
-- Backs the customer-facing "Addresses" page (Account -> Addresses) — a
-- labeled address book (Home/Office/etc.) so checkout doesn't require
-- retyping the full delivery address every single order.

CREATE TABLE IF NOT EXISTS saved_addresses (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'Home',
  address TEXT NOT NULL,
  city TEXT,
  state TEXT,
  pincode TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_addresses_user_email ON saved_addresses(user_email);
