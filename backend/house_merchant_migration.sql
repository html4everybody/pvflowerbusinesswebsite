-- Run once in Supabase SQL Editor.
-- Removes hardcoded UUID pattern; marks house merchant with is_house flag instead.

-- 1. Add is_house flag column
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS is_house BOOLEAN NOT NULL DEFAULT FALSE;

-- After running this, restart your backend.
-- The demo merchants will be recreated with real UUIDs automatically.
