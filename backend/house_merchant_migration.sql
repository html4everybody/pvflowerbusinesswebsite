-- Run once in Supabase SQL Editor.
-- Removes hardcoded UUID pattern; marks house merchant with is_house flag instead.

-- 1. Add is_house flag column
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS is_house BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Mark the existing house merchant
UPDATE merchants
SET is_house = TRUE
WHERE id = '00000000-0000-0000-0000-000000000001';

-- 3. Remove demo merchants that used hardcoded UUIDs
--    (they will be recreated with real auto-generated UUIDs on next backend restart)
DELETE FROM products
WHERE merchant_id IN (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000102'
);

DELETE FROM merchants
WHERE id IN (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000102'
);

-- After running this, restart your backend.
-- The demo merchants will be recreated with real UUIDs automatically.
