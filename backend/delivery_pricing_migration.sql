CREATE TABLE IF NOT EXISTS delivery_pricing (
  id INTEGER PRIMARY KEY DEFAULT 1,
  per_km_rate NUMERIC NOT NULL DEFAULT 10,
  free_delivery_min_order NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);
