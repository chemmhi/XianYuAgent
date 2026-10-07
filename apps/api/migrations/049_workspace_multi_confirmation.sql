ALTER TABLE workspace.confirmations
  DROP CONSTRAINT IF EXISTS workspace_confirmation_run_step_uq;

DROP INDEX IF EXISTS workspace.workspace_confirmations_active_step_uq;

CREATE UNIQUE INDEX IF NOT EXISTS workspace_confirmations_active_run_uq
  ON workspace.confirmations (run_id) WHERE status = 'active';
