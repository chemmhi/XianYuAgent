CREATE SCHEMA IF NOT EXISTS observability;

CREATE TABLE IF NOT EXISTS observability.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL,
  actor_id uuid,
  account_id uuid REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  action text NOT NULL,
  target_ref text,
  request_id text NOT NULL,
  trace_id text NOT NULL,
  payload_digest text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_account_created_idx ON observability.audit_events (account_id, created_at);
CREATE INDEX IF NOT EXISTS audit_events_trace_idx ON observability.audit_events (trace_id);

CREATE TABLE IF NOT EXISTS observability.health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component text NOT NULL,
  status text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
