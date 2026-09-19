ALTER TABLE auth.account_login_sessions
  DROP CONSTRAINT IF EXISTS account_login_sessions_status_check;

ALTER TABLE auth.account_login_sessions
  ADD CONSTRAINT account_login_sessions_status_check
  CHECK (status IN ('created', 'waiting', 'scanned', 'succeeded', 'expired', 'failed', 'cancelled', 'verification_required'));
