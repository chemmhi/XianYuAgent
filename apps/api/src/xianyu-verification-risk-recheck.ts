import type { Store } from './domain.js';
import type { XianyuMtopClient } from './xianyu-mtop.js';
import { createVerificationReadRequest, resolveVerificationReadRequest } from './xianyu-verification-request.js';

export const ITEM_DETAIL_RISK_SOURCE = 'mtop.taobao.idle.pc.detail';

/** Probe through a buffered credential generation; only that source/revision may clear. */
export async function recheckVerificationRisks(store: Store, mtop: XianyuMtopClient, adminId: string, accountId: string): Promise<void> {
  const risks = await store.listAccountVerificationRisks(adminId, accountId);
  for (const risk of risks) {
    let request = resolveVerificationReadRequest(risk.source, risk.recoveryRequest);
    if (!request && !risk.recoveryRequest && risk.source === ITEM_DETAIL_RISK_SOURCE) {
      const products = await store.listProducts(adminId, { accountId, page: 1, pageSize: 1 });
      const itemId = products.items[0]?.externalProductRef;
      if (itemId) request = createVerificationReadRequest(risk.source, '1.0', { itemId }, {},
        `https://www.goofish.com/item?id=${encodeURIComponent(itemId)}`);
    }
    if (!request) continue;
    const credential = await store.getCredential(adminId, accountId);
    if (credential?.status !== 'active' || !credential.cookieHeader) return;
    const expected = structuredClone(credential);
    const startedAt = new Date().toISOString();
    const session = mtop.createCredentialSession(adminId, accountId, expected);
    const result = await session.client.recheckReadRequest(adminId, accountId, request);
    if (!result.success) continue;
    const final = session.getCredential();
    const saved = await store.commitCredentialRefresh({ adminId, accountId, expected,
      cookieHeader: final.cookieHeader!, accessToken: expected.accessToken, deviceId: expected.deviceId, metadata: final.metadata ?? {} });
    if (!saved) continue;
    await store.clearAccountRisk({ adminId, accountId, source: risk.source, episode: risk.episode,
      expectedRiskRevision: risk.revision, expectedGeneration: expected.generation, startedAt });
  }
}
