-- Run once in Supabase SQL Editor.
-- Companion to product_text_id_migration.sql — that migration covered
-- order_items/product_stock/cart_items/product_reviews, but missed
-- bundle_deals.product_ids (an integer[] array column, not a simple FK),
-- which is why creating/editing a Bundle Offer with a real product still
-- fails with "invalid input syntax for type integer" even after the
-- BundleDealCreate Pydantic model was fixed to accept string IDs.
--
-- bundle_deals is empty on this DB as of writing, so this is zero-risk —
-- if it's not empty when you run this, back up the table first.
--
-- (First attempt used a correlated subquery in the USING clause —
-- `USING (SELECT array_agg(...) FROM unnest(product_ids) ...)` — which
-- Postgres rejects outright: "cannot use subquery in transform expression".
-- An array type cast doesn't need one; Postgres casts int[] -> text[]
-- element-wise on its own.)

ALTER TABLE bundle_deals
  ALTER COLUMN product_ids TYPE TEXT[] USING product_ids::TEXT[];
