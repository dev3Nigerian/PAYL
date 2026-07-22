CREATE TABLE IF NOT EXISTS auth_users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('consumer', 'merchant_admin')),
  consumer_id text REFERENCES consumers(id),
  merchant_id text REFERENCES merchants(id),
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  mfa_secret text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (role = 'consumer' AND consumer_id IS NOT NULL AND merchant_id IS NULL) OR
    (role = 'merchant_admin' AND merchant_id IS NOT NULL AND consumer_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id),
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id text PRIMARY KEY,
  metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS oauth_consent_requests (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id),
  client_id text NOT NULL REFERENCES oauth_clients(client_id),
  redirect_uri text NOT NULL,
  scopes text[] NOT NULL,
  code_challenge text NOT NULL,
  resource text NOT NULL,
  state text,
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  code_hash char(64) PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id),
  client_id text NOT NULL REFERENCES oauth_clients(client_id),
  redirect_uri text NOT NULL,
  scopes text[] NOT NULL,
  code_challenge text NOT NULL,
  resource text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_grants (
  user_id text NOT NULL REFERENCES auth_users(id),
  client_id text NOT NULL REFERENCES oauth_clients(client_id),
  resource text NOT NULL,
  scopes text[] NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (user_id, client_id, resource)
);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  token_hash char(64) PRIMARY KEY,
  user_id text NOT NULL REFERENCES auth_users(id),
  client_id text NOT NULL REFERENCES oauth_clients(client_id),
  resource text NOT NULL,
  scopes text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_refresh_user_idx ON oauth_refresh_tokens(user_id, client_id, resource);

CREATE TABLE IF NOT EXISTS oauth_revoked_access_tokens (
  jti text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now()
);
