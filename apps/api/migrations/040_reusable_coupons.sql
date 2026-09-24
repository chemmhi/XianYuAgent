BEGIN;

UPDATE coupons.coupon_batches
SET status = 'active', version = version + 1, updated_at = now()
WHERE status = 'exhausted';

UPDATE coupons.coupon_items
SET status = 'available', reserved_until = NULL, consumed_at = NULL
WHERE status = 'consumed';

ALTER TABLE coupons.coupon_batches
  DROP CONSTRAINT IF EXISTS coupon_batches_status_check;

ALTER TABLE coupons.coupon_batches
  ADD CONSTRAINT coupon_batches_status_check
  CHECK (status IN ('draft', 'active', 'paused', 'closed', 'voided'));

COMMIT;
