-- Stores the actual ₹ value of a redeemed-points discount at the moment an
-- order was placed. The redemption rate is admin-editable and can change
-- later, so recomputing this from orders.points_redeemed ÷ "whatever the
-- rate is now" (or a hardcoded old rate) drifts wrong for past orders —
-- this column is the historically-accurate source of truth instead.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_discount_amount NUMERIC DEFAULT 0;
