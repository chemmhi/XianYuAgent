CREATE TABLE IF NOT EXISTS auth.account_login_secrets (
  admin_id uuid NOT NULL REFERENCES auth.admins(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE CASCADE,
  secret_ciphertext text NOT NULL,
  profile_key uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  failure_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id, account_id)
);
CREATE INDEX IF NOT EXISTS account_login_secrets_due ON auth.account_login_secrets(next_attempt_at) WHERE enabled;
CREATE TABLE IF NOT EXISTS auth.password_login_leases (
  account_id uuid PRIMARY KEY REFERENCES accounts.accounts(id) ON DELETE CASCADE,
  owner uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
