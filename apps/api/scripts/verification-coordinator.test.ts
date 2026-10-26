import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { VerificationCoordinator } from '../src/verification-coordinator.js';
import { MemoryVerificationRepository } from '../src/verification-repository.js';
import { VERIFICATION_TIMING, type VerificationChallenge, type VerificationSession } from '../src/verification-domain.js';

const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean) {
  for (let i = 0; i < 100; i++) { const value = await read(); if (predicate(value)) return value; await pause(10); }
  throw new Error('fixture state timeout');
}
function fixture(options: { auto?: boolean; stuckRelease?: boolean; drain?: number; authorize?: () => Promise<boolean> } = {}) {
  let now = 100_000, mono = 100_000, verdict: { sequence: number; code: number; success: boolean } | undefined;
  let gestures = 0, releases = 0, closed = 0, pending = 0, issued = 0;
  const repo = new MemoryVerificationRepository();
  const coordinator = new VerificationCoordinator(repo, { authorize: options.authorize ?? (async () => true), health: async () => 'pending' },
    { now: () => now, monotonic: () => mono }, { ...VERIFICATION_TIMING, drain: options.drain ?? 30 });
  const subject = { adminId: randomUUID(), accountId: randomUUID() };
  const frame = { frameId: randomUUID(), streamEpoch: 1, geometryRevision: 1, capturedAt: now, width: 300, height: 50, image: Buffer.from('image') };
  const challenge: VerificationChallenge = { subject, browser: {
    capture: async () => frame, canSend: async () => true,
    pointer: async (_input, admit) => { if (!await admit()) throw new Error('denied'); },
    release: async () => { releases++; if (options.stuckRelease) await new Promise(() => undefined); }, close: async () => undefined, invalidate: () => undefined,
  }, closeContext: async () => { closed++; }, verdict: () => verdict, verdictSequence: () => issued, pendingAnswers: () => pending,
    autoAttempt: async (admit, before) => { await before(); await admit(); gestures++; if (options.auto) { verdict = { sequence: 1, code: 0, success: true }; return { success: true }; } return { success: false }; } };
  const start = () => { const task = coordinator.solve(challenge); void task.catch(() => undefined); return task; };
  const row = async () => (await repo.list())[0]!;
  const prepare = async () => {
    coordinator.presence(subject.adminId, 'client', true);
    const task = start(); const session = await until(row, value => !!value);
    await coordinator.presentation(session.id, subject.adminId, 'client');
    await coordinator.frame(session.id, subject.adminId, 'client');
    const ready = await coordinator.presentation(session.id, subject.adminId, 'client', frame.frameId);
    return { task, ready };
  };
  const claim = (ready: VerificationSession) => coordinator.claim(ready.id, { adminId: subject.adminId, authSessionId: 'auth', clientId: 'client', connectionId: 'connection', version: ready.version, frameId: frame.frameId });
  return { coordinator, repo, subject, frame, challenge, start, row, prepare, claim, advance: (ms: number) => { now += ms; mono += ms; },
    answer: () => { verdict = { sequence: ++issued, code: 0, success: true }; },
    rejectAnswer: () => { verdict = { sequence: ++issued, code: 300, success: true }; },
    beginAnswer: () => { verdict = undefined; return ++issued; },
    finishAnswer: (sequence: number, code: number) => { verdict = { sequence, code, success: true }; }, pending: (value: number) => { pending = value; },
    counts: () => ({ gestures, releases, closed }) };
}

test('production human timeout is 30s; presentation starts the sole 5s window and claim excludes automatic', async () => {
  assert.equal(VERIFICATION_TIMING.human, 30_000);
  const f = fixture({ auto: true });
  try {
    const { task, ready } = await f.prepare();
    assert.equal(ready.priorityDeadline! - ready.readyAt, 5_000);
    const claimed = await f.claim(ready);
    assert.equal(claimed.humanDeadline! - claimed.updatedAt, 30_000);
    await assert.rejects(f.claim(ready), /VERSION_CHANGED|AUTO_STARTED/);
    for (const step of [2_500, 2_501]) { f.advance(step); f.coordinator.presence(f.subject.adminId, 'client', true); await f.coordinator.presentation(ready.id, f.subject.adminId, 'client'); await pause(); }
    assert.equal((await f.row()).state, 'human_active');
    assert.equal(f.counts().gestures, 0);
    f.answer(); await task; assert.equal((await f.row()).state, 'handoff');
  } finally { await f.coordinator.close(); }
});

test('claim at exact deadline loses to automatic; no stale epoch human admission', async () => {
  const f = fixture({ auto: true });
  try {
    const { task, ready } = await f.prepare(); f.advance(5_000);
    await assert.rejects(f.claim(ready), /AUTO_STARTED|CONTROL_EXPIRED|PRESENTATION_EXPIRED/);
    // Presence remains current in a real viewer; fake clock heartbeat is explicit.
    f.coordinator.presence(f.subject.adminId, 'client', true);
    await task; assert.equal(f.counts().gestures, 1);
  } finally { await f.coordinator.close(); }
});

test('29.9s submitted answer succeeds after 30s without any automatic gesture', async () => {
  const f = fixture({ auto: true });
  try {
    const { task, ready } = await f.prepare(); await f.claim(ready);
    // Advance in lease-sized pieces to model persisted owner heartbeats.
    for (let i = 0; i < 5; i++) { f.advance(5_000); f.coordinator.presence(f.subject.adminId, 'client', true); await f.coordinator.presentation(ready.id, f.subject.adminId, 'client'); await pause(); }
    f.advance(4_900); f.pending(1); f.coordinator.presence(f.subject.adminId, 'client', true); await f.coordinator.presentation(ready.id, f.subject.adminId, 'client'); await pause();
    f.advance(200); await until(f.row, row => row.state === 'settling');
    f.advance(300); f.pending(0); f.answer(); await task;
    assert.equal(f.counts().gestures, 0); assert.equal((await f.row()).state, 'handoff');
  } finally { await f.coordinator.close(); }
});

test('release that never settles closes context at the independent drain deadline and never starts auto', async () => {
  const f = fixture({ auto: true, stuckRelease: true });
  try {
    const { task, ready } = await f.prepare(); await f.claim(ready);
    await assert.rejects(f.coordinator.release(ready.id, f.subject.adminId, 'client'), /RELEASE_TIMEOUT/);
    assert.equal(f.counts().closed, 1); assert.equal(f.counts().gestures, 0);
    // Owner remains stopped; no replacement executor on an unconfirmed drain.
    await pause(); assert.equal(f.counts().gestures, 0);
    void task;
  } finally { await f.coordinator.close(); }
});

test('manual-only retry does not silently fall back to auto, even without any viewer', async () => {
  const f = fixture({ auto: true });
  try {
    await f.coordinator.retry(f.subject, 'manual_only'); const task = f.start(); await until(f.row, row => !!row);
    f.advance(2_001); await assert.rejects(task, /PRESENTATION_NOT_READY/); assert.equal(f.counts().gestures, 0);
  } finally { await f.coordinator.close(); }
});

test('manual code300 remains actionable during the original 30s and expires as platform rejected', async () => {
  const f = fixture({ auto: true });
  try {
    await f.coordinator.retry(f.subject, 'manual_only'); const { task, ready } = await f.prepare(); const claimed = await f.claim(ready);
    f.rejectAnswer(); const rejected = await until(f.row, row => row.platformResult?.status === 'rejected');
    assert.equal(rejected.platformResult!.code, 300); assert.equal(rejected.state, 'human_active'); assert.equal(rejected.humanDeadline, claimed.humanDeadline);
    for (let step = 0; step < 6; step++) { f.advance(5_000); f.coordinator.presence(f.subject.adminId, 'client', true); await f.coordinator.presentation(ready.id, f.subject.adminId, 'client'); await pause(); }
    await until(f.row, row => row.state === 'settling'); f.advance(501);
    await assert.rejects(task, /VERIFICATION_PLATFORM_REJECTED/); assert.equal((await f.row()).failureCode, 'VERIFICATION_PLATFORM_REJECTED'); assert.equal(f.counts().gestures, 0);
  } finally { await f.coordinator.close(); }
});

test('a pending request watermark prevents old parsed verdicts entering a new challenge generation', async () => {
  const f = fixture();
  try {
    const { task, ready } = await f.prepare(); await f.claim(ready); f.answer(); await task;
    const oldRequest = f.beginAnswer();
    const continued = f.coordinator.continueChallenge(ready.id, f.challenge); void continued.catch(() => undefined);
    await until(f.row, row => row.challengeGeneration === 2);
    f.finishAnswer(oldRequest, 300); await pause(); assert.equal((await f.row()).platformResult, undefined);
    assert.equal((await f.row()).state, 'preparing');
    f.finishAnswer(oldRequest, 0); await pause(); assert.equal((await f.row()).platformResult, undefined);
    assert.equal((await f.row()).state, 'preparing');
  } finally { await f.coordinator.close(); }
});

test('manual preparing timeout distinguishes unavailable presentation from an unclaimed ready frame', async () => {
  const f = fixture({ auto: true });
  try {
    await f.coordinator.retry(f.subject, 'manual_only'); f.coordinator.presence(f.subject.adminId, 'client', true);
    const task = f.start(); await until(f.row, row => !!row);
    for (let i = 0; i < 2; i++) { f.advance(4_001); f.coordinator.presence(f.subject.adminId, 'client', true); await pause(); }
    await assert.rejects(task, /PRESENTATION_NOT_READY/);
    const failed = await f.row(); assert.equal(failed.priorityDeadline, undefined); assert.equal(failed.state, 'failed'); assert.equal(f.counts().gestures, 0);
  } finally { await f.coordinator.close(); }
  const ready = fixture({ auto: true });
  try {
    await ready.coordinator.retry(ready.subject, 'manual_only'); const { task } = await ready.prepare();
    for (let i = 0; i < 2; i++) { ready.advance(4_001); ready.coordinator.presence(ready.subject.adminId, 'client', true); await pause(); }
    await assert.rejects(task, /WAITING_FOR_HUMAN/); assert.equal((await ready.row()).state, 'failed'); assert.equal(ready.counts().gestures, 0);
  } finally { await ready.coordinator.close(); }
});

test('disabled automatic solver remains manual-only across explicit auto/retry/release commands', async () => {
  const f = fixture({ auto: true }); f.challenge.autoAllowed = false;
  try {
    await f.coordinator.retry(f.subject, 'manual_then_auto'); const { ready } = await f.prepare();
    assert.equal(ready.mode, 'manual_only'); assert.equal(ready.autoAllowed, false);
    await assert.rejects(f.coordinator.auto(ready.id, f.subject.adminId), /AUTO_DISABLED/);
    await assert.rejects(f.coordinator.retry(f.subject, 'manual_then_auto'), /AUTO_DISABLED/);
    await f.claim(ready);
    await assert.rejects(f.coordinator.release(ready.id, f.subject.adminId, 'client', true), /AUTO_DISABLED/);
    assert.equal((await f.row()).state, 'human_active'); assert.equal(f.counts().gestures, 0);
    await f.coordinator.release(ready.id, f.subject.adminId, 'client', false);
    assert.equal((await f.row()).state, 'settling'); f.advance(501);
    await until(f.row, row => row.state === 'cancelled'); assert.equal(f.counts().gestures, 0);
  } finally { await f.coordinator.close(); }
});

test('owner event-loop pause fences old continuation and persisted budget cannot be replayed', async () => {
  const f = fixture();
  try {
    const task = f.start(); await until(f.row, row => !!row); f.advance(7_000);
    await assert.rejects(task, /OWNER_LOST/); assert.equal(f.counts().gestures, 0);
    const bucket = ['account:stable']; const attempt = randomUUID();
    assert.equal(await f.repo.reserve(bucket, randomUUID(), attempt, 'session', 100_000), true);
    assert.equal(await f.repo.reserve(bucket, randomUUID(), attempt, 'session', 100_000), false);
    assert.equal(await f.repo.reserve(bucket, randomUUID(), randomUUID(), 'session', 100_000), false);
  } finally { await f.coordinator.close(); }
});

function latch() { let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve; }); return { promise, open }; }

test('concurrent presentation reservations have exactly one winner', async () => {
  const f = fixture();
  try {
    f.coordinator.presence(f.subject.adminId, 'one', true); f.coordinator.presence(f.subject.adminId, 'two', true);
    f.start(); const row = await until(f.row, Boolean);
    const result = await Promise.allSettled(['one', 'two'].map(client => f.coordinator.presentation(row.id, f.subject.adminId, client)));
    assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  } finally { await f.coordinator.close(); }
});

test('queued automatic command cannot overwrite a claimed human controller', async () => {
  const f = fixture(); const gate = latch(); const entered = latch();
  try {
    const { ready } = await f.prepare(); const save = f.repo.save.bind(f.repo);
    f.repo.save = async (next, version) => { if (next.state === 'human_active') { entered.open(); await gate.promise; } return save(next, version); };
    const claim = f.claim(ready); await entered.promise;
    const automatic = f.coordinator.auto(ready.id, f.subject.adminId); void automatic.catch(() => undefined);
    await pause(5); gate.open(); await claim;
    await assert.rejects(automatic, /STATE_CHANGED/); assert.equal((await f.row()).state, 'human_active');
    assert.equal(f.counts().gestures, 0);
  } finally { gate.open(); await f.coordinator.close(); }
});

test('disconnect keeps the 3s reconnect grace and resume never extends 30s deadline', async () => {
  const f = fixture();
  try {
    const { ready } = await f.prepare(); const claimed = await f.claim(ready);
    f.coordinator.disconnect('client'); await pause();
    assert.equal((await f.row()).state, 'human_active');
    f.advance(2_999); f.coordinator.presence(f.subject.adminId, 'client', true);
    await f.coordinator.presentation(ready.id, f.subject.adminId, 'client');
    const resumed = await f.coordinator.claim(ready.id, { adminId: f.subject.adminId, authSessionId: 'auth', clientId: 'client', connectionId: 'new-connection', version: (await f.row()).version, frameId: f.frame.frameId, resume: true });
    assert.equal(resumed.humanDeadline, claimed.humanDeadline); assert.equal(resumed.reconnectDeadline, undefined);
  } finally { await f.coordinator.close(); }
});

test('overlapping disconnect and release share the full drain barrier', async () => {
  const f = fixture({ auto: true }); const drain = latch(); let releasing = false;
  f.challenge.browser.release = async () => { releasing = true; await drain.promise; };
  try {
    const { ready } = await f.prepare(); await f.claim(ready); f.coordinator.disconnect('client');
    const release = f.coordinator.release(ready.id, f.subject.adminId, 'client'); let returned = false; void release.then(() => { returned = true; }, () => undefined);
    await pause(5); assert.ok(releasing); assert.equal(returned, false); assert.equal(f.counts().gestures, 0);
    drain.open(); await release; assert.equal((await f.row()).state, 'settling');
  } finally { drain.open(); await f.coordinator.close(); }
});

test('late save cannot renew expired owner before watchdog runs', async () => {
  const f = fixture(); const gate = latch(), entered = latch();
  try {
    const { ready, task } = await f.prepare(); const save = f.repo.save.bind(f.repo);
    f.repo.save = async (next, version) => { if (next.state === 'human_active') { entered.open(); await gate.promise; } return save(next, version); };
    const claim = f.claim(ready); await entered.promise; f.advance(7_000); gate.open();
    await assert.rejects(claim, /OWNER_LOST/);
    await assert.rejects(task, /OWNER_LOST/);
    assert.equal((await until(f.row, row => row.state === 'cancelled')).failureCode, 'VERIFICATION_OWNER_LOST');
    await assert.rejects(f.coordinator.pointer(ready.id, { adminId: f.subject.adminId, authSessionId: 'auth', clientId: 'client', connectionId: 'connection', epoch: 1 }, { type: 'down', x: 0.1, y: 0.5, sequence: 1, frameId: f.frame.frameId, streamEpoch: 1, geometryRevision: 1 }, async () => true), /denied|NOT_ACTIVE/);
    assert.equal(f.counts().gestures, 0); assert.ok(f.counts().closed >= 1);
  } finally { gate.open(); await f.coordinator.close(); }
});

test('automatic pending response is settled before giving a human another turn', async () => {
  const f = fixture(); const endAuto = latch(), started = latch();
  f.challenge.autoAttempt = async (admit, before) => { await before(); await admit(); started.open(); await endAuto.promise; return { success: false }; };
  try {
    const { task, ready } = await f.prepare(); await f.coordinator.auto(ready.id, f.subject.adminId); await started.promise;
    f.pending(1); await f.coordinator.requestHuman(ready.id, f.subject.adminId); endAuto.open();
    await until(f.row, row => row.state === 'settling'); f.advance(600); await pause();
    assert.equal((await f.row()).state, 'settling'); await assert.rejects(f.claim(await f.row()), /AUTO_STARTED/);
    f.pending(0); f.answer(); await task; assert.equal((await f.row()).state, 'handoff');
  } finally { endAuto.open(); await f.coordinator.close(); }
});

test('retry authorizes both active mutation and future intent', async () => {
  let allowed = true; const f = fixture({ authorize: async () => allowed });
  try {
    const { ready } = await f.prepare(); allowed = false;
    await assert.rejects(f.coordinator.retry(f.subject), /FORBIDDEN/); assert.equal((await f.row()).mode, 'manual_then_auto');
    await assert.rejects(f.coordinator.retry({ ...f.subject, accountId: 'another' }), /FORBIDDEN/);
    allowed = true; void ready;
  } finally { allowed = true; await f.coordinator.close(); }
});


test('a second settling round cannot reuse the first release timestamp', async () => {
  const f = fixture({ drain: 1_000 }); const endAuto = latch(), started = latch(), drain = latch(); let attempts = 0;
  f.challenge.autoAttempt = async (admit, before) => { await before(); await admit(); attempts++; started.open(); await endAuto.promise; return { success: false }; };
  try {
    const { ready } = await f.prepare(); await f.coordinator.auto(ready.id, f.subject.adminId); await started.promise;
    await f.coordinator.requestHuman(ready.id, f.subject.adminId); endAuto.open();
    await until(f.row, row => row.state === 'settling'); f.advance(501);
    await until(f.row, row => row.state === 'preparing');
    f.coordinator.presence(f.subject.adminId, 'client', true);
    await f.coordinator.presentation(ready.id, f.subject.adminId, 'client'); await f.coordinator.frame(ready.id, f.subject.adminId, 'client');
    const presented = await f.coordinator.presentation(ready.id, f.subject.adminId, 'client', f.frame.frameId); await f.claim(presented);
    f.challenge.browser.release = async () => drain.promise;
    const release = f.coordinator.release(ready.id, f.subject.adminId, 'client');
    await until(f.row, row => row.state === 'settling'); f.advance(501); await pause(100);
    assert.equal(attempts, 1, 'second auto must wait for its own release barrier');
    drain.open(); await release;
  } finally { drain.open(); endAuto.open(); await f.coordinator.close(); }
});

test('manual-only intent committed ahead of queued automatic transition prevents dispatch', async () => {
  const f = fixture(); const gate = latch(), entered = latch();
  try {
    const { task, ready } = await f.prepare();
    f.advance(4_900); f.coordinator.presence(f.subject.adminId, 'client', true); await f.coordinator.presentation(ready.id, f.subject.adminId, 'client');
    const save = f.repo.save.bind(f.repo);
    f.repo.save = async (next, version) => { if (next.mode === 'manual_only' && next.state === 'priority_wait') { entered.open(); await gate.promise; } return save(next, version); };
    const intent = f.coordinator.retry(f.subject, 'manual_only'); await entered.promise;
    f.advance(100); await pause(60); gate.open(); await intent;
    await assert.rejects(task, /WAITING_FOR_HUMAN/); assert.equal(f.counts().gestures, 0);
  } finally { gate.open(); await f.coordinator.close(); }
});

test('database failure during release terminates solve and closes context without relying on close()', async () => {
  const f = fixture();
  try {
    const { ready, task } = await f.prepare(); await f.claim(ready);
    f.repo.save = async () => { throw new Error('DB_UNAVAILABLE'); };
    await assert.rejects(f.coordinator.release(ready.id, f.subject.adminId, 'client'), /DB_UNAVAILABLE/);
    await assert.rejects(task, /RELEASE_TIMEOUT/);
    assert.equal(f.counts().closed, 1); assert.equal(f.counts().gestures, 0);
    await assert.rejects(f.coordinator.frame(ready.id, f.subject.adminId, 'client'), /NOT_ACTIVE/);
  } finally { await f.coordinator.close(); }
});

test('failed solve releases callers but retains subject and browser capacity until context closure is confirmed', async () => {
  const f = fixture(); const close = latch();
  f.challenge.closeContext = async () => close.promise;
  try {
    const { task, ready } = await f.prepare(); await f.claim(ready);
    await f.coordinator.cancelSubject(f.subject.accountId!); await assert.rejects(task, /CANCELLED/);
    await assert.rejects(f.coordinator.solve(f.challenge), /CLOSING/);
    f.advance(600); await pause(); assert.equal(f.counts().gestures, 0);
    close.open(); await pause(5);
  } finally { close.open(); await f.coordinator.close(); }
});

test('simultaneous starts reserve capacity before async authorization and failures return it', async () => {
  const auth = latch(); let allowed = true;
  const f = fixture({ authorize: async () => { await auth.promise; return allowed; } });
  try {
    const subjects = Array.from({ length: 3 }, () => ({ ...f.subject, accountId: randomUUID() }));
    const starts = subjects.map(subject => f.coordinator.solve({ ...f.challenge, subject })); starts.forEach(p => { void p.catch(() => undefined); });
    await assert.rejects(starts[2], /BUSY/); assert.equal((await f.repo.list()).length, 0);
    allowed = false; auth.open(); await Promise.all(starts.slice(0, 2).map(task => assert.rejects(task, /FORBIDDEN/)));
    allowed = true; const task = f.start(); await until(f.row, Boolean);
    await f.coordinator.cancelSubject(f.subject.accountId!); await assert.rejects(task, /CANCELLED/);
  } finally { auth.open(); await f.coordinator.close(); }
});
