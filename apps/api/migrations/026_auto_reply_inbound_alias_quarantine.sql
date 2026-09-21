CREATE TABLE IF NOT EXISTS messages.message_external_ref_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL REFERENCES messages.conversations(id) ON DELETE RESTRICT,
  message_id uuid NOT NULL REFERENCES messages.messages(id) ON DELETE CASCADE,
  external_message_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_message_ref)
);

CREATE INDEX IF NOT EXISTS message_external_ref_aliases_message_idx
  ON messages.message_external_ref_aliases (message_id);

CREATE UNIQUE INDEX IF NOT EXISTS auto_reply_inbound_inbox_message_uq
  ON messages.auto_reply_inbound_inbox (account_id, inbound_message_id);

CREATE TABLE IF NOT EXISTS messages.auto_reply_inbound_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  reason_code text NOT NULL,
  payload_digest text NOT NULL,
  payload_preview text,
  payload_size integer NOT NULL CHECK (payload_size >= 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auto_reply_inbound_quarantine_account_created_idx
  ON messages.auto_reply_inbound_quarantine (account_id, created_at DESC);
