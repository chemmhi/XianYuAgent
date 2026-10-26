import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { AuthService } from '../src/services.js';
import { loadConfig } from '../src/config.js';
import { VerificationRuntime } from '../src/verification-runtime.js';
import { XIANYU_IM_TOKEN_API } from '../src/xianyu-im.js';
import { verificationDto } from '../src/verification-dto.js';

test('platform result DTO picks only bounded result metadata and keeps account success separate', () => {
  const platformResult = { status: 'rejected', code: 300, sequence: 1, challengeGeneration: 1, observedAt: 123, rawResponse: 'private-response', url: 'private-url' };
  const dto = verificationDto({ state: 'human_active', subject: {}, platformResult } as never);
  assert.deepEqual(dto.platformResult, { status: 'rejected', code: 300, sequence: 1, challengeGeneration: 1, observedAt: 123 });
  assert.equal(JSON.stringify(dto).includes('private-'), false); assert.equal(dto.state, 'human_active'); assert.equal(dto.executionOutcome, undefined);
});

test('bound QR authorization reapplies account allowlist and preserves creator-only control', async () => {
  const store = new MemoryStore();
  const owner = await store.createAdmin({ email: 'owner-qr@example.test', passwordHash: 'fixture', displayName: 'owner' });
  const other = await store.createAdmin({ email: 'other-qr@example.test', passwordHash: 'fixture', displayName: 'other' });
  const allowed = await store.createAccount({ adminId: owner.id, platform: 'xianyu', sellerRef: 'allowed' });
  const excluded = await store.createAccount({ adminId: owner.id, platform: 'xianyu', sellerRef: 'excluded' });
  await store.grantScope({ adminId: other.id, accountId: excluded.id, scope: 'manage' });
  const qr = await store.createLoginSession({ adminId: owner.id, accountId: excluded.id, loginMethod: 'qr', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const config = loadConfig({ XIANYU_VERIFICATION_REMOTE_ENABLED: 'true', XIANYU_VERIFICATION_REMOTE_ACCOUNTS: allowed.id });
  const runtime = new VerificationRuntime(store, new AuthService(store, config), config);
  try {
    assert.equal(await runtime.authorize({ adminId: owner.id, accountId: allowed.id }, owner.id), true);
    assert.equal(await runtime.authorize({ adminId: owner.id, loginSessionId: qr.id }, owner.id), false, 'a provisional subject cannot bypass the bound account allowlist');
    config.xianyuVerificationRemoteAccounts = [];
    assert.equal(await runtime.authorize({ adminId: owner.id, loginSessionId: qr.id }, owner.id), true);
    assert.equal(await runtime.authorize({ adminId: owner.id, loginSessionId: qr.id }, other.id), false, 'manage access alone does not confer QR creator identity');
  } finally { await runtime.close(); }
});

test('IM session completion requires this round to clear IM risk and obtain fresh transport evidence', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'health-round@example.test', passwordHash: 'fixture', displayName: 'health' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'health' });
  const credential = await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=health' });
  const config = loadConfig({ XIANYU_VERIFICATION_REMOTE_ENABLED: 'true' });
  const runtime = new VerificationRuntime(store, new AuthService(store, config), config);
  const subject = { adminId: admin.id, accountId: account.id, credentialGeneration: credential.generation, source: XIANYU_IM_TOKEN_API };
  const health = (createdAt: number) => (runtime as any).health(subject, { createdAt });
  try {
    await store.setAccountTransport({ adminId: admin.id, accountId: account.id, status: 'connected', expectedGeneration: credential.generation });
    await store.recordAccountRisk({ adminId: admin.id, accountId: account.id, source: XIANYU_IM_TOKEN_API, code: 'ACCOUNT_VALIDATION_REQUIRED' });
    assert.equal(await health(Date.now() - 1_000), 'pending', 'an old live socket does not turn unresolved token verification into partial success');
    const risk = (await store.listAccountVerificationRisks(admin.id, account.id))[0];
    await store.clearAccountRisk({ adminId: admin.id, accountId: account.id, source: risk.source, episode: risk.episode,
      expectedRiskRevision: risk.revision, expectedGeneration: credential.generation, startedAt: new Date(Date.now() + 1).toISOString() });
    assert.equal(await health(Date.now() + 1_000), 'pending', 'transport heartbeat from before session creation is insufficient');
    assert.equal(await health(Date.now() - 1_000), 'ready');
    await store.recordAccountRisk({ adminId: admin.id, accountId: account.id, source: 'unrelated.read', code: 'ACCOUNT_VALIDATION_REQUIRED' });
    assert.equal(await health(Date.now() - 1_000), 'partial', 'remaining independent risk is displayed as partial, never connected success');
  } finally { await runtime.close(); }
});

test('retry rejects a disabled browser and a completed QR without reserving intent or waking recovery', async () => {
  const store = new MemoryStore(); const admin = await store.createAdmin({ email: 'retry-terminal@example.test', passwordHash: 'fixture', displayName: 'retry' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'retry' });
  const config = loadConfig({ XIANYU_VERIFICATION_REMOTE_ENABLED: 'true', XIANYU_VERIFICATION_BROWSER_MODE: 'disabled' });
  let wakes = 0; const runtime = new VerificationRuntime(store, new AuthService(store, config), config, {}, () => { wakes++; });
  try {
    await assert.rejects(runtime.retry({ adminId: admin.id, accountId: account.id }, 'manual_only'), { code: 'VERIFICATION_BROWSER_DISABLED', statusCode: 503 });
    config.xianyuVerificationBrowserMode = 'launch';
    const qr = await store.createLoginSession({ adminId: admin.id, accountId: account.id, loginMethod: 'qr', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await store.updateLoginSession(admin.id, account.id, qr.id, { status: 'succeeded' });
    await assert.rejects(runtime.retry({ adminId: admin.id, loginSessionId: qr.id }, 'manual_only'), { code: 'VERIFICATION_QR_FINISHED', statusCode: 410 });
    assert.equal(wakes, 0); assert.equal((await runtime.coordinator.repository.list()).length, 0);
  } finally { await runtime.close(); }
});

test('remote-enabled runtime cannot bypass the explicitly disabled automatic solver', async () => {
  const store = new MemoryStore(); const config = loadConfig({ XIANYU_VERIFICATION_REMOTE_ENABLED: 'true', XIANYU_VERIFICATION_BROWSER_MODE: 'launch', XIANYU_VERIFICATION_SLIDER_MODE: 'disabled' });
  const runtime = new VerificationRuntime(store, new AuthService(store, config), config); let gestures = 0, challenge: any;
  runtime.coordinator.solve = async value => { challenge = value; return 'controlled'; };
  const page = { on: () => undefined, off: () => undefined, mouse: { up: async () => undefined } };
  try {
    await assert.rejects(runtime.retry({ adminId: 'controlled', accountId: 'controlled' }, 'manual_then_auto'), /AUTO_DISABLED/);
    await runtime.runChallenge({ subject: { adminId: 'controlled', accountId: 'controlled' }, page: page as never,
      closeContext: async () => undefined, verdict: () => undefined, pendingAnswers: () => 0, autoAttempt: async () => { gestures++; return { success: true }; } });
    assert.equal(challenge.autoAllowed, false); await assert.rejects(challenge.autoAttempt(async () => undefined, async () => undefined), /AUTO_DISABLED/);
    assert.equal(gestures, 0); await challenge.browser.close();
  } finally { await runtime.close(); }
});
