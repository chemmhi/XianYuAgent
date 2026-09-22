CREATE SEQUENCE IF NOT EXISTS coupons.coupon_batch_sequence_id_seq
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1;

ALTER TABLE coupons.coupon_batches
  ADD COLUMN IF NOT EXISTS sequence_id bigint;

UPDATE coupons.coupon_batches
SET sequence_id = nextval('coupons.coupon_batch_sequence_id_seq')
WHERE sequence_id IS NULL;

SELECT setval(
  'coupons.coupon_batch_sequence_id_seq',
  COALESCE(MAX(sequence_id), 1),
  COUNT(*) > 0
)
FROM coupons.coupon_batches;

ALTER SEQUENCE coupons.coupon_batch_sequence_id_seq
  OWNED BY coupons.coupon_batches.sequence_id;

ALTER TABLE coupons.coupon_batches
  ALTER COLUMN sequence_id SET DEFAULT nextval('coupons.coupon_batch_sequence_id_seq'),
  ALTER COLUMN sequence_id SET NOT NULL;

DROP INDEX IF EXISTS coupons.coupon_batches_sequence_id_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS coupon_batches_sequence_id_uidx
  ON coupons.coupon_batches (sequence_id)
  WHERE status <> 'voided';
