CREATE TABLE IF NOT EXISTS coupons.coupon_asset_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_batch_id uuid NOT NULL REFERENCES coupons.coupon_batches(id) ON DELETE RESTRICT,
  storage_key text NOT NULL,
  mime_type text NOT NULL,
  checksum text,
  caption text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_batch_id, storage_key)
);

CREATE INDEX IF NOT EXISTS coupon_asset_refs_batch_status_idx
  ON coupons.coupon_asset_refs (coupon_batch_id, status, created_at, id);
