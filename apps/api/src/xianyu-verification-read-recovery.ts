import type { Store } from './domain.js';
import type { XianyuMtopClient } from './xianyu-mtop.js';
import type { XianyuVerificationBrowser } from './xianyu-verification-browser.js';
import { createVerificationReadRequest, isImVerificationSource, resolveVerificationReadRequest } from './xianyu-verification-request.js';
import { cookieHeaderFromSnapshot, cookieSnapshotFromMetadata, dropStaleCaptchaChallengeCookies, metadataWithCookieSnapshot } from './xianyu-cookie-jar.js';
import { XianyuBrowserStageError } from './xianyu-browser-challenge-handoff.js';

export class XianyuReadRecoveryError extends AggregateError {
  readonly code = 'XIANYU_VERIFICATION_READ_RECOVERY_FAILED';
  constructor(errors: unknown[], readonly abortAccountRecovery: boolean) {
    super(errors, 'XIANYU_VERIFICATION_READ_RECOVERY_FAILED');
  }
}

/** Recover original read APIs independently of IM Token health. */
export async function recoverVerificationReads(store: Store, mtop: XianyuMtopClient, browser: XianyuVerificationBrowser,
  adminId: string, accountId: string): Promise<void> {
  const risks = await store.listAccountVerificationRisks(adminId, accountId);
  const errors: unknown[] = [];
  let abortAccountRecovery = false;
  for (const risk of risks) {
    const request = resolveVerificationReadRequest(risk.source, risk.recoveryRequest);
    if (!request && isImVerificationSource(risk.source)) continue;
    // Triggering recovery is independent of replay permission. A mutation or
    // unknown API gets a browser-owned safe probe, never its original write.
    const browserRequest = request ?? createVerificationReadRequest('mtop.taobao.idlemessage.pc.loginuser.get', '1.0', {}, { needLogin: 'false' })!;
    try {
      const account = await store.getAccount(adminId, accountId);
      const credential = await store.getCredential(adminId, accountId);
      if (!account || account.status === 'disabled' || credential?.status !== 'active' || !credential.cookieHeader) break;
      // MemoryStore returns a live object: fence the generation before awaiting Chrome.
      const expected = structuredClone(credential);
      const startedAt = new Date().toISOString();
      const expectedUserId = account.platformUserId ?? account.sellerRef;
      const completed = await browser.waitForCompletion({ verificationUrl: 'https://www.goofish.com/punish',
        profileKey: accountId, initialCookieSnapshot: cookieSnapshotFromMetadata(expected.metadata)
          ?? headerSnapshot(expected.cookieHeader!), allowManualFallback: false,
        readRequest: { request: browserRequest, expectedUserId } });
      const snapshot = dropStaleCaptchaChallengeCookies(completed.cookieSnapshot);
      const cookieHeader = cookieHeaderFromSnapshot(snapshot.filter(cookie => /(^|\.)goofish\.com$/.test(cookie.domain ?? '') && cookie._crHasCrossSiteAncestor !== true));
      if (!cookieHeader || completed.verifiedRead?.api !== browserRequest.api || completed.verifiedRead.userId !== expectedUserId) throw new Error('XIANYU_BROWSER_MTOP_IDENTITY_MISMATCH');
      const saved = await store.commitCredentialRefresh({ adminId, accountId, expected, cookieHeader,
        accessToken: expected.accessToken, deviceId: expected.deviceId, metadata: metadataWithCookieSnapshot(expected.metadata, snapshot) });
      if (!saved) throw new Error('XIANYU_VERIFICATION_CREDENTIAL_CHANGED');
      const committedGeneration = structuredClone(saved);
      if (!request) {
        console.info(JSON.stringify({ component: 'xianyu-verification', event: 'verification_probe_completed', accountId, source: risk.source }));
        continue;
      }
      // Server transport must also accept the stored snapshot. A browser verdict
      // alone never clears risk for a different session or a newer request.
      const session = mtop.createCredentialSession(adminId, accountId, committedGeneration);
      const result = await session.client.recheckReadRequest(adminId, accountId, request);
      if (!result.success) continue;
      const final = session.getCredential();
      const committed = await store.commitCredentialRefresh({ adminId, accountId, expected: committedGeneration,
        cookieHeader: final.cookieHeader!, accessToken: committedGeneration.accessToken, deviceId: committedGeneration.deviceId, metadata: final.metadata ?? {} });
      if (!committed) throw new Error('XIANYU_VERIFICATION_CREDENTIAL_CHANGED');
      await store.clearAccountRisk({ adminId, accountId, source: risk.source, episode: risk.episode, expectedRiskRevision: risk.revision, startedAt });
    } catch (error) {
      errors.push(error);
      // A new login/revocation invalidates the account generation, whereas a
      // failed API challenge must not prevent independent sources recovering.
      abortAccountRecovery = error instanceof Error && error.message === 'XIANYU_VERIFICATION_CREDENTIAL_CHANGED';
      console.warn(JSON.stringify({ component: 'xianyu-verification', event: 'verification_read_source_failed', accountId,
        api: browserRequest.api, errorCode: abortAccountRecovery ? 'XIANYU_VERIFICATION_CREDENTIAL_CHANGED'
          : error instanceof XianyuBrowserStageError ? error.message : 'XIANYU_VERIFICATION_READ_SOURCE_FAILED' }));
      if (abortAccountRecovery) break;
    }
  }
  if (errors.length) throw new XianyuReadRecoveryError(errors, abortAccountRecovery);
}

function headerSnapshot(header: string) {
  return header.split(';').map(part => part.trim()).filter(part => part.includes('=')).map(part => {
    const index = part.indexOf('=');
    return { name: part.slice(0, index), value: part.slice(index + 1), domain: '.goofish.com', path: '/', secure: true, sameSite: 'None' as const };
  });
}
