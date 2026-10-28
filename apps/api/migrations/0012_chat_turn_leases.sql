CREATE TABLE consumer_chat_turn_leases (
  consumer_id text PRIMARY KEY REFERENCES consumers(id) ON DELETE CASCADE,
  token uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
