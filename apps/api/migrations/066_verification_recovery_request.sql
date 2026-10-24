ALTER TABLE accounts.health_signals
  ADD COLUMN IF NOT EXISTS recovery_request_json jsonb,
  ADD COLUMN IF NOT EXISTS risk_revision uuid NOT NULL DEFAULT gen_random_uuid();
