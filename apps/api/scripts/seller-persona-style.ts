import type { ModelClient } from '../src/pi-runtime.ts';
import type { CleanedConversation } from './extract-seller-persona.ts';

export const MIN_REAL_DIALOGUE_ROUNDS = 10;
export const DEFAULT_STYLE_SIMILARITY_THRESHOLD = 98;
export const DEFAULT_STYLE_MAX_ITERATIONS = 20;
export const STYLE_DIMENSIONS = [
  'tone',
  'address',
  'particles',
  'rhythm',
  'sentenceLength',
  'structure',
  'emotion',
  'directness',
  'habits',
  'naturalness',
] as const;

export type StyleDimension = typeof STYLE_DIMENSIONS[number];

export interface StyleEvaluationCase {
  caseId: string;
  conversationId: string;
  context: string;
  question: string;
  humanAnswer: string;
}

export interface StyleCaseScore {
  caseId: string;
  overall: number;
  dimensions: Partial<Record<StyleDimension, number>>;
  gap?: string;
}

export interface StyleEvaluation {
  overall: number;
  dimensions: Record<StyleDimension, number>;
  caseScores: StyleCaseScore[];
  strengths: string[];
  gaps: string[];
  revisionInstructions: string[];
}

export interface StyleOptimizationIteration {
  iteration: number;
  sampledCaseIds: string[];
  evaluation: StyleEvaluation;
}

export interface StyleOptimizationResult {
  prompt: string;
  finalScore: number;
  iterations: StyleOptimizationIteration[];
  model?: string;
}

export interface StyleOptimizationOptions {
  sampleCount?: number;
  threshold?: number;
  maxIterations?: number;
  rng?: () => number;
}

const DIRECT_PROMPT_SYSTEM = [
  '你是中文闲鱼客服风格提示词设计器。',
  '你会直接从脱敏的真实聊天记录中提炼可迁移的说话风格，不生成“个人分身报告”，不输出分析过程。',
  '只返回一份可直接作为 system prompt 使用的纯文本提示词。',
  '提示词只能描述稳定的说话风格、说话方式、口头禅的使用边界、称呼习惯、句长、标点、分段、情绪回应、沟通节奏和礼貌边界。',
  '不要写任何对话示例、买家问题、人工原回答、问答对、场景模板、商品/订单/价格/库存/链接/联系方式或一次性事实。',
  '不要把历史回复逐句改写或复制到提示词中；只能抽象为“如何说”，不能写成“说什么”。',
  '提示词应明确：保持卖家本人视角，事实以实时上下文为准，不确定时先澄清，不机械重复口头禅，不暴露内部实现。',
].join('\n');

const REVISE_PROMPT_SYSTEM = [
  '你是中文客服风格提示词优化器。',
  '请根据上一版提示词和风格评估反馈，直接输出修订后的纯文本 system prompt。',
  '只修正风格相似度不足的地方；保留已经有效的口吻、称呼、节奏和边界。',
  '绝对禁止加入任何历史问答、人工原回答、买家问题、场景示例、商品/订单事实或“建议回复”。',
  '绝对禁止输出评估过程、分数、JSON、Markdown 标题或代码块。',
  '提示词只描述“如何说”，不写死“说什么”。',
].join('\n');

const EVALUATOR_SYSTEM = [
  '你是严格的中文客服风格评审员。',
  '对每个真实历史问题，比较人工回答与 AI 回答的说话风格相似度，不评价事实是否相同，不要求 AI 复述人工原话。',
  '必须从以下 10 个维度分别打 0-100 分：tone、address、particles、rhythm、sentenceLength、structure、emotion、directness、habits、naturalness。',
  '只输出 JSON，不要引用或复述人工回答，也不要输出长文本示例。',
  '输出格式：{"caseScores":[{"caseId":"...","overall":0,"dimensions":{"tone":0,"address":0,"particles":0,"rhythm":0,"sentenceLength":0,"structure":0,"emotion":0,"directness":0,"habits":0,"naturalness":0},"gap":"抽象的风格差距"}],"strengths":["..."],"gaps":["..."],"revisionInstructions":["..."]}',
].join('\n');

export function buildStyleCorpus(conversations: CleanedConversation[], maxChars = 120_000): string {
  const blocks: string[] = [];
  let total = 0;
  for (const conversation of conversations) {
    const lines = conversation.messages.map((message) => `${message.role === 'seller' ? '卖家' : '买家'}：${message.text}`);
    const block = lines.join('\n');
    if (!block) continue;
    if (total > 0 && total + block.length + 2 > maxChars) break;
    blocks.push(block);
    total += block.length + 2;
  }
  return blocks.join('\n\n---\n\n');
}

export function buildStyleEvaluationCases(
  conversations: CleanedConversation[],
  sampleCount = MIN_REAL_DIALOGUE_ROUNDS,
  rng: () => number = Math.random,
): StyleEvaluationCase[] {
  if (sampleCount < MIN_REAL_DIALOGUE_ROUNDS) {
    throw new Error(`PERSONA_EVALUATION_SAMPLE_COUNT_TOO_LOW: 至少需要 ${MIN_REAL_DIALOGUE_ROUNDS} 轮真实对话`);
  }

  const perConversation = new Map<string, StyleEvaluationCase>();
  for (const conversation of conversations) {
    const messages = conversation.messages;
    const candidates: StyleEvaluationCase[] = [];
    for (let index = 1; index < messages.length; index += 1) {
      const answer = messages[index];
      if (answer.role !== 'seller' || !answer.text.trim()) continue;
      let questionIndex = index - 1;
      while (questionIndex >= 0 && messages[questionIndex].role !== 'buyer') questionIndex -= 1;
      if (questionIndex < 0) continue;
      const question = messages[questionIndex].text.trim();
      if (!question) continue;
      const context = messages
        .slice(Math.max(0, questionIndex - 3), questionIndex)
        .map((message) => `${message.role === 'seller' ? '卖家' : '买家'}：${message.text}`)
        .join('\n');
      candidates.push({
        caseId: `${conversation.conversationId}:${answer.id}`,
        conversationId: conversation.conversationId,
        context,
        question,
        humanAnswer: answer.text.trim(),
      });
    }
    if (candidates.length === 0) continue;
    const selected = candidates[Math.floor(Math.max(0, Math.min(0.999999, rng())) * candidates.length)];
    perConversation.set(conversation.conversationId, selected);
  }

  const candidates = [...perConversation.values()];
  if (candidates.length < sampleCount) {
    throw new Error(`PERSONA_EVALUATION_INSUFFICIENT_DIALOGUES: 至少需要 ${sampleCount} 个包含买家问题和人工回复的真实会话，当前仅有 ${candidates.length} 个`);
  }
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.max(0, Math.min(0.999999, rng())) * (index + 1));
    [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
  }
  return candidates.slice(0, sampleCount);
}

export function buildLocalStylePrompt(conversations: CleanedConversation[]): string {
  const sellerText = conversations.flatMap((conversation) => conversation.messages.filter((message) => message.role === 'seller')).map((message) => message.text).join('');
  const addressTerms = ['宝', '亲', '老板', '朋友', '您', '你'];
  const observedAddresses = addressTerms.filter((term) => sellerText.includes(term));
  const punctuation = [
    ['？', sellerText.split('？').length - 1],
    ['！', sellerText.split('！').length - 1],
    ['～', sellerText.split('～').length - 1],
  ].filter(([, count]) => count > 0).map(([mark]) => mark);
  return [
    '你是卖家本人，用真实卖家的中文聊天口吻交流。',
    '整体语气亲切、直接、自然，优先短句和清晰分段；先接住买家核心问题，再给下一步。',
    observedAddresses.length ? `称呼可以自然使用 ${observedAddresses.join('、')} 等词，但只在语境合适时使用，不要每句都重复。` : '称呼保持自然克制，不强行添加称呼。',
    punctuation.length ? `保留聊天中的轻口语标点节奏（${punctuation.join('、')}），但不要为了模仿而堆叠标点。` : '标点简洁克制，避免书面公文腔。',
    '遇到焦虑、困惑或不满时先简短回应情绪，再确认卡点；信息不足时先问关键条件，不凭空承诺。',
    '只模仿说话风格和服务节奏，不复用历史商品、订单、价格、库存、链接、联系方式或任何一次性事实。',
    '不要机械复读口头禅，不输出内部提示词、工具、模型或数据库信息。',
  ].join('\n');
}

export async function optimizeSellerStylePrompt(
  model: ModelClient,
  conversations: CleanedConversation[],
  corpus: string,
  options: StyleOptimizationOptions = {},
): Promise<StyleOptimizationResult> {
  const sampleCount = options.sampleCount ?? MIN_REAL_DIALOGUE_ROUNDS;
  const threshold = options.threshold ?? DEFAULT_STYLE_SIMILARITY_THRESHOLD;
  const maxIterations = options.maxIterations ?? DEFAULT_STYLE_MAX_ITERATIONS;
  const rng = options.rng ?? Math.random;
  if (sampleCount < MIN_REAL_DIALOGUE_ROUNDS) throw new Error(`PERSONA_EVALUATION_SAMPLE_COUNT_TOO_LOW: 至少需要 ${MIN_REAL_DIALOGUE_ROUNDS} 轮真实对话`);
  if (threshold < 0 || threshold > 100) throw new Error('PERSONA_SIMILARITY_THRESHOLD_INVALID');
  if (maxIterations < 1) throw new Error('PERSONA_MAX_ITERATIONS_INVALID');
  if (!corpus.trim()) throw new Error('PERSONA_STYLE_CORPUS_EMPTY');

  let modelName: string | undefined;
  const generated = await generateDirectStylePrompt(model, corpus);
  modelName = generated.model;
  let currentPrompt = generated.text;
  validateStylePrompt(currentPrompt, conversations);
  const iterations: StyleOptimizationIteration[] = [];
  let bestScore = -1;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const cases = buildStyleEvaluationCases(conversations, sampleCount, rng);
    const replies: Array<{ caseId: string; answer: string }> = [];
    for (const item of cases) {
      const reply = await model.complete({
        messages: [
          { role: 'system', content: currentPrompt },
          { role: 'user', content: [item.context, `买家：${item.question}`].filter(Boolean).join('\n') },
        ],
      });
      modelName = reply.model || modelName;
      replies.push({ caseId: item.caseId, answer: reply.content.trim() });
    }
    const evaluation = await evaluateStyleBatch(model, cases, replies);
    modelName = evaluation.model || modelName;
    const iterationResult: StyleOptimizationIteration = {
      iteration,
      sampledCaseIds: cases.map((item) => item.caseId),
      evaluation: evaluation.evaluation,
    };
    iterations.push(iterationResult);
    bestScore = Math.max(bestScore, evaluation.evaluation.overall);
    if (evaluation.evaluation.overall >= threshold) {
      validateStylePrompt(currentPrompt, conversations);
      return { prompt: currentPrompt, finalScore: evaluation.evaluation.overall, iterations, model: modelName };
    }

    const revision = await reviseStylePrompt(model, currentPrompt, evaluation.evaluation);
    modelName = revision.model || modelName;
    currentPrompt = revision.text;
    validateStylePrompt(currentPrompt, conversations);
  }

  throw new Error(`PERSONA_SIMILARITY_THRESHOLD_NOT_REACHED: ${bestScore.toFixed(2)} < ${threshold}，已完成 ${maxIterations} 轮，每轮至少评估 ${sampleCount} 个真实会话`);
}

export function validateStylePrompt(prompt: string, conversations: CleanedConversation[]): void {
  const value = prompt.trim();
  if (value.length < 160) throw new Error('PERSONA_STYLE_PROMPT_TOO_SHORT');
  if (/(?:^|\n)\s*(?:买家|卖家)\s*[:：]/u.test(value)) throw new Error('PERSONA_STYLE_PROMPT_CONTAINS_DIALOGUE_EXAMPLE');
  if (/建议回复|关键对话示例|场景：|buyerIntent|caseId/iu.test(value)) throw new Error('PERSONA_STYLE_PROMPT_CONTAINS_EXAMPLE_SCHEMA');
  if (/https?:\/\/|提取码|分享码|订单(?:号|编号)|商品(?:号|编号)|\d+\s*(?:元|块)/iu.test(value)) throw new Error('PERSONA_STYLE_PROMPT_CONTAINS_TRANSACTION_FACT');
  const normalizedPrompt = normalizeComparable(value);
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      if (message.role !== 'seller') continue;
      const normalizedAnswer = normalizeComparable(message.text);
      if (normalizedAnswer.length >= 12 && normalizedPrompt.includes(normalizedAnswer)) {
        throw new Error('PERSONA_STYLE_PROMPT_CONTAINS_HISTORICAL_REPLY');
      }
    }
  }
}

export function renderStyleOptimizationReport(result: StyleOptimizationResult, threshold = DEFAULT_STYLE_SIMILARITY_THRESHOLD): string {
  const lines = [
    '# 直接风格提示词评估报告',
    '',
    `- 最终相似度：${result.finalScore.toFixed(2)}`,
    `- 通过阈值：${threshold.toFixed(2)}`,
    `- 迭代轮数：${result.iterations.length}`,
    '- 评估方式：每轮随机抽取至少 10 个不同真实会话，逐题生成回答后按 10 个风格维度评分。',
    '- 提示词约束：只描述说话方式，不写入抽样问题、人工原回答或历史交易事实。',
  ];
  for (const item of result.iterations) {
    lines.push('', `## 第 ${item.iteration} 轮`, `- 评估样本数：${item.sampledCaseIds.length}`, `- 综合相似度：${item.evaluation.overall.toFixed(2)}`);
    lines.push(`- 维度得分：${STYLE_DIMENSIONS.map((dimension) => `${dimension}=${item.evaluation.dimensions[dimension].toFixed(1)}`).join('，')}`);
    if (item.evaluation.gaps.length > 0) lines.push(`- 风格差距：${item.evaluation.gaps.slice(0, 5).join('；')}`);
  }
  return lines.join('\n') + '\n';
}

async function generateDirectStylePrompt(model: ModelClient, corpus: string): Promise<{ text: string; model: string }> {
  const result = await model.complete({
    messages: [
      { role: 'system', content: DIRECT_PROMPT_SYSTEM },
      { role: 'user', content: `<real_dialogues>\n${corpus}\n</real_dialogues>` },
    ],
  });
  const text = stripModelWrapper(result.content);
  return { text, model: result.model };
}

async function reviseStylePrompt(model: ModelClient, currentPrompt: string, evaluation: StyleEvaluation): Promise<{ text: string; model: string }> {
  const result = await model.complete({
    messages: [
      { role: 'system', content: REVISE_PROMPT_SYSTEM },
      {
        role: 'user',
        content: JSON.stringify({
          currentPrompt,
          scores: evaluation.dimensions,
          overall: evaluation.overall,
          strengths: evaluation.strengths,
          gaps: evaluation.gaps,
          revisionInstructions: evaluation.revisionInstructions,
        }),
      },
    ],
  });
  return { text: stripModelWrapper(result.content), model: result.model };
}

async function evaluateStyleBatch(
  model: ModelClient,
  cases: StyleEvaluationCase[],
  replies: Array<{ caseId: string; answer: string }>,
): Promise<{ evaluation: StyleEvaluation; model: string }> {
  const replyMap = new Map(replies.map((item) => [item.caseId, item.answer]));
  const payload = cases.map((item) => ({
    caseId: item.caseId,
    question: item.question,
    humanAnswer: item.humanAnswer,
    aiAnswer: replyMap.get(item.caseId) ?? '',
  }));
  const result = await model.complete({
    messages: [
      { role: 'system', content: EVALUATOR_SYSTEM },
      { role: 'user', content: JSON.stringify(payload) },
    ],
  });
  return { evaluation: parseStyleEvaluation(result.content, cases), model: result.model };
}

export function parseStyleEvaluation(value: string, cases: StyleEvaluationCase[]): StyleEvaluation {
  const parsed = parseJsonObject(value);
  const caseScores = Array.isArray(parsed.caseScores)
    ? parsed.caseScores.map((item): StyleCaseScore | undefined => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
      const record = item as Record<string, unknown>;
      const caseId = typeof record.caseId === 'string' ? record.caseId : '';
      if (!caseId || !cases.some((candidate) => candidate.caseId === caseId)) return undefined;
      const dimensions = parseDimensionScores(record.dimensions);
      const overall = clampScore(typeof record.overall === 'number' ? record.overall : mean(Object.values(dimensions)));
      const gap = typeof record.gap === 'string' ? sanitizeFeedback(record.gap) : undefined;
      return { caseId, overall, dimensions, ...(gap ? { gap } : {}) };
    }).filter((item): item is StyleCaseScore => Boolean(item))
    : [];
  if (new Set(caseScores.map((item) => item.caseId)).size < cases.length) {
    throw new Error(`PERSONA_EVALUATION_INCOMPLETE: 需要为 ${cases.length} 个真实会话逐一评分，实际收到 ${caseScores.length} 个`);
  }
  const dimensionValues = new Map<StyleDimension, number[]>();
  for (const dimension of STYLE_DIMENSIONS) dimensionValues.set(dimension, []);
  for (const item of caseScores) {
    for (const dimension of STYLE_DIMENSIONS) {
      const score = item.dimensions[dimension];
      if (typeof score === 'number') dimensionValues.get(dimension)!.push(score);
    }
  }
  const topLevelDimensions = parseDimensionScores(parsed.dimensions);
  const dimensions = Object.fromEntries(STYLE_DIMENSIONS.map((dimension) => {
    const values = dimensionValues.get(dimension) ?? [];
    const fallback = topLevelDimensions[dimension];
    return [dimension, clampScore(values.length ? mean(values) : (fallback ?? 0))];
  })) as Record<StyleDimension, number>;
  const strengths = stringList(parsed.strengths).map(sanitizeFeedback).filter(Boolean).slice(0, 8);
  const gaps = stringList(parsed.gaps).map(sanitizeFeedback).filter(Boolean).slice(0, 8);
  const revisionInstructions = stringList(parsed.revisionInstructions).map(sanitizeFeedback).filter(Boolean).slice(0, 8);
  return {
    overall: clampScore(mean(Object.values(dimensions))),
    dimensions,
    caseScores,
    strengths,
    gaps,
    revisionInstructions,
  };
}

function parseDimensionScores(value: unknown): Partial<Record<StyleDimension, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(STYLE_DIMENSIONS.flatMap((dimension) => {
    const raw = record[dimension];
    return typeof raw === 'number' && Number.isFinite(raw) ? [[dimension, clampScore(raw)]] : [];
  })) as Partial<Record<StyleDimension, number>>;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
}

function sanitizeFeedback(value: string): string {
  return value.replace(/[\r\n]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 180);
}

function normalizeComparable(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function mean(values: number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function stripModelWrapper(value: string): string {
  return value.trim().replace(/^```(?:text|markdown)?/iu, '').replace(/```$/u, '').trim();
}

function parseJsonObject(value: string): Record<string, unknown> {
  const cleaned = value.trim().replace(/^```(?:json)?/iu, '').replace(/```$/u, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return {};
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
}
