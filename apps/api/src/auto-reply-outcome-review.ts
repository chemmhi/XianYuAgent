import { createId, digestJson } from './security.js';

export const OUTCOME_EVIDENCE_TYPES = [
  'DOMAIN_FACT_SATISFIED',
  'BUYER_CONFIRMED',
  'HUMAN_OVERRIDE',
  'BUYER_DENIED',
  'REPEAT_QUESTION',
  'FACT_REGRESSION',
  'SENDER_PERSISTED',
  'BUYER_READ',
  'MODEL_SELF_ASSESSMENT',
] as const;

export type OutcomeEvidenceType = (typeof OUTCOME_EVIDENCE_TYPES)[number];
export type ResolutionStatus = 'review_pending' | 'reviewing' | 'resolved' | 'needs_followup' | 'unresolved' | 'unknown' | 'review_failed' | 'closed';
export type OutcomeReviewDecision = 'RESOLVED' | 'NEEDS_FOLLOWUP' | 'UNRESOLVED' | 'NO_EVIDENCE' | 'RETRY' | 'FAILED';

export interface OutcomeEvidence {
  evidenceId: string;
  type: OutcomeEvidenceType;
  observedAt: string;
  sourceEventId: string;
  summary: string;
  authoritative?: boolean;
}

export interface OutcomeReviewPolicy {
  policyVersion: string;
  leaseSeconds: number;
  maxAttempts: number;
  backoffSeconds: readonly number[];
  reopenWindowSeconds: number;
  evidenceWindowSeconds: number;
  closeRequiresWindow: true;
  resolvingEvidencePriority: readonly OutcomeEvidenceType[];
  reopenEvidenceTypes: readonly OutcomeEvidenceType[];
}

export interface OutcomeReviewRecord {
  reviewId: string;
  accountId: string;
  conversationId: string;
  runId: string;
  goalId: string;
  stateId: string;
  resolutionStatus: ResolutionStatus;
  decision?: OutcomeReviewDecision;
  evidenceRefs: string[];
  evidenceTypes: OutcomeEvidenceType[];
  evidenceWindowStart: string;
  evidenceWindowEnd: string;
  reviewerSource: 'OUTCOME_WORKER' | 'HUMAN_OVERRIDE';
  attempt: number;
  claimKey?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  idempotencyKey: string;
  reviewedAt?: string;
  nextReviewAt?: string;
  nextAction?: string;
  deadLetteredAt?: string;
  resolvedAt?: string;
  closedAt?: string;
  expectedStateVersion: number;
  supersedesReviewId?: string;
}

export interface OutcomeReviewInput {
  record: OutcomeReviewRecord;
  policy: OutcomeReviewPolicy | undefined;
  evidence: readonly OutcomeEvidence[];
  currentStateVersion: number;
  now?: Date;
  workerId?: string;
  claimKey?: string;
  idempotencyKey?: string;
}

export interface OutcomeReviewResult {
  status: 'claimed' | 'claim_rejected' | 'completed' | 'retry_scheduled' | 'dead_lettered' | 'idempotent' | 'cas_conflict';
  record: OutcomeReviewRecord;
  reasonCode?: string;
}

export class OutcomeReviewError extends Error {
  readonly code: string;
  constructor(code: string, message = code) {
    super(message);
    this.name = 'OutcomeReviewError';
    this.code = code;
  }
}

export class OutcomeReviewEngine {
  constructor(private readonly idFactory: () => string = createId) {}

  createPending(input: { accountId: string; conversationId: string; runId: string; goalId: string; stateId: string; expectedStateVersion: number; policy: OutcomeReviewPolicy | undefined; now?: Date; idempotencyKey: string }): OutcomeReviewRecord {
    const policy = validatePolicy(input.policy);
    const now = input.now ?? new Date();
    if (!input.accountId.trim() || !input.conversationId.trim() || !input.runId.trim() || !input.goalId.trim() || !input.stateId.trim() || !input.idempotencyKey.trim()) throw new OutcomeReviewError('OUTCOME_INPUT_INVALID');
    if (!Number.isInteger(input.expectedStateVersion) || input.expectedStateVersion < 0) throw new OutcomeReviewError('OUTCOME_STATE_VERSION_INVALID');
    const evidenceWindowStart = now.toISOString();
    return {
      reviewId: this.idFactory(),
      accountId: input.accountId,
      conversationId: input.conversationId,
      runId: input.runId,
      goalId: input.goalId,
      stateId: input.stateId,
      resolutionStatus: 'review_pending',
      evidenceRefs: [],
      evidenceTypes: [],
      evidenceWindowStart,
      evidenceWindowEnd: new Date(now.getTime() + policy.evidenceWindowSeconds * 1_000).toISOString(),
      reviewerSource: 'OUTCOME_WORKER',
      attempt: 0,
      idempotencyKey: input.idempotencyKey,
      expectedStateVersion: input.expectedStateVersion,
    };
  }

  claim(input: OutcomeReviewInput): OutcomeReviewResult {
    const policy = validatePolicy(input.policy);
    const now = input.now ?? new Date();
    const workerId = input.workerId?.trim();
    const claimKey = input.claimKey?.trim();
    if (!workerId || !claimKey) throw new OutcomeReviewError('OUTCOME_CLAIM_INPUT_INVALID');
    if (input.currentStateVersion !== input.record.expectedStateVersion) return { status: 'cas_conflict', record: clone(input.record), reasonCode: 'STATE_VERSION_CONFLICT' };
    if (input.record.resolutionStatus !== 'review_pending') return { status: 'claim_rejected', record: clone(input.record), reasonCode: 'REVIEW_NOT_PENDING' };
    if (input.record.leaseExpiresAt && Date.parse(input.record.leaseExpiresAt) > now.getTime()) return { status: 'claim_rejected', record: clone(input.record), reasonCode: 'LEASE_ACTIVE' };
    const claimed = clone(input.record);
    claimed.resolutionStatus = 'reviewing';
    claimed.claimKey = claimKey;
    claimed.leaseOwner = workerId;
    claimed.leaseExpiresAt = new Date(now.getTime() + policy.leaseSeconds * 1_000).toISOString();
    claimed.attempt += 1;
    return { status: 'claimed', record: claimed };
  }

  complete(input: OutcomeReviewInput): OutcomeReviewResult {
    const policy = validatePolicy(input.policy);
    const now = input.now ?? new Date();
    const record = clone(input.record);
    if (input.idempotencyKey && input.idempotencyKey === record.idempotencyKey && record.reviewedAt) return { status: 'idempotent', record };
    if (record.resolutionStatus !== 'reviewing') throw new OutcomeReviewError('REVIEW_NOT_CLAIMED');
    if (!record.leaseOwner || !record.claimKey || record.leaseExpiresAt && Date.parse(record.leaseExpiresAt) <= now.getTime()) throw new OutcomeReviewError('REVIEW_LEASE_EXPIRED');
    if (input.workerId && input.workerId !== record.leaseOwner) throw new OutcomeReviewError('REVIEW_LEASE_OWNER_MISMATCH');
    if (input.currentStateVersion !== record.expectedStateVersion) return { status: 'cas_conflict', record, reasonCode: 'STATE_VERSION_CONFLICT' };

    const uniqueEvidence = uniqueEvidenceForWindow(input.evidence, record.evidenceWindowStart, now);
    const negative = uniqueEvidence.filter((item) => policy.reopenEvidenceTypes.includes(item.type));
    const resolving = selectResolvingEvidence(uniqueEvidence, policy.resolvingEvidencePriority);
    record.evidenceRefs = unique([...record.evidenceRefs, ...uniqueEvidence.map((item) => item.evidenceId)]);
    record.evidenceTypes = unique([...record.evidenceTypes, ...uniqueEvidence.map((item) => item.type)]) as OutcomeEvidenceType[];
    record.reviewedAt = now.toISOString();
    record.leaseExpiresAt = undefined;
    record.leaseOwner = undefined;
    record.claimKey = undefined;
    if (resolving) {
      record.resolutionStatus = 'resolved';
      record.decision = 'RESOLVED';
      record.resolvedAt = now.toISOString();
      return { status: 'completed', record, reasonCode: `RESOLVED_BY_${resolving.type}` };
    }
    if (now.getTime() < Date.parse(record.evidenceWindowEnd)) {
      record.resolutionStatus = 'review_pending';
      record.decision = 'NO_EVIDENCE';
      record.nextReviewAt = new Date(Math.min(Date.parse(record.evidenceWindowEnd), now.getTime() + policy.backoffSeconds[Math.min(record.attempt - 1, policy.backoffSeconds.length - 1)]! * 1_000)).toISOString();
      return { status: 'retry_scheduled', record, reasonCode: 'NO_EVIDENCE_WINDOW_OPEN' };
    }
    record.resolutionStatus = 'unknown';
    record.decision = uniqueEvidence.some((item) => item.type === 'BUYER_DENIED' || item.type === 'REPEAT_QUESTION') ? 'UNRESOLVED' : 'NO_EVIDENCE';
    return { status: 'completed', record, reasonCode: 'EVIDENCE_WINDOW_CLOSED' };
  }

  retry(input: OutcomeReviewInput): OutcomeReviewResult {
    const policy = validatePolicy(input.policy);
    const now = input.now ?? new Date();
    const record = clone(input.record);
    if (record.attempt >= policy.maxAttempts) {
      record.resolutionStatus = 'review_failed';
      record.decision = 'FAILED';
      record.deadLetteredAt = now.toISOString();
      record.reviewedAt = now.toISOString();
      return { status: 'dead_lettered', record, reasonCode: 'MAX_ATTEMPTS_EXCEEDED' };
    }
    record.resolutionStatus = 'review_pending';
    record.decision = 'RETRY';
    record.nextReviewAt = new Date(now.getTime() + policy.backoffSeconds[Math.min(record.attempt, policy.backoffSeconds.length - 1)]! * 1_000).toISOString();
    record.leaseOwner = undefined;
    record.claimKey = undefined;
    record.leaseExpiresAt = undefined;
    return { status: 'retry_scheduled', record, reasonCode: 'RETRY_SCHEDULED' };
  }

  close(input: { record: OutcomeReviewRecord; policy: OutcomeReviewPolicy | undefined; currentStateVersion: number; now?: Date }): OutcomeReviewResult {
    const policy = validatePolicy(input.policy);
    const now = input.now ?? new Date();
    const record = clone(input.record);
    if (input.currentStateVersion !== record.expectedStateVersion) return { status: 'cas_conflict', record, reasonCode: 'STATE_VERSION_CONFLICT' };
    if (record.resolutionStatus !== 'resolved' || !record.resolvedAt) return { status: 'claim_rejected', record, reasonCode: 'RESOLVED_REQUIRED' };
    if (!policy.closeRequiresWindow || now.getTime() < Date.parse(record.resolvedAt) + policy.reopenWindowSeconds * 1_000) return { status: 'claim_rejected', record, reasonCode: 'REOPEN_WINDOW_OPEN' };
    record.resolutionStatus = 'closed';
    record.closedAt = now.toISOString();
    return { status: 'completed', record };
  }

  reopen(input: { record: OutcomeReviewRecord; policy: OutcomeReviewPolicy | undefined; currentStateVersion: number; evidence: readonly OutcomeEvidence[]; now?: Date }): OutcomeReviewResult {
    const policy = validatePolicy(input.policy);
    const now = input.now ?? new Date();
    const record = clone(input.record);
    if (input.currentStateVersion !== record.expectedStateVersion) return { status: 'cas_conflict', record, reasonCode: 'STATE_VERSION_CONFLICT' };
    if (record.resolutionStatus !== 'resolved' || !record.resolvedAt) return { status: 'claim_rejected', record, reasonCode: 'RESOLVED_REQUIRED' };
    const resolvedAt = record.resolvedAt;
    if (now.getTime() > Date.parse(resolvedAt) + policy.reopenWindowSeconds * 1_000) return { status: 'claim_rejected', record, reasonCode: 'REOPEN_WINDOW_CLOSED' };
    const negative = input.evidence.filter((item) => policy.reopenEvidenceTypes.includes(item.type) && Number.isFinite(Date.parse(item.observedAt)) && Date.parse(item.observedAt) >= Date.parse(resolvedAt) && Date.parse(item.observedAt) <= now.getTime());
    if (negative.length === 0) return { status: 'claim_rejected', record, reasonCode: 'REOPEN_EVIDENCE_MISSING' };
    record.resolutionStatus = 'needs_followup';
    record.decision = 'NEEDS_FOLLOWUP';
    record.evidenceRefs = unique([...record.evidenceRefs, ...negative.map((item) => item.evidenceId)]);
    record.evidenceTypes = unique([...record.evidenceTypes, ...negative.map((item) => item.type)]) as OutcomeEvidenceType[];
    record.nextAction = 'FOLLOW_UP';
    record.supersedesReviewId = this.idFactory();
    record.reviewedAt = now.toISOString();
    return { status: 'completed', record, reasonCode: 'RESOLUTION_REOPENED' };
  }
}

function validatePolicy(policy: OutcomeReviewPolicy | undefined): OutcomeReviewPolicy {
  if (!policy?.policyVersion?.trim()) throw new OutcomeReviewError('OUTCOME_POLICY_UNAVAILABLE');
  if (!Number.isInteger(policy.leaseSeconds) || policy.leaseSeconds <= 0 || !Number.isInteger(policy.maxAttempts) || policy.maxAttempts <= 0 || !Array.isArray(policy.backoffSeconds) || policy.backoffSeconds.length === 0 || policy.backoffSeconds.some((value) => !Number.isInteger(value) || value <= 0) || !Number.isInteger(policy.reopenWindowSeconds) || policy.reopenWindowSeconds <= 0 || !Number.isInteger(policy.evidenceWindowSeconds) || policy.evidenceWindowSeconds <= 0 || policy.closeRequiresWindow !== true || !Array.isArray(policy.resolvingEvidencePriority) || !Array.isArray(policy.reopenEvidenceTypes)) throw new OutcomeReviewError('OUTCOME_POLICY_INVALID');
  return policy;
}

function uniqueEvidenceForWindow(evidence: readonly OutcomeEvidence[], start: string, now: Date): OutcomeEvidence[] {
  const startMs = Date.parse(start);
  const result = evidence.filter((item) => Number.isFinite(Date.parse(item.observedAt)) && Date.parse(item.observedAt) >= startMs && Date.parse(item.observedAt) <= now.getTime());
  return [...new Map(result.map((item) => [item.evidenceId, item])).values()];
}

function selectResolvingEvidence(evidence: readonly OutcomeEvidence[], priority: readonly OutcomeEvidenceType[]): OutcomeEvidence | undefined {
  const rank = new Map(priority.map((type, index) => [type, index]));
  return [...evidence].filter((item) => rank.has(item.type)).sort((left, right) => (rank.get(left.type)! - rank.get(right.type)!) || left.evidenceId.localeCompare(right.evidenceId))[0];
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function clone(record: OutcomeReviewRecord): OutcomeReviewRecord {
  return { ...record, evidenceRefs: [...record.evidenceRefs], evidenceTypes: [...record.evidenceTypes] };
}
