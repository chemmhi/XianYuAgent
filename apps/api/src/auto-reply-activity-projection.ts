import { AUTO_REPLY_ACTION_KINDS, AUTO_REPLY_ACTIVITY_NEXT_ACTIONS, type ActionKind, type AutoReplyNextAction, type AutoReplyRunRecord, type AutoReplyRunStatus } from './domain.js';
import type { PersistedRepairReviewRecord } from './auto-reply-repair-repository.js';

export type AutoReplyTransportStatus = 'generated' | 'simulated' | 'persisted' | 'known_failure' | 'unknown';
export type AutoReplyResolutionStatus = 'review_pending' | 'reviewing' | 'resolved' | 'needs_followup' | 'unresolved' | 'unknown' | 'review_failed' | 'closed';

export interface AutoReplyActivityReviewInput {
  reviews?: readonly PersistedRepairReviewRecord[];
  primaryAction?: unknown;
  shadowEventPayload?: Record<string, unknown>;
}

export interface AutoReplyActivityProjection {
  transportStatus: AutoReplyTransportStatus;
  resolutionStatus: AutoReplyResolutionStatus;
  goalProgress: 'unknown' | 'in_progress' | 'blocked' | 'completed';
  primaryAction?: ActionKind;
  nextAction?: AutoReplyNextAction;
  legacyActionKind?: string;
  legacyTransportStatus?: string;
  legacyHandoffReason?: string;
}

export function projectAutoReplyRun(run: AutoReplyRunRecord, input: AutoReplyActivityReviewInput = {}): AutoReplyActivityProjection {
  const transportStatus = transportForStatus(run.status, run.senderOutcome);
  const reviews = input.reviews ?? [];
  const outcomeReview = latestReview(reviews, 'OUTCOME');
  const preSendReview = latestReview(reviews, 'PRE_SEND');
  const resolutionStatus = normalizeResolutionStatus(outcomeReview?.resolutionStatus)
    ?? (run.status === 'persisted' && run.senderOutcome === 'known_success' ? 'review_pending' : 'unknown');
  const primaryAction = toActionKind(input.primaryAction ?? input.shadowEventPayload?.primaryAction);
  const nextAction = toNextAction(outcomeReview?.nextAction) ?? toNextAction(preSendReview?.nextAction);
  return {
    transportStatus,
    resolutionStatus,
    goalProgress: goalProgressForResolution(resolutionStatus),
    ...(primaryAction ? { primaryAction } : {}),
    ...(nextAction ? { nextAction } : {}),
    legacyActionKind: run.decision === 'handoff' ? 'LEGACY_HANDOFF' : run.decision === 'replied' ? 'LEGACY_REPLIED' : run.decision.toUpperCase(),
    legacyTransportStatus: run.status,
    ...(run.decision === 'handoff' ? { legacyHandoffReason: run.failureCode ?? 'LEGACY_UNCLASSIFIED' } : {}),
  };
}

function latestReview(reviews: readonly PersistedRepairReviewRecord[], reviewType: PersistedRepairReviewRecord['reviewType']): PersistedRepairReviewRecord | undefined {
  return reviews
    .filter((review) => review.reviewType === reviewType)
    .sort((left, right) => reviewTime(right) - reviewTime(left) || right.expectedStateVersion - left.expectedStateVersion || right.reviewId.localeCompare(left.reviewId))[0];
}

function reviewTime(review: PersistedRepairReviewRecord): number {
  const candidates = [review.reviewedAt, review.nextReviewAt, review.evidenceWindowEnd, review.evidenceWindowStart];
  for (const value of candidates) {
    const parsed = value ? Date.parse(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizeResolutionStatus(value: string | undefined): AutoReplyResolutionStatus | undefined {
  if (!value) return undefined;
  return ['review_pending', 'reviewing', 'resolved', 'needs_followup', 'unresolved', 'unknown', 'review_failed', 'closed'].includes(value)
    ? value as AutoReplyResolutionStatus
    : undefined;
}

function goalProgressForResolution(status: AutoReplyResolutionStatus): 'unknown' | 'in_progress' | 'blocked' | 'completed' {
  if (status === 'resolved' || status === 'closed') return 'completed';
  if (status === 'needs_followup' || status === 'unresolved' || status === 'review_failed') return 'blocked';
  if (status === 'review_pending' || status === 'reviewing') return 'in_progress';
  return 'unknown';
}

function toActionKind(value: unknown): ActionKind | undefined {
  return typeof value === 'string' && (AUTO_REPLY_ACTION_KINDS as readonly string[]).includes(value) ? value as ActionKind : undefined;
}

function toNextAction(value: unknown): AutoReplyNextAction | undefined {
  return typeof value === 'string' && (AUTO_REPLY_ACTIVITY_NEXT_ACTIONS as readonly string[]).includes(value) ? value as AutoReplyNextAction : undefined;
}

function transportForStatus(status: AutoReplyRunStatus, senderOutcome: AutoReplyRunRecord['senderOutcome']): AutoReplyTransportStatus {
  if (status === 'persisted') return 'persisted';
  if (status === 'simulated' || senderOutcome === 'simulated') return 'simulated';
  if (status === 'generated') return 'generated';
  if (senderOutcome === 'known_failure' || status === 'failed') return 'known_failure';
  return 'unknown';
}
