-- Petal Rewards: admin-configurable earn/redemption rates + a claimable
-- reward catalog, on top of the existing loyalty_accounts/loyalty_transactions
-- tables. Defaults below match the values that were previously hardcoded in
-- main.py, so running this migration changes NOTHING until an admin edits a
-- rate or adds a reward.

CREATE TABLE IF NOT EXISTS loyalty_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  points_per_rupee NUMERIC NOT NULL DEFAULT 1,
  welcome_bonus INTEGER NOT NULL DEFAULT 100,
  referral_signup_bonus INTEGER NOT NULL DEFAULT 200,
  referral_purchase_bonus INTEGER NOT NULL DEFAULT 150,
  redemption_rate NUMERIC NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS reward_catalog (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  points_cost INTEGER NOT NULL,
  discount_value NUMERIC NOT NULL,
  min_order NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Each claim is a firm commitment at the value/cost the customer actually
-- paid points for, even if the catalog entry changes or is removed later —
-- title/discount_value/min_order are snapshotted, not looked up live.
CREATE TABLE IF NOT EXISTS reward_claims (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  discount_value NUMERIC NOT NULL,
  min_order NUMERIC NOT NULL DEFAULT 0,
  points_spent INTEGER NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  used_order_id TEXT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reward_claims_email ON reward_claims(user_email);
