-- Retire listings without deleting the records referenced by quotes and orders.
ALTER TABLE offers ADD COLUMN archived_at timestamptz;
ALTER TABLE offers ADD CONSTRAINT archived_offers_are_inactive CHECK (archived_at IS NULL OR active = false);

CREATE TABLE sandbox_catalog_revisions (
  version text PRIMARY KEY,
  bootstrap_merchant_id text NOT NULL REFERENCES merchants(id),
  retired_offer_ids text[] NOT NULL,
  merchant_count integer NOT NULL,
  offer_count integer NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
