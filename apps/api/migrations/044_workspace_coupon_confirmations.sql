-- Expand the confirmation action enum for the Workspace native coupon-create slice.
-- Keep this migration compatible with databases that already applied 043.
-- The development migration runner replays every migration on each startup. If
-- a later migration already persisted a newer action, do not temporarily
-- narrow the check constraint and fail while rebuilding it; migration 046 will
-- restore the complete action set below.
DO $$
BEGIN
  IF to_regclass('workspace.confirmations') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM workspace.confirmations
      WHERE action NOT IN ('product_publish', 'coupon_create')
    ) THEN
    ALTER TABLE workspace.confirmations DROP CONSTRAINT IF EXISTS confirmations_action_check;
    ALTER TABLE workspace.confirmations DROP CONSTRAINT IF EXISTS workspace_confirmations_action_check;
    ALTER TABLE workspace.confirmations
      ADD CONSTRAINT confirmations_action_check CHECK (action IN ('product_publish', 'coupon_create'));
  END IF;
END $$;
