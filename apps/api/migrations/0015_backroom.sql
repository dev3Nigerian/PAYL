ALTER TABLE auth_users DROP CONSTRAINT auth_users_role_check;
ALTER TABLE auth_users ADD CONSTRAINT auth_users_role_check
  CHECK (role IN ('consumer', 'merchant_admin', 'platform_admin'));
ALTER TABLE auth_users DROP CONSTRAINT auth_users_check;
ALTER TABLE auth_users ADD CONSTRAINT auth_users_check CHECK (
  (role = 'consumer' AND consumer_id IS NOT NULL AND merchant_id IS NULL) OR
  (role = 'merchant_admin' AND merchant_id IS NOT NULL AND consumer_id IS NULL) OR
  (role = 'platform_admin' AND consumer_id IS NULL AND merchant_id IS NULL)
);
ALTER TABLE auth_users ADD COLUMN backroom_config_hash char(64);
ALTER TABLE auth_users ADD COLUMN mfa_last_step bigint;

CREATE INDEX orders_created_idx ON orders(created_at DESC, id DESC);
CREATE INDEX wallet_topups_created_idx ON wallet_topups(created_at DESC, id DESC);
CREATE INDEX audit_events_created_idx ON audit_events(created_at DESC, id DESC);

CREATE TABLE operations_heartbeats (
  name text PRIMARY KEY,
  last_attempt_at timestamptz NOT NULL,
  last_success_at timestamptz,
  status text NOT NULL CHECK (status IN ('ok', 'failed'))
);
