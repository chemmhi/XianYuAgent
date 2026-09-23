-- AR-RA-022 live sender outbox fields.
-- Keep the generic execution.outbox_jobs table compatible while adding the
-- redacted payload and reconciliation fields required by auto-reply sends.

ALTER TABLE execution.outbox_jobs
  ADD COLUMN IF NOT EXISTS payload_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE execution.outbox_jobs
  ADD COLUMN IF NOT EXISTS outbound_message_id uuid;

ALTER TABLE execution.outbox_jobs
  ADD COLUMN IF NOT EXISTS external_message_ref text;

ALTER TABLE execution.outbox_jobs
  ADD COLUMN IF NOT EXISTS trace_id text;

ALTER TABLE execution.outbox_jobs
  ADD COLUMN IF NOT EXISTS last_error_digest text;

ALTER TABLE execution.outbox_jobs
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

ALTER TABLE execution.outbox_jobs
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS outbox_aggregate_idx
  ON execution.outbox_jobs (scope, aggregate_id, created_at);

CREATE INDEX IF NOT EXISTS outbox_lease_idx
  ON execution.outbox_jobs (scope, status, lease_expires_at);
