export type ReleaseCheckStatus = 'PASS' | 'FAIL' | 'BLOCKED';
export type ReleaseDecisionStatus = 'READY' | 'BLOCKED' | 'ROLLED_BACK';

export interface ReleaseCheck {
  checkId: string;
  status: ReleaseCheckStatus;
  evidenceRef: string;
  details?: string;
}

export interface ReleaseStopCondition {
  metric: string;
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  threshold: number;
  reasonCode: string;
}

export interface ReleasePolicy {
  releaseVersion: string;
  previousPolicyVersion: string;
  canaryPercent: number;
  observationSeconds: number;
  killSwitchRef: string;
  requiredCheckIds: readonly string[];
  stopConditions: readonly ReleaseStopCondition[];
}

export interface ReleaseAssessmentInput {
  policy: ReleasePolicy | undefined;
  checks: readonly ReleaseCheck[];
  metrics: Readonly<Record<string, number>>;
}

export interface ReleaseAssessment {
  status: ReleaseDecisionStatus;
  releaseVersion: string;
  previousPolicyVersion: string;
  stopReasons: string[];
  failedChecks: string[];
  evidenceRefs: string[];
}

export class ReleasePolicyError extends Error {
  readonly code: string;
  constructor(code: string, message = code) {
    super(message);
    this.name = 'ReleasePolicyError';
    this.code = code;
  }
}

export class ReleaseGateEngine {
  assess(input: ReleaseAssessmentInput): ReleaseAssessment {
    const policy = validatePolicy(input.policy);
    const checksById = new Map(input.checks.map((check) => [check.checkId, check]));
    const failedChecks = policy.requiredCheckIds.filter((checkId) => checksById.get(checkId)?.status !== 'PASS');
    const stopReasons = policy.stopConditions.filter((condition) => metricBreached(input.metrics[condition.metric], condition)).map((condition) => condition.reasonCode);
    const status: ReleaseDecisionStatus = failedChecks.length > 0 || stopReasons.length > 0 ? 'BLOCKED' : 'READY';
    return { status, releaseVersion: policy.releaseVersion, previousPolicyVersion: policy.previousPolicyVersion, stopReasons, failedChecks, evidenceRefs: input.checks.map((check) => check.evidenceRef) };
  }

  rollback(policy: ReleasePolicy | undefined, reasonCode: string): ReleaseAssessment {
    const validated = validatePolicy(policy);
    if (!reasonCode.trim()) throw new ReleasePolicyError('RELEASE_ROLLBACK_REASON_REQUIRED');
    return { status: 'ROLLED_BACK', releaseVersion: validated.previousPolicyVersion, previousPolicyVersion: validated.releaseVersion, stopReasons: [reasonCode], failedChecks: [], evidenceRefs: [validated.killSwitchRef] };
  }
}

function validatePolicy(policy: ReleasePolicy | undefined): ReleasePolicy {
  if (!policy?.releaseVersion?.trim() || !policy.previousPolicyVersion?.trim() || !policy.killSwitchRef?.trim()) throw new ReleasePolicyError('RELEASE_POLICY_UNAVAILABLE');
  if (!Number.isInteger(policy.canaryPercent) || policy.canaryPercent <= 0 || policy.canaryPercent > 100 || !Number.isInteger(policy.observationSeconds) || policy.observationSeconds <= 0 || !Array.isArray(policy.requiredCheckIds) || policy.requiredCheckIds.length === 0 || !Array.isArray(policy.stopConditions)) throw new ReleasePolicyError('RELEASE_POLICY_INVALID');
  return policy;
}

function metricBreached(actual: number | undefined, condition: ReleaseStopCondition): boolean {
  if (actual === undefined || !Number.isFinite(actual)) return false;
  if (condition.operator === 'gt') return actual > condition.threshold;
  if (condition.operator === 'gte') return actual >= condition.threshold;
  if (condition.operator === 'lt') return actual < condition.threshold;
  if (condition.operator === 'lte') return actual <= condition.threshold;
  return actual === condition.threshold;
}
