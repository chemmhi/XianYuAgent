CREATE SCHEMA IF NOT EXISTS execution;

CREATE TABLE IF NOT EXISTS execution.idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  key text NOT NULL,
  request_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'succeeded', 'failed')),
  response_envelope jsonb,
  status_code integer,
  trace_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, key)
);
CREATE INDEX IF NOT EXISTS idempotency_expiry_idx ON execution.idempotency_records (expires_at);

CREATE TABLE IF NOT EXISTS execution.outbox_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  operation text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  lease_owner text,
  last_error_code text,
  external_outcome text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, idempotency_key)
);
CREATE INDEX IF NOT EXISTS outbox_status_available_idx ON execution.outbox_jobs (status, available_at);
