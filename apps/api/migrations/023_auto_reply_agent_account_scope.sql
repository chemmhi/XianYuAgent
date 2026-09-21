CREATE SCHEMA IF NOT EXISTS settings;

CREATE TABLE IF NOT EXISTS settings.auto_reply_agent_account_configs (
  account_id uuid PRIMARY KEY REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  updated_by_admin_id uuid REFERENCES auth.admins(id) ON DELETE RESTRICT,
  config_version integer NOT NULL DEFAULT 1 CHECK (config_version > 0),
  config_json jsonb NOT NULL,
  config_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auto_reply_agent_account_configs_updated_idx
  ON settings.auto_reply_agent_account_configs (updated_at DESC);

INSERT INTO settings.auto_reply_agent_account_configs (
  account_id,
  updated_by_admin_id,
  config_version,
  config_json,
  config_digest,
  created_at,
  updated_at
)
SELECT
  account.id,
  legacy.admin_id,
  legacy.config_version,
  legacy.config_json,
  legacy.config_digest,
  legacy.created_at,
  legacy.updated_at
FROM settings.auto_reply_agent_configs legacy
JOIN auth.account_scopes scope
  ON scope.admin_id = legacy.admin_id
 AND scope.status = 'active'
 AND (scope.expires_at IS NULL OR scope.expires_at > now())
JOIN accounts.accounts account
  ON account.id = scope.account_id
 AND account.status <> 'disabled'
WHERE NOT EXISTS (
  SELECT 1
  FROM settings.auto_reply_agent_account_configs current_config
  WHERE current_config.account_id = account.id
);
