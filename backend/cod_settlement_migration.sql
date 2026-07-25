-- Adds settlement-direction tracking to order_merchant_parts.
--
-- Why: previously the payout ledger only ever modeled one direction —
-- "VivaPetals collected the money, so it owes the merchant their cut."
-- That's correct for prepaid (UPI) orders, but wrong for Pay on Delivery:
-- the MERCHANT's own delivery person collects the full customer-facing
-- price at the door, so the merchant already has their own share AND
-- VivaPetals's commission in hand — the merchant owes VivaPetals the
-- commission back, not the other way round.
--
-- collection_type is set once, at order-placement time, from the order's
-- payment_method ('cod' -> merchant_collected, anything else -> platform_collected).
-- NULL/missing (existing rows, or before this migration runs) is treated
-- as 'platform_collected' everywhere in the app code — i.e. the exact
-- behavior that already existed before this migration.

ALTER TABLE order_merchant_parts
  ADD COLUMN IF NOT EXISTS collection_type TEXT DEFAULT 'platform_collected';
