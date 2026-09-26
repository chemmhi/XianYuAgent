import { OutcomeReviewEngine, type OutcomeEvidence, type OutcomeReviewPolicy, type OutcomeReviewRecord } from './auto-reply-outcome-review.js';
import { AutoReplyRepairRepository, type PersistedRepairReviewEvent, type PersistedRepairReviewRecord } from './auto-reply-repair-repository.js';
import { createId } from './security.js';

export interface OutcomeReviewWorkerOptions {
  workerId: string;
  accountId?: string;
  batchSize?: number;
  leaseSeconds?: number;
  pollMs?: number;
  onError?: (error: unknown) => void;
  policyProvider: (record: PersistedRepairReviewRecord) => Promise<OutcomeReviewPolicy | undefined> | OutcomeReviewPolicy | undefined;
  evidenceProvider?: (record: PersistedRepairReviewRecord) => Promise<readonly OutcomeEvidence[]>;
  now?: () => Date;
}

export interface OutcomeReviewPollResult {
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
  skipped: number;
}

export class OutcomeReviewWorker {
  private readonly engine = new OutcomeReviewEngine();
  private readonly batchSize: number;
  private readonly leaseSeconds: number;
  private readonly pollMs: number;
  private readonly evidenceProvider: NonNullable<OutcomeReviewWorkerOptions['evidenceProvider']>;
  private readonly now: () => Date;
  private running = false;
  private loopPromise?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private wake?: () => void;

  constructor(private readonly repository: AutoReplyRepairRepository, private readonly options: OutcomeReviewWorkerOptions) {
    this.batchSize = Math.max(1, Math.min(100, Math.trunc(options.batchSize ?? 10)));
    this.leaseSeconds = Math.max(1, Math.min(900, Math.trunc(options.leaseSeconds ?? 60)));
    this.pollMs = Math.max(50, Math.min(60_000, Math.trunc(options.pollMs ?? 1_000)));
    this.evidenceProvider = options.evidenceProvider ?? (async () => []);
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.wake?.();
    this.wake = undefined;
    await this.loopPromise;
    this.loopPromise = undefined;
  }

  async pollOnce(): Promise<OutcomeReviewPollResult> {
    const now = this.now();
    const candidates = await this.repository.listClaimableOutcomeReviews({ accountId: this.options.accountId, limit: this.batchSize, now: now.toISOString() });
    const result: OutcomeReviewPollResult = { claimed: 0, completed: 0, retried: 0, failed: 0, skipped: 0 };
    await Promise.all(candidates.map(async (candidate) => {
      const outcome = await this.processOne(candidate);
      result.claimed += outcome.claimed;
      result.completed += outcome.completed;
      result.retried += outcome.retried;
      result.failed += outcome.failed;
      result.skipped += outcome.skipped;
    }));
    return result;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce();
      } catch (error) {
        this.options.onError?.(error);
      }
      if (!this.running) break;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.wake = undefined;
          resolve();
        }, this.pollMs);
      });
    }
  }

  async close(input: { record: PersistedRepairReviewRecord; policy: OutcomeReviewPolicy | undefined; now?: Date }): Promise<'updated' | 'idempotent' | 'cas_conflict' | 'not_found' | 'lease_lost' | 'rejected'> {
    const now = input.now ?? this.now();
    const result = this.engine.close({ record: toOutcomeRecord(input.record), policy: input.policy, currentStateVersion: input.record.expectedStateVersion, now });
    if (result.status === 'cas_conflict') return 'cas_conflict';
    if (result.status === 'claim_rejected') return 'rejected';
    return this.persistResult(input.record, result.record, input.policy?.policyVersion ?? 'unknown', 'review.closed', now);
  }

  async reopen(input: { record: PersistedRepairReviewRecord; policy: OutcomeReviewPolicy | undefined; evidence: readonly OutcomeEvidence[]; now?: Date }): Promise<'updated' | 'idempotent' | 'cas_conflict' | 'not_found' | 'lease_lost' | 'rejected'> {
    const now = input.now ?? this.now();
    const result = this.engine.reopen({ record: toOutcomeRecord(input.record), policy: input.policy, currentStateVersion: input.record.expectedStateVersion, evidence: input.evidence, now });
    if (result.status === 'cas_conflict') return 'cas_conflict';
    if (result.status === 'claim_rejected') return 'rejected';
    return this.persistResult(input.record, result.record, input.policy?.policyVersion ?? 'unknown', 'resolution.reopened', now);
  }

  private async processOne(candidate: PersistedRepairReviewRecord): Promise<OutcomeReviewPollResult> {
    const result: OutcomeReviewPollResult = { claimed: 0, completed: 0, retried: 0, failed: 0, skipped: 0 };
    const policy = await this.options.policyProvider(candidate);
    if (!policy) { result.skipped += 1; return result; }
    const now = this.now();
    const claimKey = `${this.options.workerId}:${candidate.reviewId}:${candidate.attempt + 1}`;
    const claimed = this.engine.claim({ record: toOutcomeRecord(candidate), policy, currentStateVersion: candidate.expectedStateVersion, now, workerId: this.options.workerId, claimKey, evidence: [] });
    if (claimed.status !== 'claimed') { result.skipped += 1; return result; }
    const claimRecord = claimed.record;
    const persistedClaim = await this.repository.claimOutcomeReview({ reviewId: candidate.reviewId, workerId: this.options.workerId, claimKey, leaseSeconds: policy.leaseSeconds || this.leaseSeconds, expectedStateVersion: candidate.expectedStateVersion, now: now.toISOString(), event: this.event(candidate, claimRecord, policy.policyVersion, 'review.claimed', now, `claim:${claimKey}`, { attempt: claimRecord.attempt, leaseOwner: this.options.workerId }) });
    if (persistedClaim.status !== 'updated' || !persistedClaim.record) { result.skipped += 1; return result; }
    result.claimed += 1;
    const heartbeatMs = Math.max(1_000, Math.floor((policy.leaseSeconds * 1_000) / 2));
    const heartbeat = setInterval(() => { void this.repository.heartbeatOutcomeReview({ reviewId: persistedClaim.record!.reviewId, workerId: this.options.workerId, claimKey, leaseSeconds: policy.leaseSeconds, now: this.now().toISOString() }); }, heartbeatMs);
    try {
      const evidence = await this.evidenceProvider(persistedClaim.record);
      const completed = this.engine.complete({ record: toOutcomeRecord(persistedClaim.record), policy, currentStateVersion: persistedClaim.record.expectedStateVersion, now: this.now(), workerId: this.options.workerId, evidence });
      const status = await this.persistResult(persistedClaim.record, completed.record, policy.policyVersion, eventTypeForResult(completed.status, completed.record.resolutionStatus), this.now(), claimKey);
      if (status === 'updated' || status === 'idempotent') {
        if (completed.status === 'retry_scheduled') result.retried += 1;
        else if (completed.record.resolutionStatus === 'review_failed') result.failed += 1;
        else result.completed += 1;
      } else result.skipped += 1;
      return result;
    } catch (error) {
      const retried = this.engine.retry({ record: toOutcomeRecord(persistedClaim.record), policy, currentStateVersion: persistedClaim.record.expectedStateVersion, now: this.now(), evidence: [] });
      const status = await this.persistResult(persistedClaim.record, retried.record, policy.policyVersion, retried.status === 'dead_lettered' ? 'review.dead_lettered' : 'review.retry_scheduled', this.now(), claimKey, { errorCode: errorCode(error) });
      if (status === 'updated' || status === 'idempotent') {
        if (retried.status === 'dead_lettered') result.failed += 1;
        else result.retried += 1;
      } else result.skipped += 1;
      return result;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async persistResult(previous: PersistedRepairReviewRecord, next: OutcomeReviewRecord, policyVersion: string, eventType: string, now: Date, claimKey?: string, extraPayload: Record<string, unknown> = {}): Promise<'updated' | 'idempotent' | 'cas_conflict' | 'not_found' | 'lease_lost' | 'rejected'> {
    const persisted = toPersistedRecord(next, previous);
    const event = this.event(previous, persisted, policyVersion, eventType, now, `${eventType}:${persisted.reviewId}:${persisted.attempt}:${persisted.reviewedAt ?? persisted.nextReviewAt ?? now.toISOString()}`, { resolutionStatus: persisted.resolutionStatus, decision: persisted.decision, evidenceTypes: persisted.evidenceTypes, ...extraPayload });
    const result = await this.repository.applyOutcomeReviewMutation({ record: persisted, event, workerId: claimKey ? this.options.workerId : undefined, claimKey });
    return result.status;
  }

  private event(source: PersistedRepairReviewRecord, review: PersistedRepairReviewRecord | OutcomeReviewRecord, policyVersion: string, eventType: string, now: Date, idempotencyKey: string, payload: Record<string, unknown>): PersistedRepairReviewEvent {
    return { eventId: createId(), reviewId: source.reviewId, accountId: source.accountId, conversationId: source.conversationId, eventType, sourceEventId: `review:${source.reviewId}`, sourceSequence: Math.max(1, source.expectedStateVersion), stateVersion: source.expectedStateVersion, policyVersion, idempotencyKey, occurredAt: now.toISOString(), payload: { reviewId: source.reviewId, resolutionStatus: 'resolutionStatus' in review ? review.resolutionStatus : source.resolutionStatus, ...payload } };
  }
}

function toOutcomeRecord(record: PersistedRepairReviewRecord): OutcomeReviewRecord {
  return { reviewId: record.reviewId, accountId: record.accountId, conversationId: record.conversationId, runId: record.runId, goalId: record.goalId, stateId: record.stateId, resolutionStatus: record.resolutionStatus as OutcomeReviewRecord['resolutionStatus'], decision: record.decision as OutcomeReviewRecord['decision'], evidenceRefs: [...record.evidenceRefs], evidenceTypes: record.evidenceTypes as OutcomeReviewRecord['evidenceTypes'], evidenceWindowStart: record.evidenceWindowStart ?? new Date(0).toISOString(), evidenceWindowEnd: record.evidenceWindowEnd ?? new Date(0).toISOString(), reviewerSource: record.reviewerSource === 'HUMAN_OVERRIDE' ? 'HUMAN_OVERRIDE' : 'OUTCOME_WORKER', attempt: record.attempt, claimKey: record.claimKey, leaseOwner: record.leaseOwner, leaseExpiresAt: record.leaseExpiresAt, idempotencyKey: record.idempotencyKey, reviewedAt: record.reviewedAt, nextReviewAt: record.nextReviewAt, nextAction: record.nextAction, deadLetteredAt: record.deadLetteredAt, resolvedAt: record.resolvedAt, closedAt: record.closedAt, expectedStateVersion: record.expectedStateVersion, supersedesReviewId: record.supersedesReviewId };
}

function toPersistedRecord(record: OutcomeReviewRecord, previous: PersistedRepairReviewRecord): PersistedRepairReviewRecord {
  return { ...previous, resolutionStatus: record.resolutionStatus, decision: record.decision, evidenceRefs: [...record.evidenceRefs], evidenceTypes: [...record.evidenceTypes], evidenceWindowStart: record.evidenceWindowStart, evidenceWindowEnd: record.evidenceWindowEnd, reviewerSource: record.reviewerSource, attempt: record.attempt, claimKey: record.claimKey, leaseOwner: record.leaseOwner, leaseExpiresAt: record.leaseExpiresAt, idempotencyKey: record.idempotencyKey, reviewedAt: record.reviewedAt, nextReviewAt: record.nextReviewAt, nextAction: record.nextAction, deadLetteredAt: record.deadLetteredAt, resolvedAt: record.resolvedAt, closedAt: record.closedAt, expectedStateVersion: record.expectedStateVersion, supersedesReviewId: record.supersedesReviewId };
}

function eventTypeForResult(status: string, resolutionStatus: string): string {
  if (resolutionStatus === 'resolved') return 'review.completed';
  if (resolutionStatus === 'unknown') return 'review.completed';
  if (resolutionStatus === 'review_failed') return 'review.dead_lettered';
  if (status === 'retry_scheduled') return 'review.retry_scheduled';
  return 'review.completed';
}

function errorCode(error: unknown): string {
  const value = (error as { code?: unknown } | null)?.code;
  return typeof value === 'string' ? value : error instanceof Error ? error.name : 'OUTCOME_REVIEW_FAILED';
}
