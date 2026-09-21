CREATE SCHEMA IF NOT EXISTS settings;

CREATE TABLE IF NOT EXISTS settings.auto_reply_agent_configs (
  admin_id uuid PRIMARY KEY REFERENCES auth.admins(id) ON DELETE RESTRICT,
  config_version integer NOT NULL DEFAULT 1 CHECK (config_version > 0),
  config_json jsonb NOT NULL,
  config_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auto_reply_agent_configs_updated_idx
  ON settings.auto_reply_agent_configs (updated_at DESC);
