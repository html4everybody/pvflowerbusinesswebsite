ALTER TABLE merchants ADD COLUMN IF NOT EXISTS payout_method TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS payout_upi_id TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS payout_bank_account_name TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS payout_bank_account_number TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS payout_bank_ifsc TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS payout_verified BOOLEAN NOT NULL DEFAULT FALSE;
