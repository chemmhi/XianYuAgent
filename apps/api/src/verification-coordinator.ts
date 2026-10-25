import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { VerificationError, VERIFICATION_TERMINAL, VERIFICATION_TIMING as T, verificationSubjectKey, verificationBuckets,
  type VerificationSession, type VerificationSubject, type VerificationChallenge, type VerificationMode } from './verification-domain.js';
import type { VerificationRepository } from './verification-repository.js';
import type { VerificationFrame, VerificationPointer } from './verification-remote-browser.js';

interface Active {
  row: VerificationSession; challenge: VerificationChallenge; tail: Promise<unknown>; result: Promise<void>;
  resolve(): void; reject(error: Error): void; leaseAt: number; persistedAt: number; tickBusy: boolean;
  stopping: boolean; autoRunning: boolean; budgetReserved: boolean; verdictStart: number; settlingAt?: number;
  lastPendingAt: number; frames: Map<string, { frame: VerificationFrame; clientId: string }>; releaseTask?: Promise<void>;
  suspended?: boolean; settleGoal?: 'auto' | 'human' | 'stop';
  recheckingAt?: number;
  contextCloseTask?: Promise<void>;
}
export interface VerificationAccess {
  authorize(subject: VerificationSubject, adminId: string): Promise<boolean>;
  health(subject: VerificationSubject): Promise<'ready' | 'partial' | 'pending' | 'cancelled'>;
}
export class VerificationCoordinator {
  readonly events = new EventEmitter();
  readonly ownerId = randomUUID();
  private active = new Map<string, Active>();
  private closingSubjects = new Map<string, Promise<void>>();
  private pendingStarts = new Set<string>();
  private viewers = new Map<string, { adminId: string; visible: boolean; at: number }>();
  private intents = new Map<string, VerificationMode>();
  private timer?: ReturnType<typeof setInterval>;
  private watchdog?: ReturnType<typeof setInterval>;
  private started = false;
  private startTask?: Promise<void>;
  constructor(readonly repository: VerificationRepository, private readonly access: VerificationAccess,
    private readonly clock = { now: () => Date.now(), monotonic: () => performance.now() }, private readonly timing = T) {}

  async start(): Promise<void> {
    return this.startTask ??= this.startInternal();
  }
  private async startInternal(): Promise<void> {
    if (this.started) return;
    await this.repository.abandonOtherOwners(this.ownerId); this.started = true;
    this.timer = setInterval(() => { for (const rt of this.active.values()) void this.tick(rt); }, 50);
    this.timer.unref();
    this.watchdog = setInterval(() => {
      for (const rt of this.active.values()) if (!rt.stopping && this.clock.monotonic() - rt.leaseAt >= this.timing.ownerLease) {
        this.loseOwner(rt);
      }
    }, 100); this.watchdog.unref();
  }
  presence(adminId: string, clientId: string, visible: boolean) { this.viewers.set(clientId, { adminId, visible, at: this.clock.now() }); }
  disconnect(clientId: string) {
    this.viewers.delete(clientId);
    for (const rt of this.active.values()) if (rt.row.controller?.clientId === clientId && rt.row.state === 'human_active') {
      rt.suspended = true;
      const deadline = Math.min(this.clock.now() + this.timing.reconnect, rt.row.humanDeadline!);
      void this.change(rt, next => {
        if (next.state !== 'human_active' || next.controller?.clientId !== clientId) return;
        next.reconnectDeadline ??= deadline;
      }).catch(() => undefined);
      void this.releaseBounded(rt).catch(() => undefined);
    }
  }
  private async change(rt: Active, update: (next: VerificationSession) => void): Promise<VerificationSession> {
    const task = rt.tail.then(async () => {
      const next = structuredClone(rt.row); update(next); next.updatedAt = this.clock.now();
      if (rt.stopping && !VERIFICATION_TERMINAL.has(next.state)) throw new VerificationError('VERIFICATION_CONTROL_EXPIRED');
      const saved = await this.repository.save(next, rt.row.version); rt.row = saved;
      if (!VERIFICATION_TERMINAL.has(saved.state) && (rt.stopping || this.clock.monotonic() - rt.leaseAt >= this.timing.ownerLease)) {
        this.loseOwner(rt);
        throw new VerificationError('VERIFICATION_OWNER_LOST');
      }
      rt.leaseAt = this.clock.monotonic(); rt.persistedAt = this.clock.now(); this.events.emit('updated', structuredClone(saved));
      return saved;
    });
    rt.tail = task.catch(() => undefined); return task;
  }
  private assertLease(rt: Active) {
    if (rt.stopping || this.clock.monotonic() - rt.leaseAt >= this.timing.ownerLease
      || this.clock.now() >= rt.row.expiresAt) throw new VerificationError('VERIFICATION_CONTROL_EXPIRED');
  }
  private loseOwner(rt: Active) {
    rt.stopping = true; rt.challenge.browser.invalidate();
    rt.reject(new VerificationError('VERIFICATION_OWNER_LOST'));
    void this.closeContext(rt).catch(() => undefined);
    // Queue after the current actor commit; do not await our own tail.
    void this.fail(rt, 'VERIFICATION_OWNER_LOST', 'cancelled').catch(() => { this.active.delete(rt.row.id); });
  }
  private closeContext(rt: Active) {
    if (rt.contextCloseTask) return rt.contextCloseTask;
    const key = verificationSubjectKey(rt.row.subject);
    const task = Promise.resolve().then(() => rt.challenge.closeContext());
    rt.contextCloseTask = task; this.closingSubjects.set(key, task);
    void task.then(() => { if (this.closingSubjects.get(key) === task) this.closingSubjects.delete(key); }, () => undefined);
    return task;
  }
  private available(adminId: string) { return [...this.viewers.values()].some(v => v.adminId === adminId && v.visible && this.clock.now() - v.at < 6_000); }
  private async authorize(rt: Active, adminId: string) {
    if (!await this.access.authorize(rt.row.subject, adminId)) throw new VerificationError('VERIFICATION_FORBIDDEN', 403);
  }
  private get(id: string) { const rt = this.active.get(id); if (!rt) throw new VerificationError('VERIFICATION_NOT_ACTIVE', 410); return rt; }

  async solve(challenge: VerificationChallenge): Promise<string> {
    await this.start();
    const key = verificationSubjectKey(challenge.subject);
    if (this.closingSubjects.has(key)) throw new VerificationError('VERIFICATION_CLOSING');
    if (this.pendingStarts.has(key)) throw new VerificationError('VERIFICATION_ALREADY_ACTIVE');
    if ([...this.active.values()].some(rt => verificationSubjectKey(rt.row.subject) === key && !VERIFICATION_TERMINAL.has(rt.row.state))) throw new VerificationError('VERIFICATION_ALREADY_ACTIVE');
    if (this.active.size + this.closingSubjects.size + this.pendingStarts.size >= 2) throw new VerificationError('VERIFICATION_BUSY', 429);
    this.pendingStarts.add(key);
    let runtime: Active;
    try {
    if (!await this.access.authorize(challenge.subject, challenge.subject.adminId)) throw new VerificationError('VERIFICATION_FORBIDDEN', 403);
    const now = this.clock.now();
    const row = await this.repository.create({ id: randomUUID(), subject: challenge.subject, ownerId: this.ownerId,
      state: 'preparing', mode: this.intents.get(key) ?? 'manual_then_auto', version: 1, eventSequence: 0,
      createdAt: now, updatedAt: now, readyAt: now, expiresAt: Math.min(now + this.timing.total, challenge.subject.expiresAt ?? Infinity),
      setupDeadline: now + this.timing.setup, discoveryDeadline: now + this.timing.discovery,
      priorityConsumed: false, controlEpoch: 0, autoAttempts: 0, challengeGeneration: 1 });
    this.intents.delete(key);
    let resolve!: () => void, reject!: (error: Error) => void;
    const result = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const rt: Active = { row, challenge, tail: Promise.resolve(), result, resolve, reject,
      leaseAt: this.clock.monotonic(), persistedAt: now, tickBusy: false, stopping: false, autoRunning: false,
      budgetReserved: false, verdictStart: challenge.verdict()?.sequence ?? 0, lastPendingAt: now, frames: new Map() };
    this.active.set(row.id, rt); this.events.emit('updated', structuredClone(row));
    runtime = rt;
    } finally { this.pendingStarts.delete(key); }
    await runtime.result; return runtime.row.id;
  }

  async list(adminId: string) {
    const rows = await this.repository.list(); const result: VerificationSession[] = [];
    for (const row of rows) if (await this.access.authorize(row.subject, adminId)) result.push(row);
    return result;
  }
  async snapshot(id: string, adminId: string) {
    const row = await this.repository.get(id);
    if (!row || !await this.access.authorize(row.subject, adminId)) throw new VerificationError('VERIFICATION_NOT_FOUND', 404);
    return row;
  }
  async presentation(id: string, adminId: string, clientId: string, frameId?: string) {
    const rt = this.get(id); await this.authorize(rt, adminId);
    const viewer = this.viewers.get(clientId);
    if (viewer?.adminId !== adminId || !viewer.visible || this.clock.now() - viewer.at >= 6_000) throw new VerificationError('VERIFICATION_NOT_VISIBLE');
    if (rt.row.controller && rt.row.controller.clientId !== clientId) throw new VerificationError('VERIFICATION_CONTROL_BUSY');
    if (rt.row.presentation && rt.row.presentation.clientId !== clientId && rt.row.presentation.until > this.clock.now()) throw new VerificationError('VERIFICATION_PRESENTATION_BUSY');
    if (frameId) {
      const sent = rt.frames.get(frameId);
      if (!sent || sent.clientId !== clientId || !await rt.challenge.browser.canSend(sent.frame)) throw new VerificationError('VERIFICATION_FRAME_STALE');
    }
    return this.change(rt, next => {
      if (VERIFICATION_TERMINAL.has(next.state)) throw new VerificationError('VERIFICATION_NOT_ACTIVE', 410);
      if (next.controller && next.controller.clientId !== clientId) throw new VerificationError('VERIFICATION_CONTROL_BUSY');
      if (next.presentation && next.presentation.clientId !== clientId && next.presentation.until > this.clock.now()) throw new VerificationError('VERIFICATION_PRESENTATION_BUSY');
      next.presentation = { adminId, clientId, until: this.clock.now() + this.timing.presentation };
      if (frameId && next.state === 'preparing') {
        if (this.clock.now() >= next.setupDeadline) throw new VerificationError('VERIFICATION_PRESENTATION_EXPIRED');
        next.state = 'priority_wait'; next.priorityConsumed = true;
        next.priorityDeadline = Math.min(this.clock.now() + (next.mode === 'manual_only' ? this.timing.setup : this.timing.priority), next.expiresAt);
      }
    });
  }
  async frame(id: string, adminId: string, clientId: string) {
    const rt = this.get(id); await this.authorize(rt, adminId); this.assertLease(rt);
    if (rt.row.presentation?.clientId !== clientId || rt.row.presentation.until <= this.clock.now()
      || !['preparing', 'priority_wait', 'human_active', 'auto_active'].includes(rt.row.state)) return;
    const frame = await rt.challenge.browser.capture();
    if (!frame || !await rt.challenge.browser.canSend(frame)) return;
    await this.authorize(rt, adminId); this.assertLease(rt);
    if (rt.row.presentation?.clientId !== clientId || !await rt.challenge.browser.canSend(frame)) return;
    rt.frames.set(frame.frameId, { frame, clientId });
    for (const [key, value] of rt.frames) if (this.clock.now() - value.frame.capturedAt > 2_000) rt.frames.delete(key);
    return frame;
  }
  async claim(id: string, input: { adminId: string; authSessionId: string; clientId: string; connectionId: string; version: number; frameId: string; resume?: boolean }) {
    const rt = this.get(id); await this.authorize(rt, input.adminId); this.assertLease(rt);
    const sent = rt.frames.get(input.frameId);
    if (sent?.clientId !== input.clientId || !await rt.challenge.browser.canSend(sent.frame)) throw new VerificationError('VERIFICATION_FRAME_STALE');
    const saved = await this.change(rt, next => {
      if (next.presentation?.clientId !== input.clientId || next.presentation.until <= this.clock.now()) throw new VerificationError('VERIFICATION_PRESENTATION_EXPIRED');
      if (input.resume && next.state === 'human_active' && next.controller?.clientId === input.clientId
        && next.controller.authSessionId === input.authSessionId && (next.reconnectDeadline ?? Infinity) > this.clock.now()) {
        next.reconnectDeadline = undefined;
      } else {
        if (next.version !== input.version) throw new VerificationError('VERIFICATION_VERSION_CHANGED');
        if (next.state !== 'priority_wait' || this.clock.now() >= next.priorityDeadline!) throw new VerificationError('VERIFICATION_AUTO_STARTED');
        next.humanDeadline = Math.min(this.clock.now() + this.timing.human, next.expiresAt); next.state = 'human_active';
      }
      next.controlEpoch++; next.controller = { adminId: input.adminId, authSessionId: input.authSessionId, clientId: input.clientId, connectionId: input.connectionId };
    });
    rt.suspended = false; return saved;
  }
  async pointer(id: string, control: { adminId: string; authSessionId: string; clientId: string; connectionId: string; epoch: number }, input: VerificationPointer, externalAccess: () => Promise<boolean>) {
    const rt = this.get(id);
    await rt.challenge.browser.pointer(input, async () => {
      if (!await externalAccess()) return false;
      await this.authorize(rt, control.adminId);
      try { this.assertLease(rt); } catch { return false; }
      const row = rt.row;
      return row.state === 'human_active' && !rt.suspended && !row.reconnectDeadline && row.controlEpoch === control.epoch
        && row.controller?.authSessionId === control.authSessionId && row.controller.clientId === control.clientId
        && row.controller.connectionId === control.connectionId && this.clock.now() < row.humanDeadline!;
    });
  }
  private async releaseBounded(rt: Active) {
    if (rt.releaseTask) return rt.releaseTask;
    const task = (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([rt.challenge.browser.release(), new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new VerificationError('VERIFICATION_RELEASE_TIMEOUT')), this.timing.drain);
        })]);
      } catch (error) {
        rt.stopping = true; await this.closeContext(rt); throw error;
      } finally { if (timeout) clearTimeout(timeout); }
    })();
    rt.releaseTask = task;
    await task;
    if (rt.releaseTask === task) rt.releaseTask = undefined;
  }
  async release(id: string, adminId: string, clientId: string, toAuto = true) {
    const rt = this.get(id); await this.authorize(rt, adminId);
    if (rt.row.controller?.clientId !== clientId || rt.row.state !== 'human_active') throw new VerificationError('VERIFICATION_CONTROL_BUSY');
    try { await this.beginSettling(rt, toAuto); }
    catch (error) {
      if (!(error instanceof VerificationError && error.code === 'VERIFICATION_STATE_CHANGED')) await this.fail(rt, 'VERIFICATION_RELEASE_TIMEOUT');
      throw error;
    }
    return rt.row;
  }
  async auto(id: string, adminId: string) {
    const rt = this.get(id); await this.authorize(rt, adminId);
    if (rt.row.state !== 'priority_wait' && rt.row.state !== 'preparing') throw new VerificationError('VERIFICATION_STATE_CHANGED');
    await this.change(rt, next => {
      if (!['preparing', 'priority_wait'].includes(next.state)) throw new VerificationError('VERIFICATION_STATE_CHANGED');
      next.mode = 'manual_then_auto'; next.priorityDeadline = this.clock.now(); next.state = 'priority_wait';
    });
    return rt.row;
  }
  async requestHuman(id: string, adminId: string) {
    const rt = this.get(id); await this.authorize(rt, adminId);
    await this.change(rt, next => { next.humanRequested = true; }); return rt.row;
  }
  async retry(subject: VerificationSubject, mode: VerificationMode = 'manual_only') {
    if (!await this.access.authorize(subject, subject.adminId)) throw new VerificationError('VERIFICATION_FORBIDDEN', 403);
    const key = verificationSubjectKey(subject);
    const active = [...this.active.values()].find(rt => verificationSubjectKey(rt.row.subject) === key && !VERIFICATION_TERMINAL.has(rt.row.state));
    if (active) {
      if (active.row.state === 'auto_active') return this.requestHuman(active.row.id, subject.adminId);
      if (['preparing', 'priority_wait'].includes(active.row.state)) await this.change(active, next => { next.mode = mode; });
      return active.row;
    }
    this.intents.set(key, mode); return undefined;
  }
  private accepted(rt: Active) { const v = rt.challenge.verdict(); return v && v.sequence > rt.verdictStart && v.code === 0 && v.success === true; }
  private async beginSettling(rt: Active, toAuto = false, goal: 'auto' | 'human' | 'stop' = 'auto') {
    rt.suspended = true;
    rt.settlingAt = undefined;
    await this.change(rt, next => {
      if (!['human_active', 'auto_active', 'settling'].includes(next.state)) throw new VerificationError('VERIFICATION_STATE_CHANGED');
      next.state = 'settling'; next.controlEpoch++; next.controller = undefined; next.reconnectDeadline = undefined;
      if (toAuto) next.mode = 'manual_then_auto';
    });
    rt.settleGoal = goal;
    await this.releaseBounded(rt); rt.settlingAt = this.clock.now(); rt.lastPendingAt = this.clock.now();
  }
  private async startAuto(rt: Active) {
    if (rt.autoRunning || rt.stopping) return;
    if (rt.row.state === 'settling' && (rt.releaseTask || rt.settlingAt === undefined)) return;
    if (rt.row.mode === 'manual_only') { await this.fail(rt, 'VERIFICATION_WAITING_FOR_HUMAN'); return; }
    rt.autoRunning = true;
    try {
      this.assertLease(rt);
      await this.change(rt, next => {
        if (!['preparing', 'priority_wait', 'settling'].includes(next.state)) throw new VerificationError('VERIFICATION_STATE_CHANGED');
        if (next.mode === 'manual_only') throw new VerificationError('VERIFICATION_WAITING_FOR_HUMAN');
        next.state = 'auto_active'; next.controller = undefined; next.controlEpoch++;
      });
      if (!rt.budgetReserved) {
        if (!await this.repository.reserve(verificationBuckets(rt.row.subject), rt.row.id, randomUUID(), 'session', this.clock.now())) throw new VerificationError('VERIFICATION_AUTO_BUDGET_EXHAUSTED', 429);
        rt.budgetReserved = true;
      }
      const admit = async () => {
        await this.authorize(rt, rt.row.subject.adminId); this.assertLease(rt);
        if (this.accepted(rt)) throw new VerificationError('VERIFICATION_PLATFORM_ACCEPTED');
        if (rt.row.state !== 'auto_active' || rt.row.mode === 'manual_only') throw new VerificationError('VERIFICATION_CONTROL_EXPIRED');
      };
      const result = await rt.challenge.autoAttempt(admit, async () => {
        await admit();
        if (rt.row.humanRequested) throw new VerificationError('VERIFICATION_HUMAN_REQUESTED');
        if (!await this.repository.reserve(verificationBuckets(rt.row.subject), rt.row.id, randomUUID(), 'gesture', this.clock.now())) throw new VerificationError('VERIFICATION_AUTO_BUDGET_EXHAUSTED', 429);
        await this.change(rt, next => { next.autoAttempts++; });
      });
      if (this.accepted(rt) && result.success) await this.handoff(rt);
      else await this.beginSettling(rt, false, rt.row.humanRequested ? 'human' : 'stop');
    } catch (error) {
      if (error instanceof VerificationError && error.code === 'VERIFICATION_STATE_CHANGED') return;
      if (this.accepted(rt)) await this.handoff(rt);
      else if (rt.row.humanRequested && !rt.stopping) await this.beginSettling(rt, false, 'human');
      else await this.fail(rt, error instanceof VerificationError ? error.code : 'VERIFICATION_AUTO_SOLVE_FAILED');
    } finally { rt.autoRunning = false; }
  }
  private async offerHuman(rt: Active) {
    await this.releaseBounded(rt);
    rt.settlingAt = undefined;
    rt.challenge.browser.invalidate(); rt.frames.clear();
    await this.change(rt, next => { next.mode = 'manual_only'; next.state = 'preparing'; next.humanRequested = false; next.setupDeadline = Math.min(this.clock.now() + this.timing.setup, next.expiresAt); });
  }
  private async handoff(rt: Active) {
    if (VERIFICATION_TERMINAL.has(rt.row.state) || ['handoff', 'rechecking'].includes(rt.row.state)) return;
    await this.change(rt, next => {
      if (VERIFICATION_TERMINAL.has(next.state) || ['handoff', 'rechecking'].includes(next.state)) throw new VerificationError('VERIFICATION_STATE_CHANGED');
      next.state = 'handoff'; next.controlEpoch++; next.controller = undefined; next.presentation = undefined;
    });
    rt.challenge.browser.invalidate(); await this.releaseBounded(rt); rt.resolve();
  }
  async rechecking(id: string) {
    const rt = this.active.get(id); if (!rt) return;
    await this.change(rt, next => { next.state = 'rechecking'; next.presentation = undefined; });
    rt.recheckingAt = this.clock.now();
    await rt.challenge.browser.close();
  }
  async failById(id: string, code: string) { const rt = this.active.get(id); if (rt) await this.fail(rt, code); }
  private async fail(rt: Active, code: string, state: 'failed' | 'cancelled' | 'expired' = 'failed') {
    if (VERIFICATION_TERMINAL.has(rt.row.state)) return;
    rt.stopping = true; rt.challenge.browser.invalidate();
    rt.reject(new VerificationError(code));
    this.active.delete(rt.row.id);
    // A failed DB cannot be allowed to keep a browser/controller alive.
    void this.closeContext(rt).catch(() => undefined);
    try {
      await this.change(rt, next => { next.state = state; next.failureCode = code; next.controlEpoch++; next.controller = undefined; next.presentation = undefined; });
    } finally {
      void rt.challenge.browser.close().catch(() => undefined);
    }
  }
  async cancelSubject(subjectId: string) {
    for (const rt of this.active.values()) if (rt.row.subject.accountId === subjectId || rt.row.subject.loginSessionId === subjectId) await this.fail(rt, 'VERIFICATION_CANCELLED', 'cancelled');
  }
  private async tick(rt: Active) {
    if (rt.tickBusy || rt.stopping || VERIFICATION_TERMINAL.has(rt.row.state)) return;
    rt.tickBusy = true;
    try {
      if (this.clock.monotonic() - rt.leaseAt >= this.timing.ownerLease) { await this.fail(rt, 'VERIFICATION_OWNER_LOST', 'cancelled'); return; }
      const now = this.clock.now();
      if (now >= rt.row.expiresAt) { await this.fail(rt, 'VERIFICATION_EXPIRED', 'expired'); return; }
      if (now - rt.persistedAt >= 2_000) {
        if (!await this.access.authorize(rt.row.subject, rt.row.subject.adminId)) { await this.fail(rt, 'VERIFICATION_FORBIDDEN', 'cancelled'); return; }
        await this.change(rt, () => undefined);
      }
      if (rt.row.state === 'preparing' && (now >= rt.row.setupDeadline || now >= rt.row.discoveryDeadline && !this.available(rt.row.subject.adminId))) void this.startAuto(rt);
      else if (rt.row.state === 'priority_wait' && now >= rt.row.priorityDeadline!) void this.startAuto(rt);
      else if (rt.row.state === 'human_active') {
        if (this.accepted(rt)) await this.handoff(rt);
        else if (now >= rt.row.humanDeadline! || rt.row.reconnectDeadline && now >= rt.row.reconnectDeadline) await this.beginSettling(rt);
        else if (!rt.row.reconnectDeadline && (!this.viewers.get(rt.row.controller!.clientId)?.visible || now >= (rt.row.presentation?.until ?? 0))) this.disconnect(rt.row.controller!.clientId);
      } else if (rt.row.state === 'settling' && rt.settlingAt) {
        if (this.accepted(rt)) await this.handoff(rt);
        else {
          const pending = rt.challenge.pendingAnswers(); if (pending) rt.lastPendingAt = now;
          if (!pending && now - rt.lastPendingAt >= 500) {
            if (rt.settleGoal === 'human') await this.offerHuman(rt);
            else if (rt.settleGoal === 'stop') await this.fail(rt, 'VERIFICATION_AUTO_SOLVE_FAILED');
            else void this.startAuto(rt);
          }
          else if (now - rt.settlingAt >= this.timing.settling) await this.fail(rt, 'VERIFICATION_OUTCOME_UNKNOWN');
        }
      } else if (rt.row.state === 'rechecking') {
        const health = await this.access.health(rt.row.subject);
        if (health === 'cancelled') await this.fail(rt, 'VERIFICATION_CANCELLED', 'cancelled');
        else if (health === 'ready' || health === 'partial') {
          await this.change(rt, next => { next.state = health === 'ready' ? 'succeeded' : 'completed_partial'; }); this.active.delete(rt.row.id);
        } else if (now - (rt.recheckingAt ?? now) > 30_000) await this.fail(rt, 'VERIFICATION_RECHECK_TIMEOUT');
      }
    } catch (error) {
      if (!(error instanceof VerificationError && error.code === 'VERIFICATION_STATE_CHANGED')) await this.fail(rt, 'VERIFICATION_STATE_UNAVAILABLE').catch(() => undefined);
    }
    finally { rt.tickBusy = false; }
  }
  async close() { if (this.timer) clearInterval(this.timer); if (this.watchdog) clearInterval(this.watchdog); for (const rt of [...this.active.values()]) await this.fail(rt, 'VERIFICATION_OWNER_STOPPING', 'cancelled'); this.events.removeAllListeners(); }
}
