import type { Store } from './domain.js';
import type { XianyuMtopClient } from './xianyu-mtop.js';

export const ITEM_DETAIL_RISK_SOURCE = 'mtop.taobao.idle.pc.detail';

/** Only replays read operations. A Token/IM success proves no other API healthy. */
export async function recheckVerificationRisks(store: Store, mtop: XianyuMtopClient, adminId: string, accountId: string): Promise<void> {
  const risks = await store.listAccountVerificationRisks(adminId, accountId);
  for (const risk of risks) {
    if (risk.source !== ITEM_DETAIL_RISK_SOURCE) continue;
    let itemId = risk.recoveryRequest?.kind === 'item_detail' ? risk.recoveryRequest.itemId : undefined;
    // Older rows have no request context. Verify this API with a product from
    // this account's catalog, never another account or an arbitrary mutation.
    if (!risk.recoveryRequest) {
      const products = await store.listProducts(adminId, { accountId, page: 1, pageSize: 1 });
      itemId = products.items[0]?.externalProductRef;
    }
    if (typeof itemId !== 'string' || !itemId.trim() || itemId.length > 128) continue;
    const startedAt = new Date().toISOString();
    const result = await mtop.recheckItemDetail(adminId, accountId, itemId);
    if (!result.success) continue;
    await store.clearAccountRisk({ adminId, accountId, source: risk.source, episode: risk.episode,
      expectedRiskRevision: risk.revision, startedAt });
  }
}
