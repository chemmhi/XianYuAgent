ALTER TABLE products.products
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_payload_digest text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_products_source_check'
      AND conrelid = 'products.products'::regclass
  ) THEN
    ALTER TABLE products.products
      ADD CONSTRAINT products_products_source_check CHECK (source IN ('local', 'xianyu'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS products_account_source_updated_idx
  ON products.products (account_id, source, updated_at DESC);
