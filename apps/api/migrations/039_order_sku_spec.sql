ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS sku_spec text;
