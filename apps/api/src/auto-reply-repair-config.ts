import { AUTO_REPLY_ACTION_KINDS, type ActionKind, type AutoReplyRepairPolicyBundle, type PolicyConfig } from './domain.js';
import { validatePolicyConfig, withComputedPolicyHash } from './auto-reply-policy.js';

export type AutoReplyRepairMode = 'off' | 'shadow' | 'enforce';
export const DEFAULT_AUTO_REPLY_REPAIR_POLICY_EFFECTIVE_FROM = '2026-09-23T00:00:00.000Z';

export type { AutoReplyRepairPolicyBundle } from './domain.js';

export function resolveAutoReplyRepairMode(value: string | undefined): AutoReplyRepairMode {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'enforce' ? 'enforce' : normalized === 'shadow' ? 'shadow' : 'off';
}

export function parseAutoReplyRepairPolicyBundle(value: string | undefined, accountScope: string): AutoReplyRepairPolicyBundle | undefined {
  if (!value?.trim()) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('AUTO_REPLY_POLICY_JSON_INVALID'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('AUTO_REPLY_POLICY_JSON_INVALID');
  const candidate = parsed as Partial<AutoReplyRepairPolicyBundle>;
  if (!candidate.policyConfig || !candidate.preSendPolicy || !candidate.outcomePolicy) throw new Error('AUTO_REPLY_POLICY_BUNDLE_INVALID');
  const policyConfig = validatePolicyConfig({ ...candidate.policyConfig, accountScope });
  if (candidate.preSendPolicy.policyVersion !== policyConfig.policyVersion || candidate.outcomePolicy.policyVersion !== policyConfig.policyVersion) throw new Error('AUTO_REPLY_POLICY_VERSION_MISMATCH');
  return { policyConfig, preSendPolicy: candidate.preSendPolicy, outcomePolicy: candidate.outcomePolicy };
}

/**
 * Validates a bundle read from the account-level policy registry.
 * Unlike the environment compatibility parser, this path never rewrites the
 * account scope and only accepts an ACTIVE policy inside its effective window.
 */
export function validatePersistedAutoReplyRepairPolicyBundle(
  bundle: AutoReplyRepairPolicyBundle,
  accountScope: string,
  now = new Date(),
): AutoReplyRepairPolicyBundle {
  if (!bundle || typeof bundle !== 'object' || !bundle.policyConfig || !bundle.preSendPolicy || !bundle.outcomePolicy) {
    throw new Error('AUTO_REPLY_POLICY_BUNDLE_INVALID');
  }
  const policyConfig = validatePolicyConfig(bundle.policyConfig);
  if (policyConfig.accountScope !== accountScope) throw new Error('AUTO_REPLY_POLICY_ACCOUNT_SCOPE_MISMATCH');
  if (policyConfig.status !== 'ACTIVE') throw new Error('AUTO_REPLY_POLICY_NOT_ACTIVE');
  if (Date.parse(policyConfig.effectiveFrom) > now.getTime()) throw new Error('AUTO_REPLY_POLICY_NOT_EFFECTIVE');
  if (policyConfig.effectiveTo && Date.parse(policyConfig.effectiveTo) <= now.getTime()) throw new Error('AUTO_REPLY_POLICY_EXPIRED');
  if (bundle.preSendPolicy.policyVersion !== policyConfig.policyVersion || bundle.outcomePolicy.policyVersion !== policyConfig.policyVersion) {
    throw new Error('AUTO_REPLY_POLICY_VERSION_MISMATCH');
  }
  return { policyConfig, preSendPolicy: bundle.preSendPolicy, outcomePolicy: bundle.outcomePolicy };
}

export function createDefaultAutoReplyRepairPolicy(accountScope: string, now = new Date()): AutoReplyRepairPolicyBundle {
  const policyVersion = 'ar-vs08-shadow-v1';
  const actionPriority = Object.fromEntries(AUTO_REPLY_ACTION_KINDS.map((action, index) => [action, 1000 - index])) as Record<ActionKind, number>;
  const policyConfig = withComputedPolicyHash({
    policyVersion,
    status: 'ACTIVE',
    accountScope,
    // The seed is versioned and hash-stable. Production should replace this
    // with an account-scoped persisted PolicyConfig before enforce/canary.
    effectiveFrom: DEFAULT_AUTO_REPLY_REPAIR_POLICY_EFFECTIVE_FROM,
    activatedAt: DEFAULT_AUTO_REPLY_REPAIR_POLICY_EFFECTIVE_FROM,
    immutable: true,
    actionPriority,
    actionMutex: [{ left: 'HANDOFF', right: 'REFUSE_SENSITIVE' }],
    precedenceRules: [
      { ruleId: 'SENSITIVE.PURE.001', predicate: { sensitiveClass: 'EQUIVALENT_SECRET', safeBusinessPart: false }, primaryAction: 'REFUSE_SENSITIVE', safetyHandling: 'FULL_REFUSAL', nextState: { goalStatus: 'active' }, priority: 1000, specificity: 100, requiredEvidenceCount: 0, successCriteria: ['敏感片段被明确拒绝'], reasonCodes: ['SENSITIVE_REQUEST'] },
      { ruleId: 'BUYER.CROSS_PRODUCT.001', predicate: { intent: 'cross_product' }, primaryAction: 'RECOMMEND', safetyHandling: 'NONE', nextState: { goalStatus: 'active' }, priority: 700, specificity: 40, requiredEvidenceCount: 0, successCriteria: ['给出同店可选商品'], reasonCodes: ['CROSS_PRODUCT_REQUEST'] },
      { ruleId: 'BUYER.AFTER_SALES.001', predicate: { intent: 'refund' }, primaryAction: 'ACKNOWLEDGE_CONTINUE', safetyHandling: 'NONE', nextState: { goalStatus: 'active' }, priority: 650, specificity: 40, requiredEvidenceCount: 0, successCriteria: ['承接售后问题并继续帮助'], reasonCodes: ['AFTER_SALES_REQUEST'] },
      { ruleId: 'BUYER.COMPLAINT.001', predicate: { intent: 'complaint' }, primaryAction: 'ACKNOWLEDGE_CONTINUE', safetyHandling: 'NONE', nextState: { goalStatus: 'active' }, priority: 640, specificity: 40, requiredEvidenceCount: 0, successCriteria: ['先安抚并继续定位问题'], reasonCodes: ['NEGATIVE_EMOTION'] },
      { ruleId: 'BUYER.PRICE.001', predicate: { intent: 'price' }, primaryAction: 'ANSWER_FACT', safetyHandling: 'NONE', nextState: { goalStatus: 'active' }, priority: 600, specificity: 40, requiredEvidenceCount: 1, successCriteria: ['回答当前价格问题'], reasonCodes: ['FACT_ANSWER'] },
      { ruleId: 'BUYER.AVAILABILITY.001', predicate: { intent: 'availability' }, primaryAction: 'ANSWER_FACT', safetyHandling: 'NONE', nextState: { goalStatus: 'active' }, priority: 590, specificity: 40, requiredEvidenceCount: 1, successCriteria: ['回答当前库存问题'], reasonCodes: ['FACT_ANSWER'] },
      { ruleId: 'BUYER.DELIVERY.001', predicate: { intent: 'delivery' }, primaryAction: 'GUIDE_NEXT_STEP', safetyHandling: 'NONE', nextState: { goalStatus: 'active' }, priority: 580, specificity: 40, requiredEvidenceCount: 0, successCriteria: ['给出下一步交付指引'], reasonCodes: ['LIFECYCLE_GUIDANCE'] },
      { ruleId: 'BUYER.GENERAL.001', predicate: { intent: 'general' }, primaryAction: 'ACKNOWLEDGE_CONTINUE', safetyHandling: 'NONE', nextState: { goalStatus: 'active' }, priority: 500, specificity: 20, requiredEvidenceCount: 0, successCriteria: ['承接买家问题并继续帮助'], reasonCodes: ['GENERAL_CONTINUATION'] },
      { ruleId: 'BUYER.CLARIFY.001', predicate: { intent: 'other' }, primaryAction: 'CLARIFY', safetyHandling: 'NONE', nextState: { goalStatus: 'active', awaitingUser: true }, priority: 400, specificity: 20, requiredEvidenceCount: 0, successCriteria: ['补齐继续处理所需信息'], reasonCodes: ['CLARIFICATION_REQUIRED'] },
      { ruleId: 'BUYER.INJECTION.001', predicate: { intent: 'prompt_injection' }, primaryAction: 'ACKNOWLEDGE_CONTINUE', safetyHandling: 'NONE', nextState: { goalStatus: 'active' }, priority: 300, specificity: 30, requiredEvidenceCount: 0, successCriteria: ['不泄露内部指令并继续安全帮助'], reasonCodes: ['PROMPT_INJECTION_CONTAINED'] },
    ],
    clarification: { maxQuestionsPerTurn: 1, maxRounds: 2, awaitingUserTtlSeconds: 900 },
    handoff: { allowedReasonCodes: ['USER_REQUESTED_HUMAN', 'FACTS_UNAVAILABLE'], factUnavailable: { minAttempts: 2, windowSeconds: 300, deadlineSeconds: 60, requiredSourceIds: ['catalog', 'orders'], requiredErrorCodes: ['NOT_FOUND'] } },
    resolution: { reopenWindowSeconds: 900, reopenEvidenceTypes: ['BUYER_DENIED', 'REPEAT_QUESTION'], closeRequiresWindow: true },
    review: { leaseSeconds: 60, maxAttempts: 3, backoffSeconds: [10, 30, 60] },
  });
  return {
    policyConfig,
    preSendPolicy: {
      policyVersion,
      preSend: {
        maxRevisionAttempts: 1,
        maxFactAgeSeconds: 900,
        allowedActionKinds: ['ANSWER_FACT', 'GUIDE_NEXT_STEP', 'CLARIFY', 'ACKNOWLEDGE_CONTINUE', 'RECOMMEND', 'HANDOFF', 'REFUSE_SENSITIVE'],
        fallbackActionAllowlist: ['CLARIFY', 'ACKNOWLEDGE_CONTINUE', 'REFUSE_SENSITIVE'],
        missingFactsAction: 'CLARIFY',
        validationFailureAction: 'ACKNOWLEDGE_CONTINUE',
        sensitiveFailureAction: 'REFUSE_SENSITIVE',
        allowedHandoffReasonCodes: ['USER_REQUESTED_HUMAN', 'FACTS_UNAVAILABLE'],
      },
    },
    outcomePolicy: {
      policyVersion,
      leaseSeconds: 60,
      maxAttempts: 3,
      backoffSeconds: [10, 30, 60],
      reopenWindowSeconds: 900,
      evidenceWindowSeconds: 60,
      closeRequiresWindow: true,
      resolvingEvidencePriority: ['DOMAIN_FACT_SATISFIED', 'BUYER_CONFIRMED', 'HUMAN_OVERRIDE'],
      reopenEvidenceTypes: ['BUYER_DENIED', 'REPEAT_QUESTION'],
    },
  };
}
