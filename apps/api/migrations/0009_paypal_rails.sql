ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS ledger_accounts_account_type_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_account_type_check
  CHECK (account_type IN (
    'available', 'reserved', 'pending_payable', 'payable', 'reserve',
    'payout_pending', 'clearing', 'fee_revenue', 'provider_fee_expense'
  ));

INSERT INTO ledger_accounts(id, owner_type, owner_id, account_type, currency)
SELECT 'acct_' || id || '_payout_pending', 'merchant', id, 'payout_pending', currency
FROM merchants
ON CONFLICT (owner_type, owner_id, account_type, currency) DO NOTHING;

INSERT INTO ledger_accounts(id, owner_type, owner_id, account_type, currency)
VALUES ('acct_platform_provider_fee_expense', 'platform', 'payl', 'provider_fee_expense', 'USD')
ON CONFLICT (owner_type, owner_id, account_type, currency) DO NOTHING;

CREATE TABLE wallet_topups (
  id text PRIMARY KEY,
  consumer_id text NOT NULL REFERENCES consumers(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency = 'USD'),
  status text NOT NULL CHECK (status IN ('creating', 'pending', 'completed', 'cancelled', 'failed', 'reversed')),
  idempotency_key text NOT NULL,
  paypal_order_id text UNIQUE,
  paypal_capture_id text UNIQUE,
  provider_fee_minor bigint NOT NULL DEFAULT 0 CHECK (provider_fee_minor >= 0),
  reversed_amount_minor bigint NOT NULL DEFAULT 0 CHECK (reversed_amount_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consumer_id, idempotency_key),
  CHECK (reversed_amount_minor <= amount_minor)
);
CREATE INDEX wallet_topups_consumer_created_idx ON wallet_topups(consumer_id, created_at DESC);

CREATE TABLE paypal_webhook_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  resource_id text,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE merchant_settlement_configs ADD COLUMN paypal_payout_email text;

ALTER TABLE payout_batches DROP CONSTRAINT IF EXISTS payout_batches_status_check;
ALTER TABLE payout_batches ADD CONSTRAINT payout_batches_status_check
  CHECK (status IN ('pending', 'paid', 'failed'));
ALTER TABLE payout_batches
  ADD COLUMN paypal_recipient_email text,
  ADD COLUMN paypal_batch_id text UNIQUE,
  ADD COLUMN paypal_item_id text UNIQUE,
  ADD COLUMN provider_fee_minor bigint NOT NULL DEFAULT 0 CHECK (provider_fee_minor >= 0),
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX payout_batches_pending_idx ON payout_batches(status, created_at)
  WHERE status = 'pending';
