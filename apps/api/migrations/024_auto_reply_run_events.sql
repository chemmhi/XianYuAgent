CREATE SCHEMA IF NOT EXISTS messages;

CREATE TABLE IF NOT EXISTS messages.auto_reply_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES messages.auto_reply_runs(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL,
  stage text NOT NULL,
  status text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  duration_ms integer NULL CHECK (duration_ms IS NULL OR duration_ms >= 0),
  trace_id text NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (run_id, sequence)
);

CREATE INDEX IF NOT EXISTS auto_reply_run_events_account_occurred_idx
  ON messages.auto_reply_run_events (account_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS auto_reply_run_events_run_sequence_idx
  ON messages.auto_reply_run_events (run_id, sequence);
