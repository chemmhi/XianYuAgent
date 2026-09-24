BEGIN;

ALTER TABLE coupons.coupon_batches
  DROP COLUMN IF EXISTS quark_url,
  DROP COLUMN IF EXISTS extract_code_ciphertext;

COMMIT;
