CREATE TABLE IF NOT EXISTS auth_browser_handoffs (
  code_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_browser_handoffs_expiry_idx
  ON auth_browser_handoffs(expires_at)
  WHERE consumed_at IS NULL;

