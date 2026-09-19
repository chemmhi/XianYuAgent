ALTER TABLE auth.account_login_sessions
  ADD COLUMN IF NOT EXISTS admin_id uuid REFERENCES auth.admins(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS account_login_sessions_admin_idx
  ON auth.account_login_sessions (admin_id, status, started_at);
