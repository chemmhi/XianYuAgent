CREATE SCHEMA IF NOT EXISTS coupons;

CREATE TABLE IF NOT EXISTS coupons.coupon_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.admins(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES accounts.accounts(id) ON DELETE RESTRICT,
  execution_key text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('delivery', 'gift')),
  batch_ids uuid[] NOT NULL CHECK (cardinality(batch_ids) > 0),
  fingerprint text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL CHECK (status IN ('reserved', 'committed', 'released', 'expired')),
  lease_until timestamptz NOT NULL,
  reason text,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (execution_key)
);

CREATE INDEX IF NOT EXISTS coupon_reservations_admin_account_idx
  ON coupons.coupon_reservations (admin_id, account_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS coupon_reservations_status_lease_idx
  ON coupons.coupon_reservations (status, lease_until);

CREATE TABLE IF NOT EXISTS coupons.coupon_reservation_items (
  reservation_id uuid NOT NULL REFERENCES coupons.coupon_reservations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES coupons.coupon_items(id) ON DELETE RESTRICT,
  PRIMARY KEY (reservation_id, item_id)
);

CREATE INDEX IF NOT EXISTS coupon_reservation_items_item_idx
  ON coupons.coupon_reservation_items (item_id);
