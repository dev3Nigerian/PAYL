ALTER TABLE consumer_chat_conversations ADD COLUMN shopping_brief jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE consumer_chat_messages ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE delivery_assets (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id),
  file_name text NOT NULL,
  content_type text NOT NULL,
  contents bytea NOT NULL CHECK (octet_length(contents) BETWEEN 1 AND 5242880),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_assets_merchant_idx ON delivery_assets(merchant_id);
ALTER TABLE offers ADD COLUMN delivery_asset_id text REFERENCES delivery_assets(id),
  ADD COLUMN service_intake_prompt text;
ALTER TABLE quotes ADD COLUMN delivery_asset_id text REFERENCES delivery_assets(id),
  ADD COLUMN service_intake_prompt text;
ALTER TABLE orders ADD COLUMN delivery_asset_id text REFERENCES delivery_assets(id),
  ADD COLUMN service_intake_prompt text, ADD COLUMN service_details text,
  ADD COLUMN service_details_submitted_at timestamptz;
