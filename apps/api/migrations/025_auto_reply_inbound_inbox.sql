CREATE TABLE IF NOT EXISTS messages.auto_reply_inbound_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL REFERENCES messages.conversations(id) ON DELETE RESTRICT,
  inbound_message_id uuid NOT NULL REFERENCES messages.messages(id) ON DELETE RESTRICT,
  external_conversation_ref text NOT NULL,
  external_message_ref text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'retryable', 'dead_lettered')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  lease_owner text,
  last_error_code text,
  last_error_digest text,
  last_error_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_message_ref),
  UNIQUE (account_id, inbound_message_id)
);

CREATE INDEX IF NOT EXISTS auto_reply_inbound_inbox_claim_idx
  ON messages.auto_reply_inbound_inbox (status, available_at, created_at);
CREATE INDEX IF NOT EXISTS auto_reply_inbound_inbox_conversation_idx
  ON messages.auto_reply_inbound_inbox (account_id, conversation_id, created_at);
