import { describe, expect, it } from 'vitest';
import { countdown, failureLabel, mergeSession, normalizedPoint, pendingVerificationSelection, projectVerificationSelection,
  sameVerificationSubject, stateLabel, terminal } from './model';
import { session } from './test-fixtures';
describe('verification state projection', () => {
  it('does not regress on duplicate and out-of-order session events; other accounts retain order', () => {
    const rows = [session({ version: 3, eventSequence: 3 }), session({ id: 'other', createdAt: 200 })];
    expect(mergeSession(rows, session({ version: 2, eventSequence: 2 }))).toBe(rows);
    const next = mergeSession(rows, session({ state: 'human_active', version: 4, eventSequence: 4 }));
    expect(next.map(row => row.id)).toEqual(['session', 'other']); expect(next[0].state).toBe('human_active');
  });
  it('uses independent server deadlines for the 5s priority and fixed 30s control window', () => {
    expect(countdown(session({ state: 'priority_wait', priorityDeadline: 5_100 }), 100)).toBe(5);
    expect(countdown(session({ state: 'human_active', humanDeadline: 30_100, priorityDeadline: 5_100 }), 100)).toBe(30);
    expect(countdown(session({ state: 'human_active', humanDeadline: 30_100 }), 30_101)).toBe(0);
    expect(countdown(session({ state: 'settling', humanDeadline: 30_100 }), 30_101)).toBe(0);
  });
  it('maps actual image bounds under scaling, clamps captured pointers and rejects empty geometry', () => {
    expect(normalizedPoint({ left: 10, top: 20, width: 150, height: 30 }, 85, 35)).toEqual({ x: 0.5, y: 0.5 });
    expect(normalizedPoint({ left: 10, top: 20, width: 150, height: 30 }, 200, -1)).toEqual({ x: 1, y: 0 });
    expect(normalizedPoint({ left: 0, top: 0, width: 0, height: 30 }, 0, 0)).toBeUndefined();
  });
  it('keeps accepted CAPTCHA distinct from recovered account and leaves unknown outcomes stopped', () => {
    expect(terminal(session({ state: 'handoff' }))).toBe(false);
    expect(stateLabel('handoff')).toContain('验证码已通过'); expect(stateLabel('handoff')).not.toContain('账号已连接');
    expect(terminal(session({ state: 'completed_partial' }))).toBe(true);
    expect(failureLabel('VERIFICATION_OUTCOME_UNKNOWN')).toContain('已停止');
    expect(failureLabel('VERIFICATION_WAITING_FOR_HUMAN')).toContain('未运行自动操作');
  });
});

describe('explicit verification retry selection', () => {
  const a = session({ id: 'session-a', subject: { accountId: 'account-a' } });
  const b = session({ id: 'session-b', subject: { accountId: 'account-b' }, createdAt: 200 });

  it('selects the requested account when its session arrives after a pending reply, while another account remains active', () => {
    const oldB = session({ id: 'old-b', subject: b.subject, state: 'failed' });
    const pending = pendingVerificationSelection([a, oldB], b.subject);
    const waiting = projectVerificationSelection([a, oldB], a.id, 'this-page', pending);
    expect(waiting.selected).toBe(a.id); expect(waiting.pending).toBe(pending);
    const arrived = projectVerificationSelection([a, oldB, b], waiting.selected, 'this-page', waiting.pending);
    expect(arrived.selected).toBe(b.id); expect(arrived.pending).toBeUndefined();
  });

  it('also selects a retry discovered through the reconnect snapshot and exposes an immediately failed new session', () => {
    const pending = pendingVerificationSelection([a], b.subject);
    expect(projectVerificationSelection([a, b], a.id, 'this-page', pending).selected).toBe(b.id);
    const failed = projectVerificationSelection([a, { ...b, state: 'failed' }], a.id, 'this-page', pending);
    expect(failed.selected).toBe(b.id); expect(failed.pending).toBeUndefined();
  });

  it.each(['failed', 'expired', 'cancelled'] as const)('keeps an explicitly requested %s result through unrelated updates and snapshots', state => {
    const failedB = { ...b, state };
    const pending = pendingVerificationSelection([a], b.subject);
    const arrived = projectVerificationSelection([a, failedB], a.id, 'this-page', pending);
    const unrelatedUpdate = projectVerificationSelection(mergeSession([a, failedB], { ...a, eventSequence: 2 }), arrived.selected, 'this-page', arrived.pending, arrived.retainedSelection);
    const snapshot = projectVerificationSelection([a, failedB], unrelatedUpdate.selected, 'this-page', unrelatedUpdate.pending, unrelatedUpdate.retainedSelection);
    expect(unrelatedUpdate.selected).toBe(b.id); expect(snapshot.selected).toBe(b.id);
    const humanA = { ...a, state: 'human_active' as const, controller: { clientId: 'this-page' } };
    expect(projectVerificationSelection([humanA, failedB], snapshot.selected, 'this-page', undefined, snapshot.retainedSelection).selected).toBe(a.id);
    const switched = projectVerificationSelection([a, failedB], a.id, 'this-page');
    expect(switched.selected).toBe(a.id);
  });

  it('keeps this page on its active human controller and applies the pending target after safe handoff', () => {
    const humanA = { ...a, state: 'human_active' as const, controller: { clientId: 'this-page' } };
    const pending = pendingVerificationSelection([a], b.subject);
    const blocked = projectVerificationSelection([humanA, b], b.id, 'this-page', pending);
    expect(blocked.selected).toBe(a.id); expect(blocked.pending).toBe(pending);
    const released = projectVerificationSelection([{ ...humanA, state: 'settling' }, b], blocked.selected, 'this-page', blocked.pending);
    expect(released.selected).toBe(b.id); expect(released.pending).toBeUndefined();
    expect(projectVerificationSelection([{ ...humanA, controller: { clientId: 'other-page' } }, b], a.id, 'this-page', pending).selected).toBe(b.id);
  });

  it('consumes a session arriving before the HTTP reply once and keeps it selected during unrelated updates', () => {
    const pending = pendingVerificationSelection([a], b.subject);
    const arrived = projectVerificationSelection(mergeSession([a], b), a.id, 'this-page', pending);
    const reply = projectVerificationSelection([a, b], arrived.selected, 'this-page', arrived.pending);
    const unrelated = session({ id: 'session-c', subject: { accountId: 'account-c' }, createdAt: 300 });
    const after = projectVerificationSelection([a, b, unrelated], reply.selected, 'this-page', reply.pending);
    expect(arrived.selected).toBe(b.id); expect(after.selected).toBe(b.id); expect(after.pending).toBeUndefined();
  });

  it('honors the latest retry target and never confuses account and temporary login subjects', () => {
    const login = session({ id: 'login-session', subject: { loginSessionId: 'account-b' } });
    expect(sameVerificationSubject(login.subject, b.subject)).toBe(false);
    const pending = pendingVerificationSelection([a], login.subject);
    const irrelevant = projectVerificationSelection([a, b], a.id, 'this-page', pending);
    expect(irrelevant.selected).toBe(a.id); expect(irrelevant.pending).toBe(pending);
    const requested = projectVerificationSelection([a, b, login], a.id, 'this-page', pending);
    expect(requested.selected).toBe(login.id); expect(requested.pending).toBeUndefined();
  });

  it('does not let an earlier retry response steal selection from a later explicit retry', () => {
    const c = session({ id: 'session-c', subject: { accountId: 'account-c' }, createdAt: 300 });
    const latest = pendingVerificationSelection([a], c.subject);
    const earlyReply = projectVerificationSelection([a, b], a.id, 'this-page', latest);
    expect(earlyReply.selected).toBe(a.id); expect(earlyReply.pending).toBe(latest);
    const requested = projectVerificationSelection([a, b, c], earlyReply.selected, 'this-page', earlyReply.pending);
    expect(requested.selected).toBe(c.id); expect(requested.pending).toBeUndefined();
    expect(projectVerificationSelection([a, b, c], requested.selected, 'this-page', requested.pending).selected).toBe(c.id);
  });
});
