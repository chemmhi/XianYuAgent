ALTER TABLE accounts.accounts ADD COLUMN IF NOT EXISTS credential_generation bigint NOT NULL DEFAULT 1;
ALTER TABLE auth.account_credentials ADD COLUMN IF NOT EXISTS generation bigint NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION accounts.invalidate_credential_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.status='disabled' AND OLD.status<>'disabled') OR (NEW.deletion_started_at IS NOT NULL AND OLD.deletion_started_at IS NULL) THEN
    NEW.credential_generation := GREATEST(NEW.credential_generation, OLD.credential_generation+1);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS account_credential_lifecycle_fence ON accounts.accounts;
CREATE TRIGGER account_credential_lifecycle_fence BEFORE UPDATE ON accounts.accounts
FOR EACH ROW EXECUTE FUNCTION accounts.invalidate_credential_generation();

CREATE TABLE IF NOT EXISTS accounts.verification_sessions (
  id uuid PRIMARY KEY,
  subject_key text NOT NULL,
  account_id uuid REFERENCES accounts.accounts(id) ON DELETE CASCADE,
  login_session_id uuid REFERENCES auth.account_login_sessions(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  state text NOT NULL CHECK(state IN ('preparing','priority_wait','human_active','auto_active','settling','handoff','rechecking','succeeded','completed_partial','failed','expired','cancelled')),
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((account_id IS NULL) <> (login_session_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS verification_subject_active_idx ON accounts.verification_sessions(subject_key)
WHERE state NOT IN ('succeeded','completed_partial','failed','expired','cancelled');
CREATE TABLE IF NOT EXISTS accounts.verification_session_events (
  sequence bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES accounts.verification_sessions(id) ON DELETE CASCADE,
  state_version bigint NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS accounts.verification_budget_attempts (
  bucket text NOT NULL,
  session_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('session','gesture')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(bucket,attempt_id,kind)
);
CREATE INDEX IF NOT EXISTS verification_budget_window_idx ON accounts.verification_budget_attempts(bucket,kind,reserved_at);
CREATE TABLE IF NOT EXISTS accounts.verification_account_claims (
  account_id uuid PRIMARY KEY REFERENCES accounts.accounts(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL,
  login_session_id uuid REFERENCES auth.account_login_sessions(id) ON DELETE CASCADE,
  generation bigint NOT NULL,
  expires_at timestamptz NOT NULL
);
