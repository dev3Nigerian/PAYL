ALTER TABLE consumer_chat_messages
  ADD COLUMN action jsonb,
  ADD COLUMN request_id text;

CREATE UNIQUE INDEX consumer_chat_messages_request_role_idx
  ON consumer_chat_messages(request_id, role)
  WHERE request_id IS NOT NULL;

CREATE INDEX consumer_chat_messages_purchase_idx
  ON consumer_chat_messages(conversation_id, sequence DESC)
  WHERE action->>'kind' = 'purchase';
