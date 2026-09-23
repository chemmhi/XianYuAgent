-- AR-VS-08 source ordering compatibility migration.
-- Live push parsers may expose a platform event id/sequence. Keep both
-- nullable so older inbox rows and gateways without ordering metadata remain
-- readable while the repair runtime can still apply its audited fallback.

ALTER TABLE messages.auto_reply_inbound_inbox
  ADD COLUMN IF NOT EXISTS source_event_id text;

ALTER TABLE messages.auto_reply_inbound_inbox
  ADD COLUMN IF NOT EXISTS source_sequence bigint;

ALTER TABLE messages.auto_reply_inbound_inbox
  DROP CONSTRAINT IF EXISTS auto_reply_inbound_inbox_source_sequence_positive;

ALTER TABLE messages.auto_reply_inbound_inbox
  ADD CONSTRAINT auto_reply_inbound_inbox_source_sequence_positive
  CHECK (source_sequence IS NULL OR source_sequence > 0);

CREATE INDEX IF NOT EXISTS auto_reply_inbound_inbox_source_order_idx
  ON messages.auto_reply_inbound_inbox (account_id, conversation_id, source_sequence, created_at);
