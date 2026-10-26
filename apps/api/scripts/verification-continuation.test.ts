import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { VerificationCoordinator } from '../src/verification-coordinator.js';
import { MemoryVerificationRepository } from '../src/verification-repository.js';
import type { VerificationChallenge } from '../src/verification-domain.js';

async function until(read: () => Promise<any>, predicate: (value: any) => boolean) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('state timeout');
}
test('second native challenge retains session, consumed priority and combined automatic gesture budget', async () => {
  let now = 100_000; const repository = new MemoryVerificationRepository();
  const coordinator = new VerificationCoordinator(repository, { authorize: async () => true, health: async () => 'pending' }, { now: () => now, monotonic: () => now });
  const subject = { adminId: randomUUID(), accountId: randomUUID(), credentialGeneration: 2 };
  let dispatched = 0;
  const challenge = (gestures: number): VerificationChallenge => {
    let verdict: any; const frame = { frameId: randomUUID(), streamEpoch: 1, geometryRevision: 1, capturedAt: now, width: 300, height: 50, image: Buffer.from('fixture') };
    return { subject, browser: { capture: async () => frame, canSend: async () => true, pointer: async () => undefined, invalidate: () => undefined, close: async () => undefined, release: async () => undefined },
      closeContext: async () => undefined, verdict: () => verdict, pendingAnswers: () => 0,
      autoAttempt: async (admit, before) => { for (let i = 0; i < gestures; i++) { await before(); await admit(); dispatched++; } verdict = { sequence: 1, code: 0, success: true }; return { success: true }; } };
  };
  const present = async (id: string) => {
    coordinator.presence(subject.adminId, 'fixture-client', true);
    await coordinator.presentation(id, subject.adminId, 'fixture-client');
    const frame = await coordinator.frame(id, subject.adminId, 'fixture-client');
    return coordinator.presentation(id, subject.adminId, 'fixture-client', frame!.frameId);
  };
  try {
    const task = coordinator.solve(challenge(2));
    const first = await until(async () => (await repository.list())[0], Boolean);
    await present(first.id); await coordinator.auto(first.id, subject.adminId); await task;
    const handed = await repository.get(first.id); assert.equal(handed!.autoAttempts, 2); assert.equal(handed!.priorityConsumed, true);
    now += 1000;
    const continuation = coordinator.continueChallenge(first.id, challenge(2)); void continuation.catch(() => undefined);
    await until(() => repository.get(first.id), row => row.challengeGeneration === 2);
    const ready = await present(first.id);
    assert.equal(ready.id, first.id); assert.equal(ready.expiresAt, handed!.expiresAt); assert.equal(ready.createdAt, handed!.createdAt);
    assert.equal(ready.priorityDeadline, now, 'a second challenge does not receive a second five-second window');
    await assert.rejects(continuation, /BUDGET_EXHAUSTED/);
    const final = await repository.get(first.id);
    assert.equal(final!.autoAttempts, 3); assert.equal(dispatched, 3, 'the fourth gesture is denied across challenge generations');
    assert.equal((await repository.list()).length, 1);
  } finally { await coordinator.close(); }
});

test('a third native challenge is rejected and closes the original context', async () => {
  const repository = new MemoryVerificationRepository();
  const coordinator = new VerificationCoordinator(repository, { authorize: async () => true, health: async () => 'pending' });
  let sequence = 0; let closes = 0; const subject = { adminId: randomUUID(), accountId: randomUUID() };
  const challenge: VerificationChallenge = { subject, browser: { capture: async () => undefined, canSend: async () => false, pointer: async () => undefined,
    invalidate: () => undefined, close: async () => undefined, release: async () => undefined }, closeContext: async () => { closes++; },
    verdict: () => sequence ? { sequence, code: 0, success: true } : undefined, pendingAnswers: () => 0,
    autoAttempt: async (_admit, before) => { await before(); sequence++; return { success: true }; } };
  try {
    const firstTask = coordinator.solve(challenge); const first = await until(async () => (await repository.list())[0], Boolean);
    await coordinator.auto(first.id, subject.adminId); await firstTask;
    const secondTask = coordinator.continueChallenge(first.id, challenge); await until(() => repository.get(first.id), row => row.challengeGeneration === 2);
    await coordinator.auto(first.id, subject.adminId); await secondTask;
    await assert.rejects(coordinator.continueChallenge(first.id, challenge), /CHALLENGE_LIMIT/);
    await until(async () => closes, count => count > 0);
    assert.equal((await repository.get(first.id))!.state, 'failed');
  } finally { await coordinator.close(); }
});
