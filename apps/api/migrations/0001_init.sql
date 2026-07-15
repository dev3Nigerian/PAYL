CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS merchants (
  id text PRIMARY KEY,
  name text NOT NULL,
  server_id text NOT NULL UNIQUE,
  currency char(3) NOT NULL,
  signing_key_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consumers (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offers (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id),
  name text NOT NULL,
  description text NOT NULL,
  price_minor bigint NOT NULL CHECK (price_minor > 0),
  currency char(3) NOT NULL,
  fulfillment_method text NOT NULL CHECK (fulfillment_method IN ('digital_download', 'digital_service')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spending_policies (
  consumer_id text PRIMARY KEY REFERENCES consumers(id),
  version integer NOT NULL,
  auto_approve_limit_minor bigint NOT NULL CHECK (auto_approve_limit_minor >= 0),
  per_transaction_limit_minor bigint NOT NULL CHECK (per_transaction_limit_minor > 0),
  daily_limit_minor bigint NOT NULL CHECK (daily_limit_minor > 0),
  currency char(3) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id text PRIMARY KEY,
  owner_type text NOT NULL CHECK (owner_type IN ('consumer', 'merchant', 'platform')),
  owner_id text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('available', 'reserved', 'payable', 'clearing', 'fee_revenue')),
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id, account_type, currency)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id bigserial PRIMARY KEY,
  entry_id text NOT NULL REFERENCES journal_entries(id),
  account_id text NOT NULL REFERENCES ledger_accounts(id),
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS journal_lines_account_idx ON journal_lines(account_id, id);

CREATE TABLE IF NOT EXISTS quotes (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id),
  offer_id text NOT NULL REFERENCES offers(id),
  nonce text NOT NULL UNIQUE,
  total_minor bigint NOT NULL CHECK (total_minor > 0),
  currency char(3) NOT NULL,
  payload jsonb NOT NULL,
  jws text NOT NULL,
  quote_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('active', 'committed', 'expired', 'cancelled')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_intents (
  id text PRIMARY KEY,
  quote_id text NOT NULL REFERENCES quotes(id),
  consumer_id text NOT NULL REFERENCES consumers(id),
  agent_client_id text NOT NULL,
  merchant_id text NOT NULL REFERENCES merchants(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  status text NOT NULL CHECK (status IN ('pending_approval', 'reserved', 'captured', 'declined', 'released', 'expired')),
  idempotency_key text NOT NULL,
  approval_level text CHECK (approval_level IN ('policy_auto', 'human_mfa')),
  mandate_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consumer_id, idempotency_key),
  UNIQUE (quote_id, consumer_id)
);

CREATE TABLE IF NOT EXISTS approval_challenges (
  id text PRIMARY KEY,
  payment_id text NOT NULL UNIQUE REFERENCES payment_intents(id),
  consumer_id text NOT NULL REFERENCES consumers(id),
  quote_hash char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'declined', 'expired')),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_mandates (
  id text PRIMARY KEY,
  payment_id text NOT NULL UNIQUE REFERENCES payment_intents(id),
  quote_id text NOT NULL REFERENCES quotes(id),
  consumer_id text NOT NULL REFERENCES consumers(id),
  merchant_id text NOT NULL REFERENCES merchants(id),
  quote_hash char(64) NOT NULL,
  max_amount_minor bigint NOT NULL CHECK (max_amount_minor > 0),
  currency char(3) NOT NULL,
  anti_replay_id text NOT NULL UNIQUE,
  approval_level text NOT NULL CHECK (approval_level IN ('policy_auto', 'human_mfa')),
  status text NOT NULL CHECK (status IN ('reserved', 'consumed', 'released', 'expired')),
  payload jsonb NOT NULL,
  jws text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_intents_mandate_id_fkey'
  ) THEN
    ALTER TABLE payment_intents
      ADD CONSTRAINT payment_intents_mandate_id_fkey
      FOREIGN KEY (mandate_id) REFERENCES payment_mandates(id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id),
  quote_id text NOT NULL UNIQUE REFERENCES quotes(id),
  mandate_id text NOT NULL UNIQUE REFERENCES payment_mandates(id),
  payment_id text NOT NULL UNIQUE REFERENCES payment_intents(id),
  status text NOT NULL CHECK (status IN ('confirmed', 'fulfilled', 'cancelled', 'refunded')),
  captured_amount_minor bigint NOT NULL CHECK (captured_amount_minor > 0),
  platform_fee_minor bigint NOT NULL CHECK (platform_fee_minor >= 0),
  currency char(3) NOT NULL,
  fulfillment_reference text NOT NULL,
  receipt_payload jsonb NOT NULL,
  receipt_jws text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  correlation_id text NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  event_type text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_correlation_idx ON audit_events(correlation_id, id);
