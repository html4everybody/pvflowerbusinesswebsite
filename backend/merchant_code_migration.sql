-- Run once in Supabase SQL Editor.
-- Adds a human-readable merchant_code (MERCH-001 format) to the merchants table.
-- The UUID id stays as the internal PK — no FK changes needed.

-- 1. Add merchant_code column
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS merchant_code TEXT UNIQUE;

-- 2. Create a sequence for auto-numbering (starts at 2, house is always 001)
CREATE SEQUENCE IF NOT EXISTS merchant_code_seq START 2;

-- 3. Index for fast lookups by code
CREATE INDEX IF NOT EXISTS idx_merchants_code ON merchants(merchant_code);
