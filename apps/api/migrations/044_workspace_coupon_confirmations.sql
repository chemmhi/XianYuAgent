-- Expand the confirmation action enum for the Workspace native coupon-create slice.
-- Keep this migration compatible with databases that already applied 043.
ALTER TABLE workspace.confirmations DROP CONSTRAINT IF EXISTS confirmations_action_check;
ALTER TABLE workspace.confirmations DROP CONSTRAINT IF EXISTS workspace_confirmations_action_check;
ALTER TABLE workspace.confirmations
  ADD CONSTRAINT confirmations_action_check CHECK (action IN ('product_publish', 'coupon_create'));
