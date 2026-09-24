-- All coupon batches are buyer-deliverable in the product model.
-- Normalize legacy rows before removing the obsolete internal permission column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'coupons'
      AND table_name = 'coupon_batches'
      AND column_name = 'delivery_scope'
  ) THEN
    UPDATE coupons.coupon_batches
    SET delivery_scope = 'buyer_deliverable'
    WHERE delivery_scope IS DISTINCT FROM 'buyer_deliverable';

    ALTER TABLE coupons.coupon_batches
      DROP COLUMN delivery_scope;
  END IF;
END $$;
