ALTER TABLE products.products
  ADD COLUMN IF NOT EXISTS xianyu_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS products_account_xianyu_updated_idx
  ON products.products (account_id, xianyu_updated_at DESC NULLS LAST, updated_at DESC);
