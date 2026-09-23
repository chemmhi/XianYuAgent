import { digestJson } from './security.js';

export interface RecommendationProduct {
  productId: string;
  accountId: string;
  title: string;
  tags: readonly string[];
  priceMinor?: number;
  inStock: boolean;
  updatedAt: string;
  sourceEventId?: string;
}

export interface RecommendationPolicy {
  policyVersion: string;
  maxItems: number;
  cooldownSeconds: number;
  freshnessSeconds: number;
  allowedTopicRelations: readonly string[];
  blockedGoalStatuses: readonly string[];
  blockedEmotionLabels: readonly string[];
  maxEmotionIntensity: number;
  rankRules: readonly {
    ruleId: string;
    field: 'tag' | 'priceBand' | 'stock';
    value?: string;
    score: number;
  }[];
}

export interface RecommendationRequest {
  accountId: string;
  conversationId: string;
  goalStatus: string;
  topicRelation: string;
  emotion?: { label?: string; intensity?: number };
  buyerPreferenceTags: readonly string[];
  products: readonly RecommendationProduct[];
  previousOffers: readonly { productId: string; offeredAt: string }[];
  policy: RecommendationPolicy | undefined;
  now?: Date;
}

export interface RecommendationCandidate {
  productId: string;
  title: string;
  score: number;
  reasonCodes: string[];
  evidenceRefs: string[];
}

export interface RecommendationResult {
  allowed: boolean;
  reasonCode: 'RECOMMENDED' | 'NO_CANDIDATE' | 'GATED';
  candidates: RecommendationCandidate[];
  policyVersion: string;
  evidenceDigest: string;
}

export class RecommendationPolicyError extends Error {
  readonly code: string;
  constructor(code: string, message = code) {
    super(message);
    this.name = 'RecommendationPolicyError';
    this.code = code;
  }
}

export class RecommendationEngine {
  recommend(input: RecommendationRequest): RecommendationResult {
    const policy = validatePolicy(input.policy);
    const now = input.now ?? new Date();
    const nowMs = now.getTime();
    if (!input.accountId.trim() || !input.conversationId.trim()) throw new RecommendationPolicyError('RECOMMENDATION_SCOPE_REQUIRED');
    if (!Number.isFinite(nowMs)) throw new RecommendationPolicyError('RECOMMENDATION_TIME_INVALID');
    if (!policy.allowedTopicRelations.includes(input.topicRelation) || policy.blockedGoalStatuses.includes(input.goalStatus) || (input.emotion?.label && policy.blockedEmotionLabels.includes(input.emotion.label)) || (input.emotion?.intensity ?? 0) > policy.maxEmotionIntensity) {
      return gated(input, policy);
    }
    const seen = new Set(input.previousOffers.filter((offer) => Number.isFinite(Date.parse(offer.offeredAt)) && nowMs - Date.parse(offer.offeredAt) < policy.cooldownSeconds * 1_000).map((offer) => offer.productId));
    const candidates = input.products
      .filter((product) => product.accountId === input.accountId)
      .filter((product) => product.inStock)
      .filter((product) => !seen.has(product.productId))
      .filter((product) => freshEnough(product.updatedAt, nowMs, policy.freshnessSeconds))
      .map((product) => scoreProduct(product, input.buyerPreferenceTags, policy))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.productId.localeCompare(right.productId))
      .slice(0, policy.maxItems);
    return {
      allowed: candidates.length > 0,
      reasonCode: candidates.length > 0 ? 'RECOMMENDED' : 'NO_CANDIDATE',
      candidates,
      policyVersion: policy.policyVersion,
      evidenceDigest: digestJson({ accountId: input.accountId, conversationId: input.conversationId, candidates: candidates.map((candidate) => candidate.productId) }),
    };
  }
}

function validatePolicy(policy: RecommendationPolicy | undefined): RecommendationPolicy {
  if (!policy?.policyVersion?.trim()) throw new RecommendationPolicyError('RECOMMENDATION_POLICY_UNAVAILABLE');
  if (!Number.isInteger(policy.maxItems) || policy.maxItems < 1 || policy.maxItems > 3 || !Number.isInteger(policy.cooldownSeconds) || policy.cooldownSeconds <= 0 || !Number.isInteger(policy.freshnessSeconds) || policy.freshnessSeconds <= 0 || !Array.isArray(policy.allowedTopicRelations) || !Array.isArray(policy.blockedGoalStatuses) || !Array.isArray(policy.blockedEmotionLabels) || !Number.isFinite(policy.maxEmotionIntensity) || !Array.isArray(policy.rankRules)) throw new RecommendationPolicyError('RECOMMENDATION_POLICY_INVALID');
  return policy;
}

function scoreProduct(product: RecommendationProduct, preferenceTags: readonly string[], policy: RecommendationPolicy): RecommendationCandidate {
  const tags = new Set(product.tags.map((tag) => tag.toLowerCase()));
  const preferences = new Set(preferenceTags.map((tag) => tag.toLowerCase()));
  let score = 0;
  const reasonCodes: string[] = [];
  for (const rule of policy.rankRules) {
    if (rule.field === 'tag' && rule.value && tags.has(rule.value.toLowerCase()) && preferences.has(rule.value.toLowerCase())) {
      score += rule.score;
      reasonCodes.push(rule.ruleId);
    }
    if (rule.field === 'stock' && rule.value === 'in_stock' && product.inStock) {
      score += rule.score;
      reasonCodes.push(rule.ruleId);
    }
  }
  return { productId: product.productId, title: product.title, score, reasonCodes, evidenceRefs: [`product:${product.productId}`, ...(product.sourceEventId ? [`event:${product.sourceEventId}`] : [])] };
}

function freshEnough(value: string, nowMs: number, freshnessSeconds: number): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= nowMs && nowMs - timestamp <= freshnessSeconds * 1_000;
}

function gated(input: RecommendationRequest, policy: RecommendationPolicy): RecommendationResult {
  return { allowed: false, reasonCode: 'GATED', candidates: [], policyVersion: policy.policyVersion, evidenceDigest: digestJson({ accountId: input.accountId, conversationId: input.conversationId, gated: true }) };
}
