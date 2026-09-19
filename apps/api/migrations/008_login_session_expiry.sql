ALTER TABLE auth.account_login_sessions
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes');

CREATE INDEX IF NOT EXISTS account_login_sessions_expiry_idx
  ON auth.account_login_sessions (expires_at, status);
