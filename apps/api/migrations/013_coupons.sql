CREATE SCHEMA IF NOT EXISTS coupons;

CREATE TABLE IF NOT EXISTS coupons.coupon_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  label text,
  purpose text NOT NULL,
  delivery_scope text NOT NULL CHECK (delivery_scope IN ('system_only', 'operator_only', 'buyer_deliverable')),
  quark_url text,
  extract_code_ciphertext bytea,
  total_count integer NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'closed', 'exhausted', 'voided')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coupon_batches_account_status_idx ON coupons.coupon_batches (account_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS coupons.coupon_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES coupons.coupon_batches(id) ON DELETE RESTRICT,
  content_ciphertext bytea NOT NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'consumed')),
  reserved_until timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coupon_items_batch_status_idx ON coupons.coupon_items (batch_id, status);

CREATE TABLE IF NOT EXISTS coupons.coupon_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_batch_id uuid NOT NULL REFERENCES coupons.coupon_batches(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products.products(id) ON DELETE RESTRICT,
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_batch_id, product_id)
);
CREATE INDEX IF NOT EXISTS coupon_bindings_product_status_idx ON coupons.coupon_bindings (product_id, status);
