import assert from 'node:assert/strict';
import test from 'node:test';
import { VerificationCoordinator } from '../src/verification-coordinator.js';
import { MemoryVerificationRepository } from '../src/verification-repository.js';
import { VERIFICATION_TIMING, type VerificationChallenge } from '../src/verification-domain.js';
import { nativeVerificationCandidate, nativeVerificationUrl } from '../src/verification-native-candidate.js';

const url = 'https://h5api.m.goofish.com/h5/mtop.test.read/1.0/_____tmd_____/punish?x5secdata=a+b%2F&note=hello%20world#keep';
const pause = (ms = 5) => new Promise(r => setTimeout(r, ms));
async function until(check: () => Promise<boolean>) { for (let i = 0; i < 100; i++) { if (await check()) return; await pause(); } throw new Error('test state did not arrive'); }
async function fixture(apply?: () => Promise<void>, drain = 100) {
  let now = 1_000_000, allowed = true, sessionAllowed = true, applied = 0, automatic = 0, closed = 0, captured = 0, solved = false;
  let verdict: { code: number; success: boolean; sequence: number } | undefined;
  const repository = new MemoryVerificationRepository();
  const coordinator = new VerificationCoordinator(repository, { authorize: async () => allowed, health: async () => 'pending' },
    { now: () => now, monotonic: () => 0 }, { ...VERIFICATION_TIMING, drain });
  const challenge: VerificationChallenge = { subject: { adminId: 'admin', accountId: 'account', credentialGeneration: 1 },
    autoAllowed: true, native: { url, applyCandidate: async () => { applied++; await apply?.(); } },
    browser: { capture: async () => { captured++; return undefined; }, canSend: async () => false,
      pointer: async () => { throw new Error('native has no pointer relay'); }, invalidate: () => {}, release: async () => {}, close: async () => {} },
    closeContext: async () => { closed++; }, verdict: () => verdict, pendingAnswers: () => 0,
    autoAttempt: async () => { automatic++; verdict = { code: 0, success: true, sequence: 1 }; return { success: true }; } };
  const task = coordinator.solve(challenge).then(() => { solved = true; return 'resolved'; }, e => e.code as string);
  await until(async () => (await repository.list()).length > 0);
  const row = async () => (await repository.list())[0];
  const id = (await row()).id;
  const base = { adminId: 'admin', authSessionId: 'auth', clientId: 'client', challengeGeneration: 1 };
  const offer = await coordinator.nativePresentation(id, base);
  const claimInput = { ...base, leaseId: offer.leaseId, version: offer.row.version };
  const claim = async () => coordinator.nativeClaim(id, claimInput);
  const candidate = () => ({ value: 'synthetic-x5sec', host: 'h5api.m.goofish.com', expire: now + 60_000 });
  const control = () => ({ ...base, leaseId: offer.leaseId, controlEpoch: 1 });
  return { coordinator, repository, challenge, id, base, offer, claimInput, row, claim, candidate, control, task,
    advance: (ms: number) => { now += ms; }, allowed: (v: boolean) => { allowed = v; }, sessionAllowed: (v: boolean) => { sessionAllowed = v; },
    access: async () => sessionAllowed, counts: () => ({ applied, automatic, closed, captured, solved }) };
}

test('native URL preserves the signed query bytes and candidate is only one issued host cookie', () => {
  assert.equal(nativeVerificationUrl(url), url.replace('#keep', '&addCookieToHeader=1#keep'));
  assert.equal(nativeVerificationUrl(nativeVerificationUrl(url)), nativeVerificationUrl(url));
  assert.throws(() => nativeVerificationUrl('https://evil.example/punish'));
  const valid = { host: 'h5api.m.goofish.com', value: 'synthetic', expire: Date.now() + 60_000 };
  assert.deepEqual(nativeVerificationCandidate(valid, url, Date.now()), valid);
  for (const patch of [{ host: 'www.goofish.com' }, { value: 'injected; cookie=other' }, { value: 'bad\r\n' },
    { expire: Infinity }, { expire: Date.now() - 1 }, { expire: Date.now() + 90_000_000 }, { path: '/' }]) {
    assert.throws(() => nativeVerificationCandidate({ ...valid, ...patch }, url, Date.now()));
  }
});

test('native control needs no captured frame; a candidate wakes business recheck without fabricating a platform verdict', async () => {
  const f = await fixture();
  try {
    const claimed = await f.claim(); assert.equal(claimed.row.humanDeadline! - claimed.row.updatedAt, 30_000);
    assert.equal(await f.coordinator.frame(f.id, 'admin', 'client'), undefined);
    const result = await f.coordinator.nativeResult(f.id, f.control(), f.candidate(), f.access);
    assert.equal(await f.task, 'resolved'); assert.equal(result.state, 'handoff'); assert.equal(result.platformResult, undefined);
    assert.equal(result.resultCandidateReceived, true); assert.equal(f.counts().applied, 1); assert.equal(f.counts().captured, 0);
    const persisted = JSON.stringify(await f.repository.list()); assert.doesNotMatch(persisted, /synthetic-x5sec|x5secdata|addCookieToHeader/);
  } finally { await f.coordinator.close(); }
});

test('native leases bind auth, client, generation, epoch and version; renewal never extends the human deadline', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.coordinator.nativeClaim(f.id, { ...f.claimInput, authSessionId: 'other' }), /CONTROL_EXPIRED/);
    await assert.rejects(f.coordinator.nativeClaim(f.id, { ...f.claimInput, version: 0 }), /VERSION_CHANGED/);
    const first = await f.claim(), duplicate = await f.claim(); assert.equal(first.row.humanDeadline, duplicate.row.humanDeadline);
    f.advance(2_000); await f.coordinator.nativePresentation(f.id, f.base);
    assert.equal((await f.row()).humanDeadline, first.row.humanDeadline);
    await assert.rejects(f.coordinator.nativePresentation(f.id, { ...f.base, clientId: 'other' }), /CONTROL_BUSY/);
    for (const patch of [{ controlEpoch: 0 }, { leaseId: 'old' }, { challengeGeneration: 2 }, { clientId: 'other' }]) {
      await assert.rejects(f.coordinator.nativeResult(f.id, { ...f.control(), ...patch }, f.candidate(), f.access), /CONTROL_EXPIRED/);
    }
    assert.equal(f.counts().applied, 0);
  } finally { await f.coordinator.close(); }
});

test('concurrent duplicate native results apply once and block automation while the original operation is in flight', async () => {
  let finish!: () => void; const barrier = new Promise<void>(r => { finish = r; });
  const f = await fixture(() => barrier, 1_000);
  try {
    await f.claim(); const candidate = f.candidate();
    const a = f.coordinator.nativeResult(f.id, f.control(), candidate, f.access);
    const b = f.coordinator.nativeResult(f.id, f.control(), candidate, f.access);
    await until(async () => (await f.row()).state === 'settling');
    await assert.rejects(f.coordinator.auto(f.id, 'admin'), /STATE_CHANGED/);
    await assert.rejects(f.coordinator.continueChallenge(f.id, f.challenge), /RESULT_PENDING/);
    await pause(60); assert.equal(f.counts().automatic, 0); assert.equal(f.counts().solved, false);
    finish(); await Promise.all([a, b]); assert.equal(f.counts().applied, 1);
  } finally { finish(); await f.coordinator.close(); }
});

for (const loss of ['authorization', 'session', 'cancel']) test(`native ${loss} loss during candidate apply closes the context without waking the original request`, async () => {
  let finish!: () => void; const barrier = new Promise<void>(r => { finish = r; });
  const f = await fixture(() => barrier, 1_000);
  try {
    await f.claim(); const result = f.coordinator.nativeResult(f.id, f.control(), f.candidate(), f.access);
    const rejected = assert.rejects(result);
    await until(async () => f.counts().applied === 1);
    if (loss === 'authorization') f.allowed(false);
    else if (loss === 'session') f.sessionAllowed(false);
    else await f.coordinator.nativeCancel(f.id, f.control());
    finish(); await rejected; await f.task;
    assert.equal(f.counts().solved, false); assert.equal(f.counts().automatic, 0); assert.equal(f.counts().closed, 1);
  } finally { finish(); await f.coordinator.close(); }
});

test('unknown native apply timeout stops the round instead of retrying automatic against an uncertain context', async () => {
  const f = await fixture(() => new Promise(() => {}), 30);
  try {
    await f.claim(); await assert.rejects(f.coordinator.nativeResult(f.id, f.control(), f.candidate(), f.access), /APPLY_TIMEOUT/);
    assert.equal(await f.task, 'VERIFICATION_NATIVE_APPLY_TIMEOUT'); assert.equal(f.counts().automatic, 0); assert.equal(f.counts().closed, 1);
  } finally { await f.coordinator.close(); }
});

test('a claimed native human round expires without starting the same challenge automatically', async () => {
  const f = await fixture();
  try {
    await f.claim(); f.advance(30_000); await pause(70);
    assert.equal(await f.task, 'VERIFICATION_NATIVE_HUMAN_RESULT_UNKNOWN'); assert.equal(f.counts().automatic, 0);
    await assert.rejects(f.coordinator.nativeResult(f.id, f.control(), f.candidate(), f.access), /NOT_ACTIVE/);
  } finally { await f.coordinator.close(); }
});

test('native offer that was never claimed still lets an unattended backend attempt run normally', async () => {
  const f = await fixture();
  try {
    f.advance(5_000); await pause(70); assert.equal(await f.task, 'resolved'); assert.equal(f.counts().automatic, 1); assert.equal(f.counts().applied, 0);
  } finally { await f.coordinator.close(); }
});
