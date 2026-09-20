ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS buyer_nickname text;

CREATE INDEX IF NOT EXISTS orders_account_buyer_nickname_idx
  ON orders.orders (account_id, buyer_nickname);
