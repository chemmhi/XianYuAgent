CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_events_created_idx
  ON observability.audit_events (created_at, id);
