CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS accounts;

CREATE TABLE IF NOT EXISTS auth.admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'admin',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admins_email_lower_uq ON auth.admins (lower(email));

CREATE TABLE IF NOT EXISTS accounts.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  seller_ref text NOT NULL,
  display_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'degraded', 'disconnected', 'expired', 'disabled')),
  last_connected_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, seller_ref)
);

CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.admins(id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  csrf_token_hash text NOT NULL,
  revoked_at timestamptz,
  revoke_reason text
);
CREATE INDEX IF NOT EXISTS sessions_admin_expires_idx ON auth.sessions (admin_id, expires_at);

CREATE TABLE IF NOT EXISTS auth.account_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.admins(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  scope text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admin_id, account_id, scope)
);
CREATE INDEX IF NOT EXISTS account_scopes_account_idx ON auth.account_scopes (account_id, scope, status);

CREATE TABLE IF NOT EXISTS auth.account_login_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  provisional_account_ref text,
  login_method text NOT NULL,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'waiting', 'scanned', 'succeeded', 'expired', 'failed', 'cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failure_code text,
  qr_token_ref text
);
CREATE INDEX IF NOT EXISTS account_login_sessions_provisional_idx ON auth.account_login_sessions (provisional_account_ref, status);
CREATE INDEX IF NOT EXISTS account_login_sessions_account_idx ON auth.account_login_sessions (account_id, status);
