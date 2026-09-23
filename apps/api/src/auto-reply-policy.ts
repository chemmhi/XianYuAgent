import { createId, digestJson, sha256 } from './security.js';
import { AUTO_REPLY_ACTION_KINDS, type ActionKind, type ActionPlan, type ConversationState, type Objective, type PolicyConfig, type PolicyDecisionTrace, type SafetyHandling } from './domain.js';

export interface PolicySignalSet {
  [key: string]: unknown;
  sensitiveClass?: string;
  safeBusinessPart?: boolean;
  requiredFacts?: string[];
  evidenceRefs?: string[];
}

export interface PolicyEvaluationInput {
  signals: PolicySignalSet;
  verifiedFacts: readonly unknown[];
  conversationState: ConversationState;
  objective: Objective;
  accountScope: string;
  now?: Date;
}

export interface PolicyEvaluationResult {
  actionPlan: ActionPlan;
  trace: PolicyDecisionTrace;
  matchedRuleId: string;
}

export class PolicyConfigValidationError extends Error {
  readonly code = 'POLICY_CONFIG_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'PolicyConfigValidationError';
  }
}

export class PolicyEngineError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'PolicyEngineError';
    this.code = code;
  }
}

export function computePolicyHash(config: PolicyConfig): string {
  const { policyHash: _ignored, ...payload } = config;
  // PostgreSQL JSONB does not preserve object insertion order. Hash the
  // canonical key-sorted representation so persisted policy versions keep
  // the same SHA-256 after a storage round-trip.
  return sha256(JSON.stringify(canonicalizePolicyValue(payload)));
}

function canonicalizePolicyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalizePolicyValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalizePolicyValue(item)]));
}

export function withComputedPolicyHash(config: Omit<PolicyConfig, 'policyHash'> & { policyHash?: string }): PolicyConfig {
  const candidate = { ...config, policyHash: '' } as PolicyConfig;
  return { ...candidate, policyHash: computePolicyHash(candidate) };
}

export function validatePolicyConfig(config: PolicyConfig): PolicyConfig {
  if (!config || typeof config !== 'object') throw new PolicyConfigValidationError('policy config is required');
  if (!config.policyVersion.trim()) throw new PolicyConfigValidationError('policyVersion is required');
  if (!config.accountScope.trim()) throw new PolicyConfigValidationError('accountScope is required');
  if (config.immutable !== true) throw new PolicyConfigValidationError('policy must be immutable');
  if (!Number.isFinite(Date.parse(config.effectiveFrom))) throw new PolicyConfigValidationError('effectiveFrom must be a valid ISO timestamp');
  if (config.effectiveTo !== undefined) {
    if (!Number.isFinite(Date.parse(config.effectiveTo)) || Date.parse(config.effectiveTo) <= Date.parse(config.effectiveFrom)) {
      throw new PolicyConfigValidationError('effectiveTo must be after effectiveFrom');
    }
  }
  if (config.status === 'ACTIVE' && !config.activatedAt) throw new PolicyConfigValidationError('active policy requires activatedAt');
  if (config.policyHash !== computePolicyHash(config)) throw new PolicyConfigValidationError('policyHash does not match canonical config');

  const actionKeys = Object.keys(config.actionPriority).sort();
  const expectedKeys = [...AUTO_REPLY_ACTION_KINDS].sort();
  if (actionKeys.length !== expectedKeys.length || actionKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new PolicyConfigValidationError('actionPriority must contain every canonical ActionKind exactly once');
  }
  const priorities = new Set<number>();
  for (const action of AUTO_REPLY_ACTION_KINDS) {
    const priority = config.actionPriority[action];
    if (!Number.isInteger(priority) || priority <= 0 || priorities.has(priority)) throw new PolicyConfigValidationError(`actionPriority for ${action} must be a unique positive integer`);
    priorities.add(priority);
  }

  const mutexKeys = new Set<string>();
  for (const pair of config.actionMutex) {
    if (!AUTO_REPLY_ACTION_KINDS.includes(pair.left) || !AUTO_REPLY_ACTION_KINDS.includes(pair.right) || pair.left === pair.right) throw new PolicyConfigValidationError('actionMutex contains an invalid or self-referential pair');
    const key = [pair.left, pair.right].sort().join(':');
    if (mutexKeys.has(key)) throw new PolicyConfigValidationError('actionMutex contains duplicate pairs');
    mutexKeys.add(key);
  }

  const ruleIds = new Set<string>();
  for (const rule of config.precedenceRules) {
    if (!rule.ruleId.trim() || ruleIds.has(rule.ruleId)) throw new PolicyConfigValidationError('precedenceRules must have unique ruleId values');
    ruleIds.add(rule.ruleId);
    if (!rule.predicate || Object.keys(rule.predicate).length === 0) throw new PolicyConfigValidationError(`rule ${rule.ruleId} must declare a predicate`);
    if (!AUTO_REPLY_ACTION_KINDS.includes(rule.primaryAction)) throw new PolicyConfigValidationError(`rule ${rule.ruleId} has an unknown ActionKind`);
    if (!Number.isInteger(rule.priority) || rule.priority <= 0) throw new PolicyConfigValidationError(`rule ${rule.ruleId} priority must be positive`);
    if (!Number.isInteger(rule.specificity) || rule.specificity < 0) throw new PolicyConfigValidationError(`rule ${rule.ruleId} specificity must be non-negative`);
    if (!Number.isInteger(rule.requiredEvidenceCount) || rule.requiredEvidenceCount < 0) throw new PolicyConfigValidationError(`rule ${rule.ruleId} requiredEvidenceCount must be non-negative`);
    if (!Array.isArray(rule.successCriteria) || rule.successCriteria.some((value) => typeof value !== 'string')) throw new PolicyConfigValidationError(`rule ${rule.ruleId} successCriteria must be string[]`);
    if (!Array.isArray(rule.reasonCodes) || rule.reasonCodes.some((value) => typeof value !== 'string')) throw new PolicyConfigValidationError(`rule ${rule.ruleId} reasonCodes must be string[]`);
    if (!rule.nextState || typeof rule.nextState !== 'object' || Array.isArray(rule.nextState)) throw new PolicyConfigValidationError(`rule ${rule.ruleId} nextState must be an object`);
  }

  if (config.clarification.maxQuestionsPerTurn !== 1 || !Number.isInteger(config.clarification.maxRounds) || config.clarification.maxRounds < 1 || config.clarification.maxRounds > 3 || !Number.isInteger(config.clarification.awaitingUserTtlSeconds) || config.clarification.awaitingUserTtlSeconds <= 0) {
    throw new PolicyConfigValidationError('clarification policy is invalid');
  }
  if (!Array.isArray(config.handoff.allowedReasonCodes) || config.handoff.allowedReasonCodes.length === 0) throw new PolicyConfigValidationError('handoff allowedReasonCodes is required');
  if (!Number.isInteger(config.handoff.factUnavailable.minAttempts) || config.handoff.factUnavailable.minAttempts < 1 || !Number.isInteger(config.handoff.factUnavailable.windowSeconds) || config.handoff.factUnavailable.windowSeconds <= 0 || !Number.isInteger(config.handoff.factUnavailable.deadlineSeconds) || config.handoff.factUnavailable.deadlineSeconds <= 0) throw new PolicyConfigValidationError('handoff.factUnavailable thresholds are invalid');
  if (!Number.isInteger(config.resolution.reopenWindowSeconds) || config.resolution.reopenWindowSeconds <= 0 || !Array.isArray(config.resolution.reopenEvidenceTypes) || config.resolution.reopenEvidenceTypes.length === 0 || config.resolution.closeRequiresWindow !== true) throw new PolicyConfigValidationError('resolution policy is invalid');
  if (!Number.isInteger(config.review.leaseSeconds) || config.review.leaseSeconds <= 0 || !Number.isInteger(config.review.maxAttempts) || config.review.maxAttempts <= 0 || !Array.isArray(config.review.backoffSeconds) || config.review.backoffSeconds.length === 0 || config.review.backoffSeconds.some((value) => !Number.isInteger(value) || value <= 0)) throw new PolicyConfigValidationError('review policy is invalid');
  return config;
}

export class PolicyEngine {
  private readonly policy: PolicyConfig;

  constructor(config: PolicyConfig, private readonly idFactory: () => string = createId) {
    this.policy = validatePolicyConfig(config);
  }

  evaluate(input: PolicyEvaluationInput): PolicyEvaluationResult {
    const candidates = this.policy.precedenceRules.filter((rule) => matchesPredicate(rule.predicate, input.signals));
    if (candidates.length === 0) throw new PolicyEngineError('POLICY_NO_MATCH', 'no precedence rule matched the provided signals');
    candidates.sort(compareRules);
    const selected = candidates[0]!;
    const sensitive = typeof input.signals.sensitiveClass === 'string' && input.signals.sensitiveClass.trim().length > 0 && input.signals.sensitiveClass !== 'NONE';
    const safetyHandling: SafetyHandling = sensitive ? (input.signals.safeBusinessPart === true ? 'PARTIAL_REFUSAL' : 'FULL_REFUSAL') : selected.safetyHandling;
    if (safetyHandling === 'FULL_REFUSAL' && selected.primaryAction !== 'REFUSE_SENSITIVE') throw new PolicyEngineError('POLICY_SENSITIVE_ROUTE_MISSING', 'full sensitive refusal requires REFUSE_SENSITIVE rule');

    const policyDecisionId = this.idFactory();
    const actionPlanId = this.idFactory();
    const stateVersionBefore = input.conversationState.stateVersion;
    const actionPlan: ActionPlan = {
      actionPlanId,
      primaryAction: selected.primaryAction,
      primaryGoal: input.objective,
      requiredFacts: Array.isArray(input.signals.requiredFacts) ? [...input.signals.requiredFacts] : [],
      successCriteria: [...selected.successCriteria],
      allowedTools: [],
      questionBudget: { maxQuestionsPerTurn: this.policy.clarification.maxQuestionsPerTurn, maxRounds: this.policy.clarification.maxRounds },
      recommendationAllowed: selected.primaryAction === 'RECOMMEND',
      handoffAllowed: selected.primaryAction === 'HANDOFF',
      nextState: { ...selected.nextState },
      safetyHandling,
      policyDecisionId,
      policyVersion: this.policy.policyVersion,
      reasonCodes: [...selected.reasonCodes],
      evidenceRefs: Array.isArray(input.signals.evidenceRefs) ? [...input.signals.evidenceRefs] : [],
    };
    const trace: PolicyDecisionTrace = {
      policyDecisionId,
      policyVersion: this.policy.policyVersion,
      ruleId: selected.ruleId,
      precedenceRule: selected.ruleId,
      primaryAction: selected.primaryAction,
      safetyHandling,
      nextState: { ...selected.nextState },
      reasonCodes: [...selected.reasonCodes],
      signalDigest: digestJson(input.signals),
      factDigest: digestJson(input.verifiedFacts),
      accountScope: input.accountScope,
      stateVersionBefore,
      stateVersionAfter: stateVersionBefore + 1,
      actionPlanId,
      createdAt: (input.now ?? new Date()).toISOString(),
    };
    return { actionPlan, trace, matchedRuleId: selected.ruleId };
  }
}

function matchesPredicate(predicate: PolicyConfig['precedenceRules'][number]['predicate'], signals: PolicySignalSet): boolean {
  return Object.entries(predicate).every(([key, expected]) => {
    const actual = signals[key];
    if (Array.isArray(expected)) return expected.some((candidate) => Object.is(candidate, actual));
    return Object.is(expected, actual);
  });
}

function compareRules(left: PolicyConfig['precedenceRules'][number], right: PolicyConfig['precedenceRules'][number]): number {
  return right.priority - left.priority
    || right.specificity - left.specificity
    || right.requiredEvidenceCount - left.requiredEvidenceCount
    || left.ruleId.localeCompare(right.ruleId);
}
