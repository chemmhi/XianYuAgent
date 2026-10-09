CREATE INDEX CONCURRENTLY IF NOT EXISTS auto_reply_inbound_quarantine_created_idx
  ON messages.auto_reply_inbound_quarantine (created_at, id);
