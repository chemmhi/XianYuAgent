ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS buyer_avatar_url text;
