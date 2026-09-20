CREATE SCHEMA IF NOT EXISTS orders;

CREATE TABLE IF NOT EXISTS orders.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  account_name text,
  buyer_id text NOT NULL,
  buyer_name text NOT NULL,
  item_id text NOT NULL,
  item_title text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  payment_status text NOT NULL CHECK (payment_status IN ('unpaid', 'paid', 'closed', 'unknown')),
  order_status text NOT NULL CHECK (order_status IN ('open', 'cancelling', 'cancelled', 'completed', 'closed', 'failed')),
  delivery_status text NOT NULL CHECK (delivery_status IN ('pending', 'reserving', 'delivered', 'partially_delivered', 'failed', 'cancelled')),
  after_sales_status text NOT NULL CHECK (after_sales_status IN ('none', 'requested', 'refunding', 'refunded', 'rejected', 'closed')),
  delivery_type text NOT NULL CHECK (delivery_type IN ('manual', 'no_logistics', 'coupon_only', 'mixed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  delivery_fail_reason text,
  conversation_id text,
  product_id text,
  config_version integer NOT NULL DEFAULT 1 CHECK (config_version > 0),
  source text NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'xianyu')),
  source_payload_digest text,
  UNIQUE (account_id, order_no)
);

CREATE INDEX IF NOT EXISTS orders_account_created_idx ON orders.orders (account_id, created_at DESC, order_no);
CREATE INDEX IF NOT EXISTS orders_account_status_idx ON orders.orders (account_id, payment_status, order_status, delivery_status, after_sales_status);
CREATE INDEX IF NOT EXISTS orders_order_no_idx ON orders.orders (order_no);
