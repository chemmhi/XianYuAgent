CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS auto_reply_inbound_quarantine_dedupe_idx
  ON messages.auto_reply_inbound_quarantine (dedupe_key) WHERE dedupe_key IS NOT NULL;
