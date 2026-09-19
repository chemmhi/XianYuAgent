ALTER TABLE accounts.accounts
  ADD COLUMN IF NOT EXISTS remark text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS platform_user_id text;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_platform_user_id_uq
  ON accounts.accounts (platform, platform_user_id)
  WHERE platform_user_id IS NOT NULL;
