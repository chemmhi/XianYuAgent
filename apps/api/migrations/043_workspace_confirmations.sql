CREATE TABLE IF NOT EXISTS workspace.confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES workspace.runs(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES workspace.steps(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES auth.admins(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('product_publish')),
  policy_ref text NOT NULL,
  manifest_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'confirmed', 'expired', 'rejected', 'cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES auth.admins(id) ON DELETE RESTRICT,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_confirmation_run_step_uq UNIQUE (run_id, step_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_confirmations_active_step_uq
  ON workspace.confirmations (step_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS workspace_confirmations_run_idx
  ON workspace.confirmations (run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS workspace_confirmations_expiry_idx
  ON workspace.confirmations (status, expires_at);
