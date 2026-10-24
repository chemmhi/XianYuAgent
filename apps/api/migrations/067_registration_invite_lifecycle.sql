ALTER TABLE auth.registration_invites ADD COLUMN IF NOT EXISTS code_ciphertext text;
ALTER TABLE auth.registration_invites ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE auth.registration_invites ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
