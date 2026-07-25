-- Optional delivery coordinates for Bloom Plan subscriptions and Petal
-- Studio corporate bookings — without these, a merchant's delivery-radius
-- cap silently can't be enforced for these two order types (it already
-- works for retail checkout, which has always captured coordinates).
-- Columns are nullable/unused until the respective frontend forms add a
-- location picker; the backend already reads them if present.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS longitude NUMERIC;

ALTER TABLE corporate_orders ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE corporate_orders ADD COLUMN IF NOT EXISTS longitude NUMERIC;
