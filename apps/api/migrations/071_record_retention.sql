-- Business evidence must outlive the expendable audit log.
ALTER TABLE orders.delivery_send_steps ADD COLUMN IF NOT EXISTS recovery_verified_at timestamptz;
UPDATE orders.delivery_send_steps s
SET recovery_verified_at = s.updated_at
WHERE s.recovery_verified_at IS NULL AND s.status = 'succeeded'
  AND s.step_key LIKE '%:image:0'
  AND EXISTS (
    SELECT 1 FROM observability.audit_events a
    WHERE a.trace_id = 'delivery-recovery:' || s.order_no || ':' || s.external_ref
      AND a.account_id = s.account_id AND a.action = 'delivery.partial_recovery_verified'
  );

ALTER TABLE observability.audit_events
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS occurrence_count bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE messages.auto_reply_inbound_quarantine
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS occurrence_count bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE observability.audit_events SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 5000,
  autovacuum_analyze_scale_factor = 0.02
);
