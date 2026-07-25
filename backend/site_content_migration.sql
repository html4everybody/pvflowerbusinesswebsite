CREATE TABLE IF NOT EXISTS site_content (
  id INTEGER PRIMARY KEY DEFAULT 1,
  hero_headline TEXT,
  hero_subheadline TEXT,
  announcement_text TEXT,
  announcement_active BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);
