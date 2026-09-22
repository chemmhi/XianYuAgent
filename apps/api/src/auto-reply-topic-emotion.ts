import { createId, digestJson } from './security.js';
import { AUTO_REPLY_ACTION_KINDS, type ActionKind, type AutoReplyPolicyStatus, type ConversationState } from './domain.js';

export type TopicRelation = 'current' | 'adjacent' | 'off_topic' | 'new_goal' | 'unknown';
export type EmotionLabel = 'neutral' | 'positive' | 'hesitant' | 'confused' | 'anxious' | 'frustrated' | 'angry' | 'urgent' | 'unknown';
export type EmotionTone = 'NEUTRAL' | 'ACKNOWLEDGE' | 'CALM' | 'CLARIFY';
export type TopicEmotionTransition = 'KEEP_CURRENT' | 'REDIRECT_TO_CURRENT' | 'SWITCH_GOAL';

export interface TopicEmotionPredicate {
  [key: string]: boolean | number | string | readonly (boolean | number | string)[];
}

export interface TopicEmotionActionRule {
  ruleId: string;
  predicate: TopicEmotionPredicate;
  primaryAction: ActionKind;
  transition: TopicEmotionTransition;
  recommendationAllowed: boolean;
  reviewRequestAllowed: boolean;
  tone: EmotionTone;
  questionAllowed: boolean;
  nextState: Record<string, unknown>;
  priority: number;
  specificity: number;
  requiredEvidenceCount: number;
  successCriteria: string[];
  reasonCodes: string[];
}

export interface TopicEmotionGateRule {
  ruleId: string;
  predicate: TopicEmotionPredicate;
  recommendationAllowed: boolean;
  reviewRequestAllowed: boolean;
  priority: number;
  specificity: number;
  requiredEvidenceCount: number;
  reasonCodes: string[];
}

export interface TopicEmotionPolicy {
  policyVersion: string;
  policyHash: string;
  status: AutoReplyPolicyStatus;
  accountScope: string;
  effectiveFrom: string;
  effectiveTo?: string;
  activatedAt?: string;
  immutable: true;
  actionRules: TopicEmotionActionRule[];
  gateRules: TopicEmotionGateRule[];
}

export interface TopicSignalSnapshot {
  relation: TopicRelation;
  explicitNewGoal: boolean;
  safeAdjacentAnswer: boolean;
  consecutiveOffTopicCount: number;
  candidateGoalAvailable: boolean;
  candidateGoalId?: string;
  signals: string[];
  sourceVersion: string;
}

export interface EmotionSignalSnapshot {
  label: EmotionLabel;
  intensity: number;
  confidence: number;
  signals: string[];
  sourceVersion: string;
}

export interface TopicEmotionEvaluationInput {
  accountScope: string;
  conversationId: string;
  currentGoalId?: string;
  topic: TopicSignalSnapshot;
  emotion: EmotionSignalSnapshot;
  signals?: Record<string, unknown>;
  state?: ConversationState;
  policy: TopicEmotionPolicy | undefined;
  now?: Date;
}

export interface TopicEmotionEvent {
  type: 'topic.redirected' | 'topic.switched' | 'emotion.observed';
  decisionId: string;
  accountScope: string;
  conversationId: string;
  policyVersion: string;
  ruleId: string;
  topicRelation: TopicRelation;
  emotionLabel: EmotionLabel;
  emotionIntensity: number;
  emotionConfidence: number;
  signalDigest: string;
  reasonCodes: string[];
  occurredAt: string;
}

export interface TopicEmotionDecision {
  decisionId: string;
  policyVersion: string;
  action: ActionKind;
  transition: TopicEmotionTransition;
  matchedRuleId: string;
  matchedGateRuleId: string;
  tone: EmotionTone;
  questionAllowed: boolean;
  recommendationAllowed: boolean;
  reviewRequestAllowed: boolean;
  reasonCodes: string[];
  evidenceRefs: string[];
  topic: TopicSignalSnapshot;
  emotion: EmotionSignalSnapshot;
  nextStatePatch: Partial<Pick<ConversationState, 'activeGoalId' | 'goalStatus' | 'topicRelation' | 'emotionSnapshot'>>;
  nextState?: ConversationState;
  events: TopicEmotionEvent[];
}

export class TopicEmotionPolicyValidationError extends Error {
  readonly code = 'TOPIC_EMOTION_POLICY_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'TopicEmotionPolicyValidationError';
  }
}

export class TopicEmotionEngineError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'TopicEmotionEngineError';
    this.code = code;
  }
}

export function computeTopicEmotionPolicyHash(config: TopicEmotionPolicy): string {
  const { policyHash: _ignored, ...payload } = config;
  return digestJson(payload);
}

export function withComputedTopicEmotionPolicyHash(config: Omit<TopicEmotionPolicy, 'policyHash'> & { policyHash?: string }): TopicEmotionPolicy {
  const candidate = { ...config, policyHash: '' } as TopicEmotionPolicy;
  return { ...candidate, policyHash: computeTopicEmotionPolicyHash(candidate) };
}

export function validateTopicEmotionPolicy(config: TopicEmotionPolicy): TopicEmotionPolicy {
  if (!config || typeof config !== 'object') throw new TopicEmotionPolicyValidationError('policy config is required');
  if (!config.policyVersion?.trim()) throw new TopicEmotionPolicyValidationError('policyVersion is required');
  if (!config.accountScope?.trim()) throw new TopicEmotionPolicyValidationError('accountScope is required');
  if (config.immutable !== true) throw new TopicEmotionPolicyValidationError('policy must be immutable');
  if (!Number.isFinite(Date.parse(config.effectiveFrom))) throw new TopicEmotionPolicyValidationError('effectiveFrom must be a valid ISO timestamp');
  if (config.effectiveTo !== undefined && (!Number.isFinite(Date.parse(config.effectiveTo)) || Date.parse(config.effectiveTo) <= Date.parse(config.effectiveFrom))) {
    throw new TopicEmotionPolicyValidationError('effectiveTo must be after effectiveFrom');
  }
  if (config.status === 'ACTIVE' && !config.activatedAt) throw new TopicEmotionPolicyValidationError('active policy requires activatedAt');
  if (config.policyHash !== computeTopicEmotionPolicyHash(config)) throw new TopicEmotionPolicyValidationError('policyHash does not match canonical config');
  if (!Array.isArray(config.actionRules) || config.actionRules.length === 0) throw new TopicEmotionPolicyValidationError('actionRules are required');
  if (!Array.isArray(config.gateRules) || config.gateRules.length === 0) throw new TopicEmotionPolicyValidationError('gateRules are required');

  const ruleIds = new Set<string>();
  for (const rule of config.actionRules) {
    validateCommonRule(rule, ruleIds, 'action');
    if (!AUTO_REPLY_ACTION_KINDS.includes(rule.primaryAction)) throw new TopicEmotionPolicyValidationError(`action rule ${rule.ruleId} has an unknown ActionKind`);
    if (rule.primaryAction === 'HANDOFF' || rule.primaryAction === 'REFUSE_SENSITIVE') {
      throw new TopicEmotionPolicyValidationError(`action rule ${rule.ruleId} cannot escalate or refuse sensitive data`);
    }
    if (rule.primaryAction === 'CLARIFY' && rule.questionAllowed !== true) {
      throw new TopicEmotionPolicyValidationError(`clarification rule ${rule.ruleId} must allow one question`);
    }
    if (!['KEEP_CURRENT', 'REDIRECT_TO_CURRENT', 'SWITCH_GOAL'].includes(rule.transition)) throw new TopicEmotionPolicyValidationError(`action rule ${rule.ruleId} has invalid transition`);
    if (!['NEUTRAL', 'ACKNOWLEDGE', 'CALM', 'CLARIFY'].includes(rule.tone)) throw new TopicEmotionPolicyValidationError(`action rule ${rule.ruleId} has invalid tone`);
    if (!rule.nextState || typeof rule.nextState !== 'object' || Array.isArray(rule.nextState)) throw new TopicEmotionPolicyValidationError(`action rule ${rule.ruleId} nextState must be an object`);
  }
  for (const rule of config.gateRules) {
    validateCommonRule(rule, ruleIds, 'gate');
    if (typeof rule.recommendationAllowed !== 'boolean' || typeof rule.reviewRequestAllowed !== 'boolean') throw new TopicEmotionPolicyValidationError(`gate rule ${rule.ruleId} must declare both gates`);
  }
  return config;
}

export class TopicEmotionEngine {
  private readonly policy: TopicEmotionPolicy;

  constructor(policy: TopicEmotionPolicy, private readonly idFactory: () => string = createId) {
    this.policy = validateTopicEmotionPolicy(policy);
  }

  evaluate(input: TopicEmotionEvaluationInput): TopicEmotionDecision {
    const policy = this.policy;
    validateInput(input, policy);
    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    const derivedSignals: Record<string, unknown> = {
      ...(input.signals ?? {}),
      topicRelation: input.topic.relation,
      explicitNewGoal: input.topic.explicitNewGoal,
      safeAdjacentAnswer: input.topic.safeAdjacentAnswer,
      consecutiveOffTopicCount: input.topic.consecutiveOffTopicCount,
      candidateGoalAvailable: input.topic.candidateGoalAvailable,
      emotionLabel: input.emotion.label,
      emotionIntensity: input.emotion.intensity,
      emotionConfidence: input.emotion.confidence,
      ...(input.state ? { awaitingUser: input.state.awaitingUser, goalStatus: input.state.goalStatus } : {}),
    };
    const actionCandidates = policy.actionRules.filter((rule) => matchesPredicate(rule.predicate, derivedSignals));
    if (actionCandidates.length === 0) throw new TopicEmotionEngineError('TOPIC_EMOTION_NO_ACTION_MATCH', 'no topic/emotion action rule matched');
    const gateCandidates = policy.gateRules.filter((rule) => matchesPredicate(rule.predicate, derivedSignals));
    if (gateCandidates.length === 0) throw new TopicEmotionEngineError('TOPIC_EMOTION_NO_GATE_MATCH', 'no topic/emotion gate rule matched');
    const actionRule = [...actionCandidates].sort(compareRules)[0]!;
    const gateRule = [...gateCandidates].sort(compareRules)[0]!;
    const decisionId = this.idFactory();
    const evidenceRefs = unique([...input.topic.signals, ...input.emotion.signals]);
    const reasonCodes = unique([...actionRule.reasonCodes, ...gateRule.reasonCodes]);
    const topic = cloneTopic(input.topic);
    const emotion = cloneEmotion(input.emotion);
    const nextStatePatch: TopicEmotionDecision['nextStatePatch'] = {
      topicRelation: topic.relation,
      emotionSnapshot: {
        label: emotion.label,
        intensity: emotion.intensity,
        confidence: emotion.confidence,
        signals: [...emotion.signals],
        sourceVersion: emotion.sourceVersion,
        observedAt: nowIso,
      },
    };
    if (actionRule.transition === 'SWITCH_GOAL' && input.topic.candidateGoalId) {
      nextStatePatch.activeGoalId = input.topic.candidateGoalId;
      nextStatePatch.goalStatus = 'active';
    }
    const nextState = input.state ? applyStatePatch(input.state, nextStatePatch, nowIso) : undefined;
    const signalDigest = digestJson({ topic, emotion, signals: input.signals ?? {} });
    const events: TopicEmotionEvent[] = [{
      type: 'emotion.observed',
      decisionId,
      accountScope: input.accountScope,
      conversationId: input.conversationId,
      policyVersion: policy.policyVersion,
      ruleId: gateRule.ruleId,
      topicRelation: topic.relation,
      emotionLabel: emotion.label,
      emotionIntensity: emotion.intensity,
      emotionConfidence: emotion.confidence,
      signalDigest,
      reasonCodes: [...gateRule.reasonCodes],
      occurredAt: nowIso,
    }];
    if (actionRule.transition === 'REDIRECT_TO_CURRENT' || actionRule.primaryAction === 'REDIRECT') {
      events.push({
        type: 'topic.redirected',
        decisionId,
        accountScope: input.accountScope,
        conversationId: input.conversationId,
        policyVersion: policy.policyVersion,
        ruleId: actionRule.ruleId,
        topicRelation: topic.relation,
        emotionLabel: emotion.label,
        emotionIntensity: emotion.intensity,
        emotionConfidence: emotion.confidence,
        signalDigest,
        reasonCodes: [...actionRule.reasonCodes],
        occurredAt: nowIso,
      });
    } else if (actionRule.transition === 'SWITCH_GOAL') {
      events.push({
        type: 'topic.switched',
        decisionId,
        accountScope: input.accountScope,
        conversationId: input.conversationId,
        policyVersion: policy.policyVersion,
        ruleId: actionRule.ruleId,
        topicRelation: topic.relation,
        emotionLabel: emotion.label,
        emotionIntensity: emotion.intensity,
        emotionConfidence: emotion.confidence,
        signalDigest,
        reasonCodes: [...actionRule.reasonCodes],
        occurredAt: nowIso,
      });
    }
    return {
      decisionId,
      policyVersion: policy.policyVersion,
      action: actionRule.primaryAction,
      transition: actionRule.transition,
      matchedRuleId: actionRule.ruleId,
      matchedGateRuleId: gateRule.ruleId,
      tone: actionRule.tone,
      questionAllowed: actionRule.questionAllowed,
      recommendationAllowed: actionRule.recommendationAllowed && gateRule.recommendationAllowed,
      reviewRequestAllowed: actionRule.reviewRequestAllowed && gateRule.reviewRequestAllowed,
      reasonCodes,
      evidenceRefs,
      topic,
      emotion,
      nextStatePatch,
      nextState,
      events,
    };
  }
}

function validateCommonRule(rule: { ruleId: string; predicate: TopicEmotionPredicate; priority: number; specificity: number; requiredEvidenceCount: number; reasonCodes: string[] }, ruleIds: Set<string>, kind: string): void {
  if (!rule.ruleId?.trim() || ruleIds.has(rule.ruleId)) throw new TopicEmotionPolicyValidationError(`${kind} rules must have unique ruleId values`);
  ruleIds.add(rule.ruleId);
  if (!rule.predicate || Object.keys(rule.predicate).length === 0) throw new TopicEmotionPolicyValidationError(`${kind} rule ${rule.ruleId} must declare a predicate`);
  if (!Number.isInteger(rule.priority) || rule.priority <= 0) throw new TopicEmotionPolicyValidationError(`${kind} rule ${rule.ruleId} priority must be positive`);
  if (!Number.isInteger(rule.specificity) || rule.specificity < 0) throw new TopicEmotionPolicyValidationError(`${kind} rule ${rule.ruleId} specificity must be non-negative`);
  if (!Number.isInteger(rule.requiredEvidenceCount) || rule.requiredEvidenceCount < 0) throw new TopicEmotionPolicyValidationError(`${kind} rule ${rule.ruleId} requiredEvidenceCount must be non-negative`);
  if (!Array.isArray(rule.reasonCodes) || rule.reasonCodes.some((value) => typeof value !== 'string')) throw new TopicEmotionPolicyValidationError(`${kind} rule ${rule.ruleId} reasonCodes must be string[]`);
}

function validateInput(input: TopicEmotionEvaluationInput, policy: TopicEmotionPolicy): void {
  if (!input.accountScope?.trim() || input.accountScope !== policy.accountScope) throw new TopicEmotionEngineError('TOPIC_EMOTION_ACCOUNT_SCOPE_MISMATCH', 'account scope does not match policy');
  if (!input.conversationId?.trim()) throw new TopicEmotionEngineError('TOPIC_EMOTION_CONVERSATION_REQUIRED');
  if (!input.topic || !['current', 'adjacent', 'off_topic', 'new_goal', 'unknown'].includes(input.topic.relation)) throw new TopicEmotionEngineError('TOPIC_EMOTION_TOPIC_INVALID');
  if (!Number.isInteger(input.topic.consecutiveOffTopicCount) || input.topic.consecutiveOffTopicCount < 0) throw new TopicEmotionEngineError('TOPIC_EMOTION_TOPIC_INVALID');
  if (!input.topic.sourceVersion?.trim() || !Array.isArray(input.topic.signals) || input.topic.signals.some((value) => typeof value !== 'string')) throw new TopicEmotionEngineError('TOPIC_EMOTION_TOPIC_INVALID');
  if (!input.emotion || !['neutral', 'positive', 'hesitant', 'confused', 'anxious', 'frustrated', 'angry', 'urgent', 'unknown'].includes(input.emotion.label)) throw new TopicEmotionEngineError('TOPIC_EMOTION_EMOTION_INVALID');
  if (!Number.isFinite(input.emotion.intensity) || input.emotion.intensity < 0 || input.emotion.intensity > 1 || !Number.isFinite(input.emotion.confidence) || input.emotion.confidence < 0 || input.emotion.confidence > 1) throw new TopicEmotionEngineError('TOPIC_EMOTION_EMOTION_INVALID');
  if (!input.emotion.sourceVersion?.trim() || !Array.isArray(input.emotion.signals) || input.emotion.signals.some((value) => typeof value !== 'string')) throw new TopicEmotionEngineError('TOPIC_EMOTION_EMOTION_INVALID');
  if (input.state && (input.state.accountId !== input.accountScope || input.state.conversationId !== input.conversationId)) throw new TopicEmotionEngineError('TOPIC_EMOTION_STATE_SCOPE_MISMATCH');
}

function matchesPredicate(predicate: TopicEmotionPredicate, signals: Record<string, unknown>): boolean {
  return Object.entries(predicate).every(([key, expected]) => {
    const actual = signals[key];
    if (Array.isArray(expected)) return expected.some((candidate) => Object.is(candidate, actual));
    return Object.is(expected, actual);
  });
}

function compareRules(left: { priority: number; specificity: number; requiredEvidenceCount: number; ruleId: string }, right: { priority: number; specificity: number; requiredEvidenceCount: number; ruleId: string }): number {
  return right.priority - left.priority
    || right.specificity - left.specificity
    || right.requiredEvidenceCount - left.requiredEvidenceCount
    || left.ruleId.localeCompare(right.ruleId);
}

function cloneTopic(topic: TopicSignalSnapshot): TopicSignalSnapshot {
  return { ...topic, signals: [...topic.signals] };
}

function cloneEmotion(emotion: EmotionSignalSnapshot): EmotionSignalSnapshot {
  return { ...emotion, signals: [...emotion.signals] };
}

function applyStatePatch(state: ConversationState, patch: TopicEmotionDecision['nextStatePatch'], nowIso: string): ConversationState {
  return {
    ...state,
    ...(patch.activeGoalId !== undefined ? { activeGoalId: patch.activeGoalId } : {}),
    ...(patch.goalStatus !== undefined ? { goalStatus: patch.goalStatus } : {}),
    topicRelation: patch.topicRelation,
    emotionSnapshot: patch.emotionSnapshot ? { ...patch.emotionSnapshot, signals: [...((patch.emotionSnapshot.signals as string[]) ?? [])] } : undefined,
    transitionAt: nowIso,
    pendingQuestions: (state.pendingQuestions ?? []).map((question) => ({ ...question })),
    recommendationState: state.recommendationState ? { ...state.recommendationState } : undefined,
    processedEventIds: [...(state.processedEventIds ?? [])],
    processedIdempotencyKeys: [...(state.processedIdempotencyKeys ?? [])],
  };
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}
