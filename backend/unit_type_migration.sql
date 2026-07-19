-- Run once in Supabase SQL Editor.
-- Adds unit_type and min_quantity to products for flower-specific ordering.

-- unit_type: how the product is sold (stem, weight, bunch, pair)
-- min_quantity: for weight products — grams per unit (e.g. 100 means price is per 100g)
--               for stem/bunch/pair — minimum pieces per order (e.g. 5 for roses)

ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_type TEXT NOT NULL DEFAULT 'stem';
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_quantity INT NOT NULL DEFAULT 1;

-- Also add to catalog_products so shared listings carry the same metadata
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS unit_type TEXT NOT NULL DEFAULT 'stem';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS min_quantity INT NOT NULL DEFAULT 1;
