-- ============================================================================
-- VivaPetals — customer delivery location (free Leaflet/OSM location picker)
-- Run all at once in Supabase → SQL Editor. Idempotent & safe to re-run.
--
-- merchants.latitude/longitude already exist from an earlier migration.
-- This adds the same pair to orders, so a customer's pinned delivery
-- location survives on the order (map-picked at checkout), matching what
-- merchants/admin already store for shop location.
-- ============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
