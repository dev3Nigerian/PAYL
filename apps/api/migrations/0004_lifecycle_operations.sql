ALTER TABLE ledger_accounts DROP CONSTRAINT IF EXISTS ledger_accounts_account_type_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_account_type_check
  CHECK (account_type IN ('available', 'reserved', 'pending_payable', 'payable', 'reserve', 'clearing', 'fee_revenue'));

ALTER TABLE payment_intents DROP CONSTRAINT IF EXISTS payment_intents_status_check;
ALTER TABLE payment_intents ADD CONSTRAINT payment_intents_status_check
  CHECK (status IN ('pending_approval', 'reserved', 'captured', 'refunded', 'declined', 'released', 'expired', 'cancelled'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('confirmed', 'fulfilled', 'fulfillment_failed', 'cancelled', 'refunded'));
ALTER TABLE orders
  ALTER COLUMN fulfillment_reference DROP NOT NULL,
  ALTER COLUMN receipt_payload DROP NOT NULL,
  ALTER COLUMN receipt_jws DROP NOT NULL,
  ADD COLUMN fulfillment_deadline timestamptz,
  ADD COLUMN fulfilled_at timestamptz,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancellation_reason text,
  ADD COLUMN refund_window_minutes integer;

UPDATE orders
SET refund_window_minutes = CASE
  WHEN refundable AND refund_eligible_until IS NOT NULL
    THEN GREATEST(60, (extract(epoch FROM (refund_eligible_until - created_at)) / 60)::integer)
  ELSE NULL
END;

ALTER TABLE orders ADD CONSTRAINT orders_refund_window_check CHECK (
  (refundable = false AND refund_window_minutes IS NULL) OR
  (refundable = true AND refund_window_minutes BETWEEN 60 AND 525600)
);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_refund_policy_check;
ALTER TABLE orders ADD CONSTRAINT orders_refund_policy_check CHECK (
  (refundable = false AND refund_eligible_until IS NULL) OR
  (refundable = true AND (status IN ('confirmed', 'fulfillment_failed') OR refund_eligible_until IS NOT NULL))
);

UPDATE orders
SET fulfilled_at = COALESCE(fulfilled_at, created_at),
    fulfillment_deadline = COALESCE(fulfillment_deadline, created_at)
WHERE status IN ('fulfilled', 'refunded');

ALTER TABLE orders ADD CONSTRAINT orders_cancellation_reason_check
  CHECK (cancellation_reason IS NULL OR char_length(cancellation_reason) BETWEEN 1 AND 500);

INSERT INTO ledger_accounts(id, owner_type, owner_id, account_type, currency)
SELECT 'acct_' || id || '_pending_payable', 'merchant', id, 'pending_payable', currency
FROM merchants
ON CONFLICT (owner_type, owner_id, account_type, currency) DO NOTHING;

INSERT INTO ledger_accounts(id, owner_type, owner_id, account_type, currency)
SELECT 'acct_' || id || '_reserve', 'merchant', id, 'reserve', currency
FROM merchants
ON CONFLICT (owner_type, owner_id, account_type, currency) DO NOTHING;

CREATE TABLE payment_cancellations (
  id text PRIMARY KEY,
  payment_id text NOT NULL UNIQUE REFERENCES payment_intents(id),
  consumer_id text NOT NULL REFERENCES consumers(id),
  reason text,
  idempotency_key text NOT NULL,
  released_amount_minor bigint NOT NULL CHECK (released_amount_minor >= 0),
  status text NOT NULL CHECK (status IN ('cancelled', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consumer_id, idempotency_key),
  CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500)
);

CREATE TABLE order_cancellations (
  id text PRIMARY KEY,
  order_id text NOT NULL UNIQUE REFERENCES orders(id),
  payment_id text NOT NULL UNIQUE REFERENCES payment_intents(id),
  consumer_id text NOT NULL REFERENCES consumers(id),
  merchant_id text NOT NULL REFERENCES merchants(id),
  reversed_amount_minor bigint NOT NULL CHECK (reversed_amount_minor > 0),
  reversed_fee_minor bigint NOT NULL CHECK (reversed_fee_minor >= 0),
  reason text,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status = 'cancelled'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consumer_id, idempotency_key),
  CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500)
);

CREATE TABLE merchant_settlement_configs (
  merchant_id text PRIMARY KEY REFERENCES merchants(id),
  reserve_bps integer NOT NULL DEFAULT 1000 CHECK (reserve_bps BETWEEN 0 AND 5000),
  payouts_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO merchant_settlement_configs(merchant_id)
SELECT id FROM merchants
ON CONFLICT (merchant_id) DO NOTHING;

CREATE TABLE payout_batches (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id),
  currency char(3) NOT NULL,
  source_payable_minor bigint NOT NULL CHECK (source_payable_minor > 0),
  reserve_held_minor bigint NOT NULL CHECK (reserve_held_minor >= 0),
  paid_amount_minor bigint NOT NULL CHECK (paid_amount_minor >= 0),
  status text NOT NULL CHECK (status IN ('paid', 'failed')),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (merchant_id, idempotency_key)
);

CREATE INDEX payout_batches_merchant_created_idx ON payout_batches(merchant_id, created_at DESC);

CREATE TABLE merchant_webhook_endpoints (
  id text PRIMARY KEY,
  merchant_id text NOT NULL UNIQUE REFERENCES merchants(id),
  url text NOT NULL,
  signing_secret text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox_events (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id),
  endpoint_id text REFERENCES merchant_webhook_endpoints(id),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  dedupe_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outbox_events_dispatch_idx ON outbox_events(status, available_at, created_at);
CREATE INDEX outbox_events_merchant_idx ON outbox_events(merchant_id, created_at DESC);

CREATE TABLE reconciliation_reports (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id),
  currency char(3) NOT NULL,
  expected_position_minor bigint NOT NULL,
  actual_position_minor bigint NOT NULL,
  difference_minor bigint NOT NULL,
  unbalanced_journal_entries integer NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reconciliation_reports_merchant_idx ON reconciliation_reports(merchant_id, created_at DESC);

CREATE INDEX payment_intents_expiry_idx ON payment_intents(status, expires_at);
CREATE INDEX approval_challenges_expiry_idx ON approval_challenges(status, expires_at);
CREATE INDEX quotes_expiry_idx ON quotes(status, expires_at);
CREATE INDEX orders_fulfillment_expiry_idx ON orders(status, fulfillment_deadline);
