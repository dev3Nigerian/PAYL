ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_refund_policy_check;
ALTER TABLE orders ADD CONSTRAINT orders_refund_policy_check CHECK (
  (refundable = false AND refund_eligible_until IS NULL) OR
  (refundable = true AND (
    status IN ('confirmed', 'fulfillment_failed', 'cancelled') OR
    refund_eligible_until IS NOT NULL
  ))
);
