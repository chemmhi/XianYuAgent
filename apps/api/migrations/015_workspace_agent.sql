CREATE SCHEMA IF NOT EXISTS workspace;

CREATE TABLE IF NOT EXISTS workspace.agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  summary text,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, account_id)
);
CREATE INDEX IF NOT EXISTS agent_sessions_account_status_idx
  ON workspace.agent_sessions (account_id, status, last_active_at DESC);

CREATE TABLE IF NOT EXISTS workspace.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  CONSTRAINT runs_session_account_fk FOREIGN KEY (session_id, account_id)
    REFERENCES workspace.agent_sessions(id, account_id) ON DELETE RESTRICT,
  route text NOT NULL DEFAULT 'workspace',
  instruction text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'waiting_confirmation', 'executing', 'retrying', 'cancelling', 'succeeded', 'partially_succeeded', 'failed', 'cancelled', 'expired')),
  requested_by uuid NOT NULL REFERENCES auth.admins(id) ON DELETE RESTRICT,
  client_run_ref text,
  result_summary text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS runs_account_client_ref_uq
  ON workspace.runs (account_id, client_run_ref)
  WHERE client_run_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS runs_account_session_created_idx
  ON workspace.runs (account_id, session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace.steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES workspace.runs(id) ON DELETE CASCADE,
  step_no integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('plan', 'tool_call', 'policy_check', 'mutation', 'observation')),
  label text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'waiting_confirmation', 'executing', 'retrying', 'succeeded', 'partially_succeeded', 'failed', 'skipped', 'cancelled')),
  attempt integer NOT NULL DEFAULT 1,
  input_summary text,
  output_summary text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (run_id, step_no, attempt)
);
CREATE INDEX IF NOT EXISTS steps_run_order_idx ON workspace.steps (run_id, step_no, attempt);

CREATE TABLE IF NOT EXISTS workspace.task_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL UNIQUE REFERENCES workspace.runs(id) ON DELETE CASCADE,
  schema_version integer NOT NULL DEFAULT 1,
  context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  redacted_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace.run_events (
  sequence bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES workspace.runs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_events_run_sequence_idx ON workspace.run_events (run_id, sequence);

CREATE TABLE IF NOT EXISTS workspace.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES workspace.agent_sessions(id) ON DELETE CASCADE,
  run_id uuid REFERENCES workspace.runs(id) ON DELETE SET NULL,
  message_type text NOT NULL CHECK (message_type IN ('user_message', 'reasoning_summary', 'tool_event', 'final_answer')),
  content text NOT NULL,
  summary text,
  sequence bigserial NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_messages_session_sequence_idx ON workspace.messages (session_id, sequence);
