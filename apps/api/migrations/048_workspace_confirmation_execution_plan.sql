ALTER TABLE workspace.confirmations
  ADD COLUMN IF NOT EXISTS execution_plan_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE workspace.confirmations DROP CONSTRAINT IF EXISTS confirmations_action_check;
ALTER TABLE workspace.confirmations DROP CONSTRAINT IF EXISTS workspace_confirmations_action_check;
ALTER TABLE workspace.confirmations
  ADD CONSTRAINT confirmations_action_check CHECK (action IN (
    'product_publish',
    'product_update',
    'coupon_create',
    'agent_settings_update',
    'product_knowledge_update',
    'product_automation_update',
    'coupon_update',
    'coupon_enable',
    'coupon_disable',
    'coupon_bind',
    'coupon_unbind',
    'coupon_void',
    'coupon_copy',
    'model_settings_update',
    'order_deliver',
    'order_retry',
    'order_cancel'
  ));
