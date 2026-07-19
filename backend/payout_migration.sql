-- ============================================================================
-- VivaPetals Marketplace v5 — merchant payout / settlement ledger
-- Run all at once in Supabase → SQL Editor. Idempotent & safe to re-run.
--
-- Model: the customer pays VivaPetals in full (one payment, no split-payment
-- gateway). Each order_merchant_parts row becomes PAYABLE once that
-- merchant's part is marked `delivered`. Admin then settles it manually
-- (e.g. after a bank transfer) — individually or in bulk per merchant —
-- and that gets recorded here as an audit trail (who was paid, when, note).
-- ============================================================================

ALTER TABLE order_merchant_parts ADD COLUMN IF NOT EXISTS payout_status TEXT NOT NULL DEFAULT 'unpaid';  -- unpaid | paid
ALTER TABLE order_merchant_parts ADD COLUMN IF NOT EXISTS paid_at        TIMESTAMPTZ;
ALTER TABLE order_merchant_parts ADD COLUMN IF NOT EXISTS payout_note    TEXT;

CREATE INDEX IF NOT EXISTS idx_omp_payout_status ON order_merchant_parts(payout_status);
