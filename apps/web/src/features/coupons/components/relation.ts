import type { CouponBatchVM } from '../types';

export interface CouponRelationPersistence {
  bindBatch: (batchId: string, productId: string, options?: { reload?: boolean }) => Promise<unknown>;
  unbindBatch: (batchId: string, productId: string, options?: { reload?: boolean }) => Promise<unknown>;
  getDetail: (batchId: string) => Promise<CouponBatchVM>;
}

/**
 * Applies the selected product set and only signals completion after the
 * server has returned the hydrated batch detail. Callers can safely close
 * the editor from onSaved because failures never reach that callback.
 */
export async function saveCouponRelation(
  batchId: string,
  productIds: string[],
  initialIds: string[],
  persistence: CouponRelationPersistence,
  onSaved: (detail: CouponBatchVM) => void,
): Promise<CouponBatchVM> {
  const nextIds = new Set(productIds);
  for (const productId of initialIds) {
    if (!nextIds.has(productId)) await persistence.unbindBatch(batchId, productId, { reload: false });
  }
  for (const productId of productIds) {
    if (!initialIds.includes(productId)) await persistence.bindBatch(batchId, productId, { reload: false });
  }
  const detail = await persistence.getDetail(batchId);
  onSaved(detail);
  return detail;
}
