ALTER TABLE consumer_chat_messages ADD COLUMN IF NOT EXISTS sequence bigserial;

DROP INDEX IF EXISTS consumer_chat_messages_conversation_created_idx;
CREATE INDEX IF NOT EXISTS consumer_chat_messages_conversation_created_idx
  ON consumer_chat_messages(conversation_id, sequence DESC);
