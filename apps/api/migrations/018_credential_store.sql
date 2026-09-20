CREATE SCHEMA IF NOT EXISTS accounts;

CREATE TABLE IF NOT EXISTS accounts.credential_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('api_key')),
  purpose text NOT NULL CHECK (purpose IN ('model_client')),
  label text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'rotating', 'revoked')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  provider text NOT NULL,
  alias text NOT NULL,
  last_rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, kind, purpose)
);

CREATE INDEX IF NOT EXISTS credential_refs_account_status_idx
  ON accounts.credential_refs (account_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS accounts.credential_values (
  credential_ref_id uuid PRIMARY KEY REFERENCES accounts.credential_refs(id) ON DELETE RESTRICT,
  ciphertext bytea NOT NULL,
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
  checksum text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credential_values_checksum_idx
  ON accounts.credential_values (checksum);
