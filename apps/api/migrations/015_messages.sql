CREATE SCHEMA IF NOT EXISTS messages;

CREATE TABLE IF NOT EXISTS messages.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  external_conversation_ref text,
  buyer_ref text NOT NULL,
  buyer_display_name text,
  item_ref text,
  item_title text,
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  handling_mode text NOT NULL DEFAULT 'ai' CHECK (handling_mode IN ('ai', 'human')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  last_message_preview text,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_account_updated_idx ON messages.conversations (account_id, updated_at DESC, id);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_account_external_ref_uq ON messages.conversations (account_id, external_conversation_ref) WHERE external_conversation_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS messages.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES messages.conversations(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender_role text NOT NULL CHECK (sender_role IN ('buyer', 'agent', 'system')),
  body_type text NOT NULL CHECK (body_type IN ('text', 'image', 'system')),
  body_text text,
  body_ref text,
  redaction_state text NOT NULL DEFAULT 'visible' CHECK (redaction_state IN ('visible', 'redacted')),
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created')),
  external_message_ref text,
  source text CHECK (source IN ('human', 'ai', 'system')),
  order_ref text,
  product_ref text,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  handling_mode text NOT NULL DEFAULT 'ai' CHECK (handling_mode IN ('ai', 'human')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, external_message_ref)
);
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages.messages (conversation_id, created_at, id);

CREATE TABLE IF NOT EXISTS messages.events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES messages.conversations(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  cursor bigint NOT NULL,
  type text NOT NULL CHECK (type IN ('chat.message.created', 'chat.conversation.updated', 'chat.connection.changed')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  trace_id text NOT NULL,
  payload_json jsonb NOT NULL,
  UNIQUE (conversation_id, cursor)
);
CREATE INDEX IF NOT EXISTS message_events_conversation_cursor_idx ON messages.events (conversation_id, cursor);
