ALTER TABLE products.products
  ADD COLUMN IF NOT EXISTS xianyu_list_rank integer;

CREATE INDEX IF NOT EXISTS products_account_xianyu_list_rank_idx
  ON products.products (account_id, xianyu_list_rank ASC NULLS LAST, id);
