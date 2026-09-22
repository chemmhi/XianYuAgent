import { createId, digestJson } from './security.js';
import { AUTO_REPLY_ACTION_KINDS, type ActionKind, type ActionPlan } from './domain.js';

export type PreSendReviewDecision = 'APPROVE' | 'REVISE' | 'CLARIFY' | 'BLOCK_SENSITIVE';
export type PreSendReviewEventType = 'review.started' | 'review.completed' | 'review.failed';
export type PreSendReviewReasonCode =
  | 'POLICY_CONFIG_UNAVAILABLE'
  | 'POLICY_VERSION_MISMATCH'
  | 'ACTION_NOT_ALLOWED'
  | 'ACTION_PLAN_INVALID'
  | 'GOAL_SCOPE_MISMATCH'
  | 'GOAL_COVERAGE_MISSING'
  | 'REQUIRED_FACT_MISSING'
  | 'CLAIM_FACT_MISSING'
  | 'FACT_SCOPE_MISMATCH'
  | 'FACT_STALE'
  | 'FACT_REF_UNDECLARED'
  | 'HANDOFF_REASON_MISSING'
  | 'HANDOFF_REASON_NOT_ALLOWED'
  | 'HANDOFF_EVIDENCE_MISSING'
  | 'OUTBOUND_SENSITIVE_DETECTED'
  | 'OUTBOUND_SENSITIVE_UNKNOWN'
  | 'OUTBOUND_SENSITIVE_REDACTION_INVALID';

export interface PreSendReviewPolicy {
  /** Pre-send review must permit at most one automatic revision. */
  maxRevisionAttempts: 1;
  /** Freshness window for verified facts, measured against the UTC server clock. */
  maxFactAgeSeconds: number;
  allowedActionKinds: readonly ActionKind[];
  fallbackActionAllowlist: readonly ActionKind[];
  missingFactsAction: ActionKind;
  validationFailureAction: ActionKind;
  sensitiveFailureAction: 'REFUSE_SENSITIVE';
  allowedHandoffReasonCodes: readonly string[];
}

export interface PreSendReviewPolicyInput {
  policyVersion: string;
  preSend?: Partial<PreSendReviewPolicy>;
}

export interface PreSendVerifiedFact {
  factRef: string;
  key: string;
  accountId: string;
  conversationId?: string;
  productId?: string;
  orderRefs?: readonly string[];
  verifiedAt: string;
  expiresAt?: string;
}

export interface PreSendDraftClaim {
  claimId: string;
  claimType: 'FACTUAL' | 'NON_FACTUAL';
  factRefs: readonly string[];
}

export interface PreSendGoalCoverage {
  requiredCriteria: readonly string[];
  satisfiedCriteria: readonly string[];
  missingCriteria: readonly string[];
}

export interface PreSendScope {
  accountId: string;
  conversationId: string;
  productId?: string;
  orderRefs?: readonly string[];
}

export type OutboundSensitiveStatus = 'clean' | 'detected' | 'unknown';

export interface OutboundSensitiveCheck {
  status: OutboundSensitiveStatus;
  /** Whether an approved redaction pass actually ran for a detected segment. */
  redactionApplied?: boolean;
  sensitiveClass?: string;
}

export interface PreSendReviewInput {
  runId: string;
  goalId: string;
  stateId: string;
  actionPlan: ActionPlan;
  scope: PreSendScope;
  policy: PreSendReviewPolicyInput | undefined;
  verifiedFacts: readonly PreSendVerifiedFact[];
  factRefs: readonly string[];
  draftClaims: readonly PreSendDraftClaim[];
  goalCoverage: PreSendGoalCoverage;
  outboundSensitive: OutboundSensitiveCheck;
  revisionAttempt?: number;
  idempotencyKey: string;
  supersedesReviewId?: string;
  handoffReasonCode?: string;
  handoffEvidenceRefs?: readonly string[];
  now?: Date;
}

export interface PreSendReviewRecord {
  reviewId: string;
  reviewType: 'PRE_SEND';
  accountId: string;
  conversationId: string;
  runId: string;
  goalId: string;
  stateId: string;
  decision: PreSendReviewDecision;
  reasonCodes: PreSendReviewReasonCode[];
  evidenceRefs: string[];
  factRefs: string[];
  policyVersion: string;
  actionPlanId: string;
  goalCoverage: PreSendGoalCoverage;
  handoffReasonCode?: string;
  reviewerSource: 'POLICY_PRE_SEND';
  attempt: number;
  idempotencyKey: string;
  reviewedAt: string;
  supersedesReviewId?: string;
  nextAction?: ActionKind;
  event: {
    type: PreSendReviewEventType;
    reviewId: string;
    runId: string;
    accountId: string;
    conversationId: string;
    stateId: string;
    policyVersion: string;
    reasonCodes: PreSendReviewReasonCode[];
    evidenceDigest: string;
  };
}

export interface PreSendReviewResult {
  decision: PreSendReviewDecision;
  nextAction?: ActionKind;
  revisionRequired: boolean;
  reasonCodes: PreSendReviewReasonCode[];
  record: PreSendReviewRecord;
}

export class PreSendReviewError extends Error {
  readonly code: string;

  constructor(code: string, message: string = code) {
    super(message);
    this.name = 'PreSendReviewError';
    this.code = code;
  }
}

export class PreSendReviewEngine {
  constructor(private readonly idFactory: () => string = createId) {}

  review(input: PreSendReviewInput): PreSendReviewResult {
    const policy = resolvePolicy(input.policy);
    validateInput(input);
    const now = input.now ?? new Date();
    const nowMs = now.getTime();
    const revisionAttempt = input.revisionAttempt ?? 0;
    if (!Number.isInteger(revisionAttempt) || revisionAttempt < 0 || revisionAttempt > policy.maxRevisionAttempts) {
      throw new PreSendReviewError('PRESEND_INPUT_INVALID', 'revisionAttempt is outside the configured review budget');
    }

    const reasonCodes = collectReasons(input, policy, nowMs);
    const sensitiveFailure = reasonCodes.some((code) => code.startsWith('OUTBOUND_SENSITIVE_'));
    let decision: PreSendReviewDecision = 'APPROVE';
    let nextAction: ActionKind | undefined;

    if (reasonCodes.length > 0) {
      if (revisionAttempt < policy.maxRevisionAttempts) {
        decision = 'REVISE';
      } else if (sensitiveFailure) {
        decision = 'BLOCK_SENSITIVE';
        nextAction = policy.sensitiveFailureAction;
      } else if (reasonCodes.includes('REQUIRED_FACT_MISSING') || reasonCodes.includes('CLAIM_FACT_MISSING') || reasonCodes.includes('FACT_STALE') || reasonCodes.includes('FACT_SCOPE_MISMATCH') || reasonCodes.includes('FACT_REF_UNDECLARED') || reasonCodes.includes('GOAL_COVERAGE_MISSING')) {
        decision = 'CLARIFY';
        nextAction = policy.missingFactsAction;
      } else {
        decision = 'CLARIFY';
        nextAction = policy.validationFailureAction;
      }
    }

    const reviewId = this.idFactory();
    const reviewedAt = now.toISOString();
    const evidenceRefs = unique([
      ...input.factRefs,
      ...input.draftClaims.flatMap((claim) => claim.factRefs),
      ...(input.handoffEvidenceRefs ?? []),
    ]);
    const record: PreSendReviewRecord = {
      reviewId,
      reviewType: 'PRE_SEND',
      accountId: input.scope.accountId,
      conversationId: input.scope.conversationId,
      runId: input.runId,
      goalId: input.goalId,
      stateId: input.stateId,
      decision,
      reasonCodes,
      evidenceRefs,
      factRefs: unique(input.factRefs),
      policyVersion: input.policy!.policyVersion,
      actionPlanId: input.actionPlan.actionPlanId,
      goalCoverage: {
        requiredCriteria: [...input.goalCoverage.requiredCriteria],
        satisfiedCriteria: [...input.goalCoverage.satisfiedCriteria],
        missingCriteria: [...input.goalCoverage.missingCriteria],
      },
      ...(input.handoffReasonCode ? { handoffReasonCode: input.handoffReasonCode } : {}),
      reviewerSource: 'POLICY_PRE_SEND',
      attempt: revisionAttempt + 1,
      idempotencyKey: input.idempotencyKey,
      reviewedAt,
      ...(input.supersedesReviewId ? { supersedesReviewId: input.supersedesReviewId } : {}),
      ...(nextAction ? { nextAction } : {}),
      event: {
        type: decision === 'APPROVE' || decision === 'CLARIFY' || decision === 'BLOCK_SENSITIVE' ? 'review.completed' : 'review.failed',
        reviewId,
        runId: input.runId,
        accountId: input.scope.accountId,
        conversationId: input.scope.conversationId,
        stateId: input.stateId,
        policyVersion: input.policy!.policyVersion,
        reasonCodes,
        evidenceDigest: digestJson(evidenceRefs),
      },
    };
    return { decision, nextAction, revisionRequired: decision === 'REVISE', reasonCodes, record };
  }
}

function resolvePolicy(policy: PreSendReviewPolicyInput | undefined): PreSendReviewPolicy {
  const candidate = policy?.preSend;
  if (!policy?.policyVersion?.trim() || !candidate) throw new PreSendReviewError('PRESEND_POLICY_UNAVAILABLE', 'policyVersion and preSend policy are required');
  const maxRevisionAttempts = candidate.maxRevisionAttempts;
  const maxFactAgeSeconds = candidate.maxFactAgeSeconds;
  const allowedActionKinds = candidate.allowedActionKinds;
  const fallbackActionAllowlist = candidate.fallbackActionAllowlist;
  const missingFactsAction = candidate.missingFactsAction;
  const validationFailureAction = candidate.validationFailureAction;
  const sensitiveFailureAction = candidate.sensitiveFailureAction;
  const allowedHandoffReasonCodes = candidate.allowedHandoffReasonCodes;
  if (maxRevisionAttempts !== 1 || typeof maxFactAgeSeconds !== 'number' || !Number.isInteger(maxFactAgeSeconds) || maxFactAgeSeconds <= 0 || !Array.isArray(allowedActionKinds) || allowedActionKinds.length === 0 || !Array.isArray(fallbackActionAllowlist) || fallbackActionAllowlist.length === 0 || !isActionKind(missingFactsAction) || !isActionKind(validationFailureAction) || sensitiveFailureAction !== 'REFUSE_SENSITIVE' || !Array.isArray(allowedHandoffReasonCodes)) {
    throw new PreSendReviewError('PRESEND_POLICY_UNAVAILABLE', 'preSend policy is incomplete or invalid');
  }
  if (allowedActionKinds.some((action) => !isActionKind(action)) || fallbackActionAllowlist.some((action) => !isActionKind(action))) {
    throw new PreSendReviewError('PRESEND_POLICY_UNAVAILABLE', 'preSend policy contains an unknown ActionKind');
  }
  if (!fallbackActionAllowlist.includes(missingFactsAction) || !fallbackActionAllowlist.includes(validationFailureAction) || missingFactsAction === 'HANDOFF' || validationFailureAction === 'HANDOFF') {
    throw new PreSendReviewError('PRESEND_POLICY_UNAVAILABLE', 'preSend fallback actions must be configured safe actions');
  }
  return {
    maxRevisionAttempts: 1,
    maxFactAgeSeconds,
    allowedActionKinds: [...allowedActionKinds],
    fallbackActionAllowlist: [...fallbackActionAllowlist],
    missingFactsAction,
    validationFailureAction,
    sensitiveFailureAction: 'REFUSE_SENSITIVE',
    allowedHandoffReasonCodes: [...allowedHandoffReasonCodes],
  };
}

function validateInput(input: PreSendReviewInput): void {
  for (const [label, value] of Object.entries({ runId: input.runId, goalId: input.goalId, stateId: input.stateId, accountId: input.scope?.accountId, conversationId: input.scope?.conversationId, idempotencyKey: input.idempotencyKey })) {
    if (typeof value !== 'string' || !value.trim()) throw new PreSendReviewError('PRESEND_INPUT_INVALID', `${label} is required`);
  }
  if (!input.policy?.policyVersion || input.actionPlan.policyVersion !== input.policy.policyVersion) {
    throw new PreSendReviewError('PRESEND_INPUT_INVALID', 'action plan policyVersion must match review policyVersion');
  }
  if (!input.actionPlan.actionPlanId || !isActionKind(input.actionPlan.primaryAction)) throw new PreSendReviewError('PRESEND_INPUT_INVALID', 'action plan must contain one canonical primaryAction');
  if (input.actionPlan.primaryGoal.objectiveId !== input.goalId) {
    throw new PreSendReviewError('PRESEND_INPUT_INVALID', 'action plan goal objectiveId does not match review goalId');
  }
  if (input.actionPlan.primaryGoal.accountId !== input.scope.accountId || input.actionPlan.primaryGoal.conversationId !== input.scope.conversationId) {
    throw new PreSendReviewError('PRESEND_INPUT_INVALID', 'action plan goal scope does not match review scope');
  }
  if (!Array.isArray(input.verifiedFacts) || !Array.isArray(input.factRefs) || !Array.isArray(input.draftClaims)) throw new PreSendReviewError('PRESEND_INPUT_INVALID', 'facts and claims must be arrays');
  if (!input.goalCoverage || !Array.isArray(input.goalCoverage.requiredCriteria) || !Array.isArray(input.goalCoverage.satisfiedCriteria) || !Array.isArray(input.goalCoverage.missingCriteria)) throw new PreSendReviewError('PRESEND_INPUT_INVALID', 'goalCoverage is required');
  if (!input.outboundSensitive || !['clean', 'detected', 'unknown'].includes(input.outboundSensitive.status)) throw new PreSendReviewError('PRESEND_INPUT_INVALID', 'outboundSensitive status is required');
}

function collectReasons(input: PreSendReviewInput, policy: PreSendReviewPolicy, nowMs: number): PreSendReviewReasonCode[] {
  const reasons: PreSendReviewReasonCode[] = [];
  if (!policy.allowedActionKinds.includes(input.actionPlan.primaryAction)) reasons.push('ACTION_NOT_ALLOWED');
  if (input.actionPlan.primaryAction === 'HANDOFF') {
    if (input.actionPlan.handoffAllowed !== true) reasons.push('ACTION_PLAN_INVALID');
    if (!input.handoffReasonCode?.trim()) reasons.push('HANDOFF_REASON_MISSING');
    else if (!policy.allowedHandoffReasonCodes.includes(input.handoffReasonCode)) reasons.push('HANDOFF_REASON_NOT_ALLOWED');
    if (!input.handoffEvidenceRefs || input.handoffEvidenceRefs.length === 0) reasons.push('HANDOFF_EVIDENCE_MISSING');
  }
  if (input.goalCoverage.missingCriteria.length > 0 || input.goalCoverage.requiredCriteria.some((criterion) => !input.goalCoverage.satisfiedCriteria.includes(criterion))) reasons.push('GOAL_COVERAGE_MISSING');

  const factsByRef = new Map(input.verifiedFacts.map((fact) => [fact.factRef, fact]));
  const declaredFactRefs = new Set(input.factRefs);
  const planEvidenceRefs = new Set(input.actionPlan.evidenceRefs);
  for (const ref of input.factRefs) {
    if (!factsByRef.has(ref)) reasons.push('REQUIRED_FACT_MISSING');
    if (planEvidenceRefs.size > 0 && !planEvidenceRefs.has(ref)) reasons.push('FACT_REF_UNDECLARED');
  }
  for (const ref of input.actionPlan.evidenceRefs) {
    if (!declaredFactRefs.has(ref)) reasons.push('FACT_REF_UNDECLARED');
  }
  for (const requiredKey of input.actionPlan.requiredFacts) {
    if (!input.verifiedFacts.some((fact) => fact.key === requiredKey && declaredFactRefs.has(fact.factRef))) reasons.push('REQUIRED_FACT_MISSING');
  }
  for (const fact of input.verifiedFacts) {
    if (fact.accountId !== input.scope.accountId || (fact.conversationId && fact.conversationId !== input.scope.conversationId) || (input.scope.productId && fact.productId && fact.productId !== input.scope.productId) || !sameOrderRefs(input.scope.orderRefs, fact.orderRefs)) reasons.push('FACT_SCOPE_MISMATCH');
    const verifiedAt = Date.parse(fact.verifiedAt);
    const expiresAt = fact.expiresAt ? Date.parse(fact.expiresAt) : Number.NaN;
    const invalidVerifiedAt = !Number.isFinite(verifiedAt) || verifiedAt > nowMs;
    const invalidExpiresAt = fact.expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= verifiedAt || expiresAt <= nowMs);
    const ageExceeded = fact.expiresAt === undefined && Number.isFinite(verifiedAt) && nowMs - verifiedAt > policy.maxFactAgeSeconds * 1_000;
    if (invalidVerifiedAt || invalidExpiresAt || ageExceeded) reasons.push('FACT_STALE');
  }
  for (const claim of input.draftClaims) {
    if (claim.claimType === 'FACTUAL' && claim.factRefs.length === 0) reasons.push('CLAIM_FACT_MISSING');
    for (const ref of claim.factRefs) {
      if (!declaredFactRefs.has(ref) || !factsByRef.has(ref)) reasons.push('CLAIM_FACT_MISSING');
    }
  }
  if (input.outboundSensitive.status === 'detected') {
    if (input.outboundSensitive.redactionApplied !== true) reasons.push('OUTBOUND_SENSITIVE_DETECTED');
    else reasons.push('OUTBOUND_SENSITIVE_REDACTION_INVALID');
  } else if (input.outboundSensitive.status === 'unknown') {
    reasons.push('OUTBOUND_SENSITIVE_UNKNOWN');
  }
  return unique(reasons);
}

function sameOrderRefs(expected: readonly string[] | undefined, actual: readonly string[] | undefined): boolean {
  if (!expected || expected.length === 0) return true;
  const actualSet = new Set(actual ?? []);
  return expected.every((ref) => actualSet.has(ref));
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function isActionKind(value: unknown): value is ActionKind {
  return typeof value === 'string' && AUTO_REPLY_ACTION_KINDS.includes(value as ActionKind);
}
