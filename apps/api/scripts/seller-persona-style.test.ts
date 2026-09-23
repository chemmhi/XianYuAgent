import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStyleEvaluationCases,
  optimizeSellerStylePrompt,
  parseStyleEvaluation,
  validateStylePrompt,
  STYLE_DIMENSIONS,
  type StyleEvaluationCase,
} from './seller-persona-style.ts';
import type { CleanedConversation } from './extract-seller-persona.ts';
import type { ModelClient } from '../src/pi-runtime.ts';

function conversations(count = 10): CleanedConversation[] {
  return Array.from({ length: count }, (_, index) => ({
    conversationId: `conversation-${index + 1}`,
    accountId: 'account-1',
    buyerRef: `buyer-${index + 1}`,
    messages: [
      { id: `buyer-${index + 1}`, role: 'buyer' as const, text: `请问第${index + 1}个问题怎么处理？`, createdAt: `2026-09-21T00:0${index}:00.000Z` },
      { id: `seller-${index + 1}`, role: 'seller' as const, text: `可以的宝，第${index + 1}个问题我先帮你看一下。`, createdAt: `2026-09-21T00:0${index}:01.000Z` },
    ],
  }));
}

function genericPrompt(suffix = ''): string {
  return [
    '你是卖家本人，用自然亲切、直接克制的中文聊天口吻交流。',
    '优先短句、分段和清晰的下一步，先接住核心问题再补充必要信息。',
    '称呼和口头禅只在语境合适时少量使用，不机械重复，不堆叠标点。',
    '根据买家情绪调整语气，焦虑或困惑时先安抚并确认卡点，信息不足时先问关键条件。',
    '保持耐心、专业、像真实人工卖家一样自然，不使用公文腔，不暴露内部实现。',
    '只模仿说话方式，不复用历史问答、具体商品、订单、价格、库存、链接或一次性事实。',
    suffix,
  ].join('\n');
}

function evaluationJson(score: number, cases: StyleEvaluationCase[]): string {
  return JSON.stringify({
    caseScores: cases.map((item) => ({
      caseId: item.caseId,
      overall: score,
      dimensions: Object.fromEntries(STYLE_DIMENSIONS.map((dimension) => [dimension, score])),
      gap: score < 98 ? '句式节奏和称呼使用还不够接近' : '',
    })),
    strengths: ['整体语气自然'],
    gaps: score < 98 ? ['句式节奏仍偏模板化'] : [],
    revisionInstructions: score < 98 ? ['减少模板化句式，保留短句和自然称呼'] : [],
  });
}

test('selects at least ten real dialogue rounds from distinct conversations', () => {
  const result = buildStyleEvaluationCases(conversations(12), 10, () => 0.25);
  assert.equal(result.length, 10);
  assert.equal(new Set(result.map((item) => item.conversationId)).size, 10);
  assert.ok(result.every((item) => item.question.includes('问题')));
  assert.ok(result.every((item) => item.humanAnswer.includes('宝')));
});

test('rejects evaluation runs with fewer than ten real conversations', () => {
  assert.throws(
    () => buildStyleEvaluationCases(conversations(9), 10, () => 0.5),
    /PERSONA_EVALUATION_INSUFFICIENT_DIALOGUES/u,
  );
});

test('rejects prompts that hardcode a historical human answer', () => {
  const input = conversations(10);
  assert.throws(
    () => validateStylePrompt(`${genericPrompt()}\n可以的宝，第1个问题我先帮你看一下。`, input),
    /PERSONA_STYLE_PROMPT_CONTAINS_HISTORICAL_REPLY/u,
  );
  assert.throws(
    () => validateStylePrompt(`${genericPrompt()}\n建议回复：你好`, input),
    /PERSONA_STYLE_PROMPT_CONTAINS_EXAMPLE_SCHEMA/u,
  );
});

test('aggregates all ten style dimensions from case scores', () => {
  const input = buildStyleEvaluationCases(conversations(10), 10, () => 0.5);
  const parsed = parseStyleEvaluation(evaluationJson(99, input), input);
  assert.equal(parsed.overall, 99);
  for (const dimension of STYLE_DIMENSIONS) assert.equal(parsed.dimensions[dimension], 99);
  assert.equal(parsed.caseScores.length, 10);
});

test('rejects an evaluator response that does not score all ten real rounds', () => {
  const input = buildStyleEvaluationCases(conversations(10), 10, () => 0.5);
  const incomplete = JSON.stringify({
    caseScores: input.slice(0, 9).map((item) => ({ caseId: item.caseId, overall: 100, dimensions: Object.fromEntries(STYLE_DIMENSIONS.map((dimension) => [dimension, 100])) })),
  });
  assert.throws(() => parseStyleEvaluation(incomplete, input), /PERSONA_EVALUATION_INCOMPLETE/u);
});

test('keeps iterating until the ten-round similarity threshold is reached', async () => {
  const input = conversations(12);
  const sampled = buildStyleEvaluationCases(input, 10, () => 0.5);
  let call = 0;
  const model: ModelClient = {
    async complete() {
      call += 1;
      if (call === 1) return { content: genericPrompt(), model: 'test-model' };
      if (call >= 2 && call <= 11) return { content: '先确认一下你现在的情况，我帮你看。', model: 'test-model' };
      if (call === 12) return { content: evaluationJson(97, sampled), model: 'test-model' };
      if (call === 13) return { content: genericPrompt('加强句式节奏和称呼的自然变化。'), model: 'test-model' };
      if (call >= 14 && call <= 23) return { content: '可以的宝，我先帮你捋一下当前卡点。', model: 'test-model' };
      return { content: evaluationJson(98.5, sampled), model: 'test-model' };
    },
  };

  const result = await optimizeSellerStylePrompt(model, input, input.map((item) => item.messages.map((message) => `${message.role}：${message.text}`).join('\n')).join('\n\n'), {
    sampleCount: 10,
    threshold: 98,
    maxIterations: 3,
    rng: () => 0.5,
  });
  assert.equal(result.iterations.length, 2);
  assert.equal(result.finalScore, 98.5);
  assert.match(result.prompt, /自然变化/u);
  assert.ok(result.iterations.every((item) => item.sampledCaseIds.length === 10));
});
