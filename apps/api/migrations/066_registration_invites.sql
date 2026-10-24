CREATE TABLE IF NOT EXISTS auth.registration_invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code_hash text NOT NULL UNIQUE, code_prefix text NOT NULL, created_by uuid NOT NULL REFERENCES auth.admins(id) ON DELETE RESTRICT, request_key text NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz, used_by uuid REFERENCES auth.admins(id) ON DELETE RESTRICT, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (created_by, request_key)
);
CREATE INDEX IF NOT EXISTS registration_invites_created_by_idx ON auth.registration_invites(created_by, created_at DESC);
