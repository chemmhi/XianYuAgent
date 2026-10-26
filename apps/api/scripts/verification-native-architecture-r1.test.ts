import assert from 'node:assert/strict';
import test from 'node:test';
import { VerificationCoordinator } from '../src/verification-coordinator.js';
import { MemoryVerificationRepository } from '../src/verification-repository.js';
import { VERIFICATION_TIMING, type VerificationChallenge, type VerificationSession } from '../src/verification-domain.js';
import { verificationNativeHttp } from '../src/verification-native-http.js';
import type { VerificationRuntime } from '../src/verification-runtime.js';
import type { AuthContext } from '../src/services.js';

const url = 'https://h5api.m.goofish.com/h5/mtop.test.read/1.0/_____tmd_____/punish?synthetic=1';
const pause = () => new Promise(r => setTimeout(r, 1));
async function fixture() {
  let now = 1_000_000;
  const repository = new MemoryVerificationRepository();
  const coordinator = new VerificationCoordinator(repository, { authorize: async () => true, health: async () => 'pending' },
    { now: () => now, monotonic: () => 0 }, VERIFICATION_TIMING);
  const challenge: VerificationChallenge = {
    subject: { adminId: 'admin', accountId: 'account', credentialGeneration: 1 }, autoAllowed: true,
    native: { url, applyCandidate: async () => {} },
    browser: { capture: async () => undefined, canSend: async () => false, pointer: async () => {},
      invalidate() {}, release: async () => {}, close: async () => {} },
    closeContext: async () => {}, verdict: () => undefined, pendingAnswers: () => 0,
    autoAttempt: async () => ({ success: false }),
  };
  const solve = coordinator.solve(challenge).catch(() => undefined);
  while (!(await repository.list()).length) await pause();
  const id = (await repository.list())[0].id;
  const base = { adminId: 'admin', authSessionId: 'auth', clientId: 'review_client_123456789', challengeGeneration: 1 };
  const offer = await coordinator.nativePresentation(id, base);
  const claimInput = { ...base, leaseId: offer.leaseId, version: offer.row.version };
  return { coordinator, repository, id, base, offer, claimInput, challenge, solve,
    advance: (ms: number) => { now += ms; }, now: () => now };
}

test('R1: a cancelled claim must not disclose its signed URL after asynchronous DTO construction', async () => {
  const f = await fixture();
  let release!: () => void, entered!: () => void;
  const dtoWait = new Promise<void>(r => { release = r; });
  const dtoEntered = new Promise<void>(r => { entered = r; });
  const runtime = { coordinator: f.coordinator, config: { xianyuVerificationNativeEnabled: true },
    auth: { validateCsrf: async () => {}, accessFromSession: async () => ({ id: 'auth' }) },
    dto: async (row: VerificationSession) => { entered(); await dtoWait; return row; },
  } as unknown as VerificationRuntime;
  const auth = { admin: { id: 'admin' }, session: { id: 'auth' } } as AuthContext;
  const request = verificationNativeHttp(runtime, { requestId: 'review', traceId: 'review', method: 'POST',
    path: `/api/v1/verification-sessions/${f.id}/native/claim`, query: {}, headers: {}, cookies: {},
    body: { clientInstanceId: f.base.clientId, leaseId: f.offer.leaseId, challengeGeneration: 1,
      expectedVersion: f.offer.row.version } }, auth);
  try {
    await dtoEntered;
    await f.coordinator.nativeCancel(f.id, { ...f.base, leaseId: f.offer.leaseId, controlEpoch: 1 });
    release();
    await assert.rejects(request, /CONTROL_EXPIRED|NOT_ACTIVE|STATE_CHANGED/);
  } finally { release(); await request.catch(() => undefined); await f.coordinator.close(); await f.solve; }
});

test('R1: a continued native challenge must preserve the existing total human deadline', async () => {
  const f = await fixture();
  let continued: Promise<string> | undefined;
  try {
    const first = await f.coordinator.nativeClaim(f.id, f.claimInput);
    f.advance(2_000);
    await f.coordinator.nativeResult(f.id, { ...f.base, leaseId: f.offer.leaseId, controlEpoch: first.row.controlEpoch },
      { host: 'h5api.m.goofish.com', value: 'synthetic', expire: f.now() + 60_000 }, async () => true);
    continued = f.coordinator.continueChallenge(f.id, f.challenge);
    const guarded = continued.catch(() => undefined);
    while ((await f.repository.get(f.id))?.challengeGeneration !== 2) await pause();
    const base2 = { ...f.base, challengeGeneration: 2 };
    const offer2 = await f.coordinator.nativePresentation(f.id, base2);
    const second = await f.coordinator.nativeClaim(f.id, { ...base2, leaseId: offer2.leaseId, version: offer2.row.version });
    assert.equal(second.row.humanDeadline, first.row.humanDeadline);
    void guarded;
  } finally { await f.coordinator.close(); await continued?.catch(() => undefined); await f.solve; }
});
