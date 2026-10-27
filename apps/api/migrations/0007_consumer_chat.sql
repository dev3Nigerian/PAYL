CREATE TABLE consumer_chat_conversations (
  id text PRIMARY KEY,
  consumer_id text NOT NULL REFERENCES consumers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX consumer_chat_conversations_consumer_updated_idx
  ON consumer_chat_conversations(consumer_id, updated_at DESC);

CREATE TABLE consumer_chat_messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES consumer_chat_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  offers jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX consumer_chat_messages_conversation_created_idx
  ON consumer_chat_messages(conversation_id, created_at DESC, id DESC);
