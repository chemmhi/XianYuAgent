ALTER TABLE messages.messages
  ADD COLUMN IF NOT EXISTS read_status integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

ALTER TABLE messages.events
  DROP CONSTRAINT IF EXISTS events_type_check;

ALTER TABLE messages.events
  ADD CONSTRAINT events_type_check
  CHECK (type IN ('chat.message.created', 'chat.message.updated', 'chat.conversation.updated', 'chat.connection.changed'));

CREATE INDEX IF NOT EXISTS messages_conversation_read_status_idx
  ON messages.messages (conversation_id, direction, read_status, created_at);
