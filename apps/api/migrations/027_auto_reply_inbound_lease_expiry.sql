ALTER TABLE messages.auto_reply_inbound_inbox
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS auto_reply_inbound_inbox_lease_idx
  ON messages.auto_reply_inbound_inbox (status, lease_expires_at);
