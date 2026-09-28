-- Expand Workspace native confirmation actions for Agent settings updates.
-- Keep the migration compatible with databases that already applied 043 and 044.
ALTER TABLE workspace.confirmations DROP CONSTRAINT IF EXISTS confirmations_action_check;
ALTER TABLE workspace.confirmations DROP CONSTRAINT IF EXISTS workspace_confirmations_action_check;
ALTER TABLE workspace.confirmations
  ADD CONSTRAINT confirmations_action_check CHECK (action IN ('product_publish', 'coupon_create', 'agent_settings_update'));
