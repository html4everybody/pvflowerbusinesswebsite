-- Run once in Supabase SQL Editor.
-- Adds a human-readable merchant_code (MERCH-001 format) to the merchants table.
-- The UUID id stays as the internal PK — no FK changes needed.

-- 1. Add merchant_code column
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS merchant_code TEXT UNIQUE;

-- 2. Create a sequence for auto-numbering (starts at 2, house is always 001)
CREATE SEQUENCE IF NOT EXISTS merchant_code_seq START 2;

-- 3. Assign MERCH-001 to the house merchant
UPDATE merchants
SET merchant_code = 'MERCH-001'
WHERE id = '00000000-0000-0000-0000-000000000001'
  AND merchant_code IS NULL;

-- 4. Assign codes to any other existing merchants
UPDATE merchants
SET merchant_code = 'MERCH-' || LPAD(nextval('merchant_code_seq')::TEXT, 3, '0')
WHERE merchant_code IS NULL;

-- 5. Index for fast lookups by code
CREATE INDEX IF NOT EXISTS idx_merchants_code ON merchants(merchant_code);
