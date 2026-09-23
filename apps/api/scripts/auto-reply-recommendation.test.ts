import assert from 'node:assert/strict';
import test from 'node:test';
import { RecommendationEngine, RecommendationPolicyError, type RecommendationPolicy } from '../src/auto-reply-recommendation.js';

const policy: RecommendationPolicy = {
  policyVersion: 'recommendation-v1',
  maxItems: 2,
  cooldownSeconds: 3_600,
  freshnessSeconds: 900,
  allowedTopicRelations: ['adjacent', 'new_goal'],
  blockedGoalStatuses: ['awaiting_user', 'needs_followup', 'unresolved', 'handoff'],
  blockedEmotionLabels: ['angry', 'anxious', 'confused'],
  maxEmotionIntensity: 0.6,
  rankRules: [
    { ruleId: 'tag-match', field: 'tag', value: 'wireless', score: 10 },
    { ruleId: 'stock-confirmed', field: 'stock', value: 'in_stock', score: 1 },
  ],
};

const now = new Date('2026-09-22T01:00:00.000Z');

test('recommends only fresh same-account products and caps candidates', () => {
  const result = new RecommendationEngine().recommend({
    accountId: 'account-1', conversationId: 'conversation-1', goalStatus: 'active', topicRelation: 'adjacent', buyerPreferenceTags: ['wireless'], policy, now,
    products: [
      { productId: 'p-1', accountId: 'account-1', title: '无线耳机 A', tags: ['wireless'], inStock: true, updatedAt: '2026-09-22T00:55:00.000Z', sourceEventId: 'event-1' },
      { productId: 'p-2', accountId: 'account-1', title: '无线耳机 B', tags: ['wireless'], inStock: true, updatedAt: '2026-09-22T00:50:00.000Z' },
      { productId: 'p-3', accountId: 'account-1', title: '过期商品', tags: ['wireless'], inStock: true, updatedAt: '2026-09-20T00:00:00.000Z' },
      { productId: 'foreign', accountId: 'account-2', title: '别的账号', tags: ['wireless'], inStock: true, updatedAt: '2026-09-22T00:55:00.000Z' },
    ],
    previousOffers: [],
  });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.candidates.map((candidate) => candidate.productId), ['p-1', 'p-2']);
  assert.ok(result.candidates[0]?.evidenceRefs.includes('event:event-1'));
});

test('negative emotion and clarification states gate recommendations', () => {
  const engine = new RecommendationEngine();
  const negative = engine.recommend({ accountId: 'account-1', conversationId: 'conversation-1', goalStatus: 'active', topicRelation: 'adjacent', emotion: { label: 'angry', intensity: 0.9 }, buyerPreferenceTags: ['wireless'], policy, products: [], previousOffers: [], now });
  assert.equal(negative.reasonCode, 'GATED');
  const waiting = engine.recommend({ accountId: 'account-1', conversationId: 'conversation-1', goalStatus: 'awaiting_user', topicRelation: 'adjacent', buyerPreferenceTags: ['wireless'], policy, products: [], previousOffers: [], now });
  assert.equal(waiting.reasonCode, 'GATED');
});

test('cooldown prevents repeated exposure and no matching preference returns no candidate', () => {
  const result = new RecommendationEngine().recommend({
    accountId: 'account-1', conversationId: 'conversation-1', goalStatus: 'active', topicRelation: 'new_goal', buyerPreferenceTags: ['camera'], policy, now,
    products: [{ productId: 'p-1', accountId: 'account-1', title: '无线耳机', tags: ['wireless'], inStock: true, updatedAt: '2026-09-22T00:55:00.000Z' }],
    previousOffers: [{ productId: 'p-1', offeredAt: '2026-09-22T00:45:00.000Z' }],
  });
  assert.equal(result.reasonCode, 'NO_CANDIDATE');
});

test('missing policy fails closed instead of inventing recommendation routing', () => {
  assert.throws(() => new RecommendationEngine().recommend({ accountId: 'account-1', conversationId: 'conversation-1', goalStatus: 'active', topicRelation: 'adjacent', buyerPreferenceTags: [], products: [], previousOffers: [], policy: undefined, now }), (error: unknown) => error instanceof RecommendationPolicyError && error.code === 'RECOMMENDATION_POLICY_UNAVAILABLE');
});
