import { createId, digestJson } from './security.js';
import type { ActionKind } from './domain.js';

export const LIFECYCLE_STAGES = [
  'discovery',
  'evaluation',
  'purchase_ready',
  'unpaid_order',
  'paid_pending_shipment',
  'shipped_pending_delivery',
  'delivered_pending_review',
  'after_sales',
  'completed',
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];
export type LifecycleConditionOperator = 'equals' | 'in' | 'exists';

export interface LifecycleCondition {
  path: string;
  operator: LifecycleConditionOperator;
  value?: string | number | boolean | readonly (string | number | boolean)[];
}

export interface LifecycleOrderFacts {
  orderRef: string;
  accountId: string;
  buyerId?: string;
  itemId?: string;
  paymentStatus?: string;
  orderStatus?: string;
  deliveryStatus?: string;
  afterSalesStatus?: string;
  buyerConfirmedReceived?: boolean;
  buyerConfirmedSatisfied?: boolean;
  updatedAt?: string;
  sourceEventId?: string;
}

export interface LifecyclePolicyRule {
  ruleId: string;
  priority: number;
  specificity: number;
  conditions: readonly LifecycleCondition[];
  stage: LifecycleStage;
  targetStage: LifecycleStage;
  nextAction: ActionKind;
  successCriteria: readonly string[];
  evidenceKeys: readonly string[];
}

export interface LifecyclePolicy {
  policyVersion: string;
  fallback: {
    stage: LifecycleStage;
    targetStage: LifecycleStage;
    nextAction: ActionKind;
    successCriteria: readonly string[];
  };
  ambiguity: {
    nextAction: ActionKind;
    successCriteria: readonly string[];
  };
  rules: readonly LifecyclePolicyRule[];
  reviewGate: {
    allowedStages: readonly LifecycleStage[];
    nextAction: ActionKind;
  };
}

export interface LifecycleEvaluationInput {
  accountId: string;
  conversationId: string;
  selectedOrderRef?: string;
  facts: readonly LifecycleOrderFacts[];
  policy: LifecyclePolicy | undefined;
  previous?: {
    observedStage?: LifecycleStage;
    targetStage?: LifecycleStage;
    orderRef?: string;
  };
  now?: Date;
}

export interface LifecycleEvaluationResult {
  observedStage: LifecycleStage;
  targetStage: LifecycleStage;
  nextAction: ActionKind;
  successCriteria: string[];
  ruleId: string;
  policyVersion: string;
  orderRef?: string;
  evidenceRefs: string[];
  stageChanged: boolean;
  ambiguous: boolean;
  evidenceDigest: string;
}

export class LifecyclePolicyError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'LifecyclePolicyError';
    this.code = code;
  }
}

export class LifecycleEngine {
  constructor(private readonly idFactory: () => string = createId) {}

  evaluate(input: LifecycleEvaluationInput): LifecycleEvaluationResult {
    const policy = validatePolicy(input.policy);
    if (!input.accountId.trim() || !input.conversationId.trim()) throw new LifecyclePolicyError('LIFECYCLE_SCOPE_REQUIRED');
    const scopedFacts = input.facts.filter((fact) => fact.accountId === input.accountId);
    if (scopedFacts.length !== input.facts.length) throw new LifecyclePolicyError('LIFECYCLE_FACT_SCOPE_MISMATCH');

    const candidates = (input.selectedOrderRef
      ? scopedFacts.filter((fact) => fact.orderRef === input.selectedOrderRef)
      : scopedFacts).flatMap((fact) => matchRules(fact, policy.rules).map((rule) => ({ fact, rule })));
    if (input.selectedOrderRef && candidates.length === 0 && !scopedFacts.some((fact) => fact.orderRef === input.selectedOrderRef)) {
      throw new LifecyclePolicyError('LIFECYCLE_ORDER_NOT_FOUND');
    }

    const distinctTopOrders = new Set(candidates.map((item) => item.fact.orderRef));
    if (!input.selectedOrderRef && distinctTopOrders.size > 1) {
      return this.ambiguousResult(input, policy, [...distinctTopOrders].sort());
    }

    const selected = [...candidates].sort(compareCandidates)[0];
    if (!selected) {
      return this.fallbackResult(input, policy);
    }
    const evidenceRefs = buildEvidenceRefs(selected.fact, selected.rule);
    const stageChanged = input.previous?.observedStage !== selected.rule.stage || input.previous?.orderRef !== selected.fact.orderRef;
    return {
      observedStage: selected.rule.stage,
      targetStage: selected.rule.targetStage,
      nextAction: selected.rule.nextAction,
      successCriteria: [...selected.rule.successCriteria],
      ruleId: selected.rule.ruleId,
      policyVersion: policy.policyVersion,
      orderRef: selected.fact.orderRef,
      evidenceRefs,
      stageChanged,
      ambiguous: false,
      evidenceDigest: digestJson({ accountId: input.accountId, conversationId: input.conversationId, orderRef: selected.fact.orderRef, evidenceRefs }),
    };
  }

  private fallbackResult(input: LifecycleEvaluationInput, policy: LifecyclePolicy): LifecycleEvaluationResult {
    const fallback = policy.fallback;
    return {
      observedStage: fallback.stage,
      targetStage: fallback.targetStage,
      nextAction: fallback.nextAction,
      successCriteria: [...fallback.successCriteria],
      ruleId: 'fallback',
      policyVersion: policy.policyVersion,
      evidenceRefs: [],
      stageChanged: input.previous?.observedStage !== fallback.stage,
      ambiguous: false,
      evidenceDigest: digestJson({ accountId: input.accountId, conversationId: input.conversationId, fallback: true }),
    };
  }

  private ambiguousResult(input: LifecycleEvaluationInput, policy: LifecyclePolicy, orderRefs: string[]): LifecycleEvaluationResult {
    return {
      observedStage: input.previous?.observedStage ?? policy.fallback.stage,
      targetStage: input.previous?.targetStage ?? policy.fallback.targetStage,
      nextAction: policy.ambiguity.nextAction,
      successCriteria: [...policy.ambiguity.successCriteria],
      ruleId: 'ambiguous-order',
      policyVersion: policy.policyVersion,
      evidenceRefs: orderRefs.map((orderRef) => `order:${orderRef}`),
      stageChanged: false,
      ambiguous: true,
      evidenceDigest: digestJson({ accountId: input.accountId, conversationId: input.conversationId, ambiguousOrderRefs: orderRefs }),
    };
  }
}

function validatePolicy(policy: LifecyclePolicy | undefined): LifecyclePolicy {
  if (!policy?.policyVersion?.trim()) throw new LifecyclePolicyError('LIFECYCLE_POLICY_UNAVAILABLE');
  if (!policy.fallback || !isStage(policy.fallback.stage) || !isStage(policy.fallback.targetStage) || !Array.isArray(policy.fallback.successCriteria)) {
    throw new LifecyclePolicyError('LIFECYCLE_POLICY_INVALID');
  }
  if (!policy.ambiguity || !Array.isArray(policy.ambiguity.successCriteria)) throw new LifecyclePolicyError('LIFECYCLE_POLICY_INVALID');
  if (!Array.isArray(policy.rules)) throw new LifecyclePolicyError('LIFECYCLE_POLICY_INVALID');
  const seen = new Set<string>();
  for (const rule of policy.rules) {
    if (!rule.ruleId.trim() || seen.has(rule.ruleId) || !Number.isInteger(rule.priority) || rule.priority <= 0 || !Number.isInteger(rule.specificity) || rule.specificity < 0 || !isStage(rule.stage) || !isStage(rule.targetStage) || !Array.isArray(rule.conditions) || !Array.isArray(rule.successCriteria) || !Array.isArray(rule.evidenceKeys)) {
      throw new LifecyclePolicyError('LIFECYCLE_POLICY_INVALID');
    }
    seen.add(rule.ruleId);
  }
  if (!policy.reviewGate || !Array.isArray(policy.reviewGate.allowedStages)) throw new LifecyclePolicyError('LIFECYCLE_POLICY_INVALID');
  return policy;
}

function matchRules(fact: LifecycleOrderFacts, rules: readonly LifecyclePolicyRule[]): LifecyclePolicyRule[] {
  return rules.filter((rule) => rule.conditions.every((condition) => conditionMatches(fact, condition)));
}

function conditionMatches(fact: LifecycleOrderFacts, condition: LifecycleCondition): boolean {
  const actual = readPath(fact, condition.path);
  if (condition.operator === 'exists') return (actual !== undefined) === Boolean(condition.value ?? true);
  if (condition.operator === 'in') return Array.isArray(condition.value) && condition.value.some((candidate) => Object.is(candidate, actual));
  return Object.is(actual, condition.value);
}

function readPath(target: object, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => current && typeof current === 'object' ? (current as Record<string, unknown>)[segment] : undefined, target);
}

function compareCandidates(left: { fact: LifecycleOrderFacts; rule: LifecyclePolicyRule }, right: { fact: LifecycleOrderFacts; rule: LifecyclePolicyRule }): number {
  return right.rule.priority - left.rule.priority
    || right.rule.specificity - left.rule.specificity
    || right.rule.conditions.length - left.rule.conditions.length
    || left.rule.ruleId.localeCompare(right.rule.ruleId)
    || left.fact.orderRef.localeCompare(right.fact.orderRef);
}

function buildEvidenceRefs(fact: LifecycleOrderFacts, rule: LifecyclePolicyRule): string[] {
  const base = rule.evidenceKeys.map((key) => `${fact.orderRef}:${key}`);
  return [...new Set([`order:${fact.orderRef}`, ...base, ...(fact.sourceEventId ? [`event:${fact.sourceEventId}`] : [])])];
}

function isStage(value: unknown): value is LifecycleStage {
  return typeof value === 'string' && (LIFECYCLE_STAGES as readonly string[]).includes(value);
}
