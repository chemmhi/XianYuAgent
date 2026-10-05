CREATE TABLE IF NOT EXISTS orders.delivery_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders.orders(id) ON DELETE RESTRICT,
  order_no text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  delivery_type text NOT NULL CHECK (delivery_type IN ('manual', 'no_logistics', 'coupon_only', 'mixed')),
  status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'unknown', 'cancelled')),
  idempotency_scope text NOT NULL,
  idempotency_key text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  coupon_item_id uuid REFERENCES coupons.coupon_items(id) ON DELETE RESTRICT,
  tracking_ref text,
  delivered_at timestamptz,
  failure_code text,
  failure_message text,
  external_outcome text CHECK (external_outcome IN ('known_success', 'known_failure', 'unknown')),
  external_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS delivery_records_order_idx ON orders.delivery_records (account_id, order_no, attempt DESC);
CREATE INDEX IF NOT EXISTS delivery_records_status_idx ON orders.delivery_records (account_id, status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_records_coupon_item_success_uq
  ON orders.delivery_records (coupon_item_id)
  WHERE coupon_item_id IS NOT NULL AND status = 'succeeded';
