CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS audit_events_dedupe_idx
  ON observability.audit_events (dedupe_key) WHERE dedupe_key IS NOT NULL;
