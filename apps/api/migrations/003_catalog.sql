CREATE SCHEMA IF NOT EXISTS products;

CREATE TABLE IF NOT EXISTS products.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  external_product_ref text,
  title text NOT NULL,
  description text,
  category_code text,
  attributes_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_reply_template text,
  knowledge_base text,
  config_version integer NOT NULL DEFAULT 1 CHECK (config_version > 0),
  price_minor bigint CHECK (price_minor IS NULL OR price_minor >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'publishing', 'published', 'failed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS products_account_external_ref_uq
  ON products.products (account_id, external_product_ref)
  WHERE external_product_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_account_status_updated_idx
  ON products.products (account_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS products.product_skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products.products(id) ON DELETE RESTRICT,
  sku_code text NOT NULL,
  external_sku_ref text,
  price_minor bigint NOT NULL CHECK (price_minor >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  UNIQUE (product_id, sku_code)
);
CREATE INDEX IF NOT EXISTS product_skus_product_status_idx
  ON products.product_skus (product_id, status);

CREATE TABLE IF NOT EXISTS products.asset_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products.products(id) ON DELETE RESTRICT,
  storage_key text NOT NULL,
  mime_type text NOT NULL,
  checksum text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'failed')),
  UNIQUE (product_id, storage_key)
);
CREATE INDEX IF NOT EXISTS asset_refs_product_status_idx
  ON products.asset_refs (product_id, status);
