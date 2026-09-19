CREATE TABLE IF NOT EXISTS auth.account_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  platform text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  cookie_header text,
  access_token text,
  device_id text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id)
);

CREATE INDEX IF NOT EXISTS account_credentials_status_idx
  ON auth.account_credentials (account_id, status, updated_at);
