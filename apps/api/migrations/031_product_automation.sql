CREATE SCHEMA IF NOT EXISTS products;

CREATE TABLE IF NOT EXISTS products.automation_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL UNIQUE REFERENCES products.products(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  config_version integer NOT NULL DEFAULT 1 CHECK (config_version > 0),
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_automation_account_updated_idx
  ON products.automation_configs (account_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS product_automation_product_idx
  ON products.automation_configs (product_id);
