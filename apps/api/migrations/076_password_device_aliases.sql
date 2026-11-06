CREATE TABLE IF NOT EXISTS auth.password_device_aliases (
  admin_id uuid NOT NULL REFERENCES auth.admins(id) ON DELETE CASCADE,
  login_digest text NOT NULL CHECK (length(login_digest)=64),
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE CASCADE,
  profile_key uuid NOT NULL,
  PRIMARY KEY (admin_id, login_digest)
);
CREATE INDEX IF NOT EXISTS password_device_aliases_account ON auth.password_device_aliases(account_id);
CREATE TABLE IF NOT EXISTS auth.password_device_profiles (
  admin_id uuid NOT NULL REFERENCES auth.admins(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE CASCADE,
  profile_key uuid NOT NULL,
  PRIMARY KEY (admin_id, account_id, profile_key)
);
INSERT INTO auth.password_device_profiles(admin_id,account_id,profile_key)
SELECT admin_id,account_id,profile_key FROM auth.account_login_secrets
UNION SELECT admin_id,account_id,profile_key FROM auth.password_device_aliases
ON CONFLICT DO NOTHING;
