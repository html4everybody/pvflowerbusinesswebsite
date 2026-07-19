-- Admin-managed product categories
-- Run once in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS categories (
  name       TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Seed default categories
INSERT INTO categories (name, sort_order) VALUES
  ('Flowers',    0),
  ('Bouquets',   1),
  ('Garlands',   2),
  ('Gifts',      3),
  ('Decoration', 4)
ON CONFLICT (name) DO NOTHING;
