CREATE SCHEMA IF NOT EXISTS settings;

CREATE TABLE IF NOT EXISTS settings.model_provider_config_generations (
  account_id uuid PRIMARY KEY REFERENCES accounts.accounts(id) ON DELETE CASCADE,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings.model_provider_routing (
  account_id uuid PRIMARY KEY REFERENCES accounts.accounts(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto','manual_primary','manual_backup')),
  preferred_role text CHECK (preferred_role IN ('primary','backup')),
  routing_version integer NOT NULL DEFAULT 0 CHECK (routing_version >= 0),
  config_generation integer NOT NULL DEFAULT 0 CHECK (config_generation >= 0),
  updated_by_admin_id uuid REFERENCES auth.admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((mode='auto' AND preferred_role IS NULL) OR (mode <> 'auto' AND preferred_role IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS model_provider_routing_updated_idx
  ON settings.model_provider_routing(updated_at DESC);
