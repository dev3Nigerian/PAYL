ALTER TABLE offers
  ADD COLUMN refundable boolean,
  ADD COLUMN refund_window_minutes integer;

-- Preserve the seven-day refund promise that existing products and receipts already expose.
UPDATE offers
SET refundable = true,
    refund_window_minutes = 10080;

ALTER TABLE offers
  ALTER COLUMN refundable SET DEFAULT false,
  ALTER COLUMN refundable SET NOT NULL,
  ADD CONSTRAINT offers_refund_policy_check CHECK (
    (refundable = false AND refund_window_minutes IS NULL) OR
    (refundable = true AND refund_window_minutes BETWEEN 60 AND 525600 AND refund_window_minutes % 60 = 0)
  );

ALTER TABLE payment_intents DROP CONSTRAINT IF EXISTS payment_intents_status_check;
ALTER TABLE payment_intents ADD CONSTRAINT payment_intents_status_check
  CHECK (status IN ('pending_approval', 'reserved', 'captured', 'refunded', 'declined', 'released', 'expired'));

ALTER TABLE orders
  ADD COLUMN refundable boolean,
  ADD COLUMN refund_eligible_until timestamptz,
  ADD COLUMN refunded_at timestamptz;

UPDATE orders
SET refundable = true,
    refund_eligible_until = (receipt_payload ->> 'refundEligibleUntil')::timestamptz;

ALTER TABLE orders
  ALTER COLUMN refundable SET NOT NULL,
  ADD CONSTRAINT orders_refund_policy_check CHECK (
    (refundable = false AND refund_eligible_until IS NULL) OR
    (refundable = true AND refund_eligible_until IS NOT NULL)
  );

CREATE TABLE refunds (
  id text PRIMARY KEY,
  order_id text NOT NULL UNIQUE REFERENCES orders(id),
  payment_id text NOT NULL UNIQUE REFERENCES payment_intents(id),
  consumer_id text NOT NULL REFERENCES consumers(id),
  merchant_id text NOT NULL REFERENCES merchants(id),
  refunded_amount_minor bigint NOT NULL CHECK (refunded_amount_minor > 0),
  retained_fee_minor bigint NOT NULL CHECK (retained_fee_minor >= 0),
  currency char(3) NOT NULL,
  status text NOT NULL CHECK (status = 'completed'),
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  idempotency_key text NOT NULL,
  receipt_payload jsonb NOT NULL,
  receipt_jws text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consumer_id, idempotency_key)
);

CREATE INDEX refunds_merchant_created_idx ON refunds(merchant_id, created_at DESC);
CREATE INDEX refunds_consumer_created_idx ON refunds(consumer_id, created_at DESC);
