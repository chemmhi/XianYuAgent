import type { AutoReplyClassification, AutoReplyContext, AutoReplyGeneratedReply } from './auto-reply.js';
import { AutoReplyRepairOrchestrator } from './auto-reply-repair-orchestrator.js';
import type { AutoReplyRepairMode, AutoReplyRepairPolicyBundle } from './auto-reply-repair-config.js';
import { AutoReplyRepairRepository, type PersistedRepairArtifact, type PersistedRepairReviewEvent, type PersistedRepairReviewRecord } from './auto-reply-repair-repository.js';
import { ConversationStateReducer } from './auto-reply-state.js';
import { OutcomeReviewWorker, type OutcomeReviewWorkerOptions } from './auto-reply-outcome-review-worker.js';
import { PolicyEngine } from './auto-reply-policy.js';
import type { ConversationState, MessageRecord, Store } from './domain.js';
import { createId, digestJson } from './security.js';

export interface AutoReplyRepairCandidateInput {
  adminId: string;
  runId: string;
  conversation: AutoReplyContext['conversation'];
  inboundMessage: MessageRecord;
  context: AutoReplyContext;
  classification: AutoReplyClassification;
  reply: AutoReplyGeneratedReply;
  requestId: string;
  traceId: string;
  sourceEventId?: string;
  sourceSequence?: number;
}

export interface AutoReplyRepairCandidateResult {
  mode: AutoReplyRepairMode;
  policyDecisionId: string;
  primaryAction: string;
  stateId: string;
  stateVersion: number;
  preSendDecision: string;
  outcomeReviewId?: string;
  resolutionStatus?: string;
  safetyHandling?: string;
  policyHash?: string;
}

export interface AutoReplyRepairRouteResult {
  policyDecisionId: string;
  primaryAction: string;
  safetyHandling: string;
  policyVersion: string;
  policyHash: string;
  reasonCodes: string[];
}

type OutcomeReviewWorkerFactoryOptions = Omit<OutcomeReviewWorkerOptions, 'workerId' | 'policyProvider'> & {
  workerId?: string;
  policyProvider?: OutcomeReviewWorkerOptions['policyProvider'];
};

export class AutoReplyRepairRuntime {
  private readonly repository: AutoReplyRepairRepository;
  private readonly reducer = new ConversationStateReducer();
  private readonly orchestrator = new AutoReplyRepairOrchestrator();

  constructor(private readonly store: Store, private readonly mode: AutoReplyRepairMode, private readonly policyProvider?: (accountId: string, now: Date) => Promise<AutoReplyRepairPolicyBundle | undefined> | AutoReplyRepairPolicyBundle | undefined) {
    this.repository = new AutoReplyRepairRepository(store);
  }

  get enabled(): boolean { return true; }
  get currentMode(): AutoReplyRepairMode { return this.mode; }

  async routeInbound(input: Pick<AutoReplyRepairCandidateInput, 'conversation' | 'inboundMessage' | 'context' | 'classification'>): Promise<AutoReplyRepairRouteResult | undefined> {
    const now = new Date();
    const bundle = await this.resolvePolicyBundle(input.conversation.accountId, now);
    if (!bundle) throw new Error('POLICY_CONFIG_UNAVAILABLE');
    const current = await this.repository.getConversationState(input.conversation.accountId, input.conversation.id);
    const state = current ?? this.reducer.createInitial({ accountId: input.conversation.accountId, conversationId: input.conversation.id, now: input.inboundMessage.createdAt, policyVersion: bundle.policyConfig.policyVersion });
    const verifiedFacts = factsFromContext(input.context, now.toISOString());
    const objective = { objectiveId: current?.activeGoalId ?? createId(), accountId: input.conversation.accountId, conversationId: input.conversation.id, goalType: 'buyer_support', status: 'active' as const, successCriteria: ['买家问题已被承接'], sourceMessageId: input.inboundMessage.id, createdAt: input.inboundMessage.createdAt, updatedAt: now.toISOString() };
    const text = input.inboundMessage.bodyText ?? '';
    const sensitive = /(?:cookie|api\s*key|access[_ -]?token|验证码|密码|秘钥|密钥)/i.test(text);
    const safeBusinessPart = sensitive && /(?:价格|多少钱|优惠|库存|有货|发货|多久|订单|退款|售后|商品|链接)/i.test(text);
    const intent = input.classification.intent === 'credential_request' && safeBusinessPart ? 'general' : input.classification.intent;
    const result = new PolicyEngine(bundle.policyConfig).evaluate({ signals: { intent, factQuestion: ['price', 'availability', 'delivery'].includes(intent), currentGoalFactsSufficient: verifiedFacts.length > 0, sensitiveClass: sensitive ? 'EQUIVALENT_SECRET' : 'NONE', safeBusinessPart, requiredFacts: verifiedFacts.map((fact) => fact.key), evidenceRefs: verifiedFacts.map((fact) => fact.factRef) }, verifiedFacts, conversationState: state, objective, accountScope: input.conversation.accountId, now });
    return { policyDecisionId: result.trace.policyDecisionId, primaryAction: result.actionPlan.primaryAction, safetyHandling: result.actionPlan.safetyHandling, policyVersion: bundle.policyConfig.policyVersion, policyHash: bundle.policyConfig.policyHash, reasonCodes: result.actionPlan.reasonCodes };
  }

  async reviewCandidate(input: AutoReplyRepairCandidateInput): Promise<AutoReplyRepairCandidateResult | undefined> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.reviewCandidateOnce(input);
      } catch (error) {
        if (toRepairErrorCode(error) !== 'REPAIR_STATE_VERSION_CONFLICT' || attempt >= 2) throw error;
        await delay(10 * (attempt + 1));
      }
    }
    return undefined;
  }

  private async reviewCandidateOnce(input: AutoReplyRepairCandidateInput): Promise<AutoReplyRepairCandidateResult | undefined> {
    const now = new Date();
    const bundle = await this.resolvePolicyBundle(input.conversation.accountId, now);
    if (!bundle) throw new Error('POLICY_CONFIG_UNAVAILABLE');
    const current = await this.repository.getConversationState(input.conversation.accountId, input.conversation.id);
    const goalId = current?.activeGoalId ?? createId();
    const sourceEventId = input.sourceEventId?.trim() || input.inboundMessage.externalMessageRef || input.inboundMessage.id;
    const sourceSequence = input.sourceSequence ?? stableSourceSequence(sourceEventId, input.inboundMessage.createdAt);
    const reduced = this.reducer.reduce({
      current,
      expectedStateVersion: current?.stateVersion ?? 0,
      event: {
        eventId: `repair:inbound:${sourceEventId}`,
        accountId: input.conversation.accountId,
        conversationId: input.conversation.id,
        sourceEventId,
        sourceSequence,
        idempotencyKey: `repair:state:${sourceEventId}`,
        occurredAt: input.inboundMessage.createdAt,
        policyVersion: bundle.policyConfig.policyVersion,
        patch: {
          activeGoalId: goalId,
          goalStatus: 'active',
          observedStage: input.context.orders.length > 0 ? 'order_context' : 'product_context',
          targetStage: 'buyer_question',
          topicRelation: 'on_topic',
          lastMessageId: input.inboundMessage.id,
        },
      },
      now: now.toISOString(),
    });
    if (reduced.status !== 'applied') return undefined;
    const state = reduced.state;
    const objective = {
      objectiveId: goalId,
      accountId: input.conversation.accountId,
      conversationId: input.conversation.id,
      goalType: 'buyer_support',
      status: 'active' as const,
      successCriteria: ['买家问题已被承接'],
      sourceMessageId: input.inboundMessage.id,
      createdAt: input.inboundMessage.createdAt,
      updatedAt: now.toISOString(),
    };
    const verifiedFacts = factsFromContext(input.context, now.toISOString());
    const factRefs = verifiedFacts.map((fact) => fact.factRef);
    const text = input.inboundMessage.bodyText ?? '';
    const sensitive = /(?:cookie|api\s*key|access[_ -]?token|验证码|密码|秘钥|密钥)/i.test(text);
    const safeBusinessPart = sensitive && /(?:价格|多少钱|优惠|库存|有货|发货|多久|订单|退款|售后|商品|链接)/i.test(text);
    const intent = input.classification.intent === 'credential_request' && safeBusinessPart ? 'general' : input.classification.intent;
    const signals = {
      intent,
      factQuestion: ['price', 'availability', 'delivery'].includes(intent),
      currentGoalFactsSufficient: verifiedFacts.length > 0,
      sensitiveClass: sensitive ? 'EQUIVALENT_SECRET' : 'NONE',
      safeBusinessPart,
      requiredFacts: verifiedFacts.map((fact) => fact.key),
      evidenceRefs: factRefs,
    };
    const result = await this.orchestrator.execute({
      policyConfig: bundle.policyConfig,
      preSendPolicy: bundle.preSendPolicy,
      outcomePolicy: bundle.outcomePolicy,
      policyEvaluation: { signals, verifiedFacts, conversationState: state, objective, accountScope: input.conversation.accountId, now },
      preSend: {
        runId: input.runId,
        goalId,
        stateId: state.stateId,
        scope: { accountId: input.conversation.accountId, conversationId: input.conversation.id, productId: input.context.product?.id, orderRefs: input.context.orders.map((order) => order.orderNo) },
        verifiedFacts,
        factRefs,
        draftClaims: [{ claimId: `claim:${input.runId}`, claimType: factRefs.length > 0 ? 'FACTUAL' : 'NON_FACTUAL', factRefs }],
        goalCoverage: { requiredCriteria: objective.successCriteria, satisfiedCriteria: objective.successCriteria, missingCriteria: [] },
        outboundSensitive: { status: containsSensitiveReply(input.reply.text) ? 'detected' : 'clean', sensitiveClass: containsSensitiveReply(input.reply.text) ? 'EQUIVALENT_SECRET' : undefined },
        idempotencyKey: `repair:pre:${input.runId}`,
        now,
      },
      // Shadow review must never manufacture transport evidence. The legacy
      // sender runs after this method and owns the real send outcome.
      send: async () => ({ outcome: 'unknown' as const }),
      now,
    });
    const artifacts = this.reviewArtifacts({ input, state, sourceEventId, sourceSequence, policyVersion: bundle.policyConfig.policyVersion, policyHash: bundle.policyConfig.policyHash, result, now });
    await this.repository.persistShadowArtifacts({ state, expectedStateVersion: current?.stateVersion ?? 0, artifacts });
    try {
      await this.store.appendAutoReplyRunEvent({
        runId: input.runId,
        accountId: input.conversation.accountId,
        eventType: 'repair.reviewed',
        stage: 'reply_generation',
        status: 'generated',
        traceId: input.traceId,
        payload: {
          repairMode: this.mode,
          policyDecisionId: result.policy.trace.policyDecisionId,
          primaryAction: result.policy.actionPlan.primaryAction,
          policyHash: bundle.policyConfig.policyHash,
          stateId: state.stateId,
          stateVersion: state.stateVersion,
          preSendDecision: result.preSend.decision,
          outcomeReviewId: result.outcomeReview?.reviewId,
          resolutionStatus: result.outcomeReview?.resolutionStatus,
          inputDigest: digestJson({ runId: input.runId, reply: input.reply.text }),
          sourceEventId,
          sourceSequence,
          sourceSequenceFallback: input.sourceSequence === undefined,
        },
      });
    } catch {
      // Repair telemetry cannot break the response path.
    }
    return {
      mode: this.mode,
      policyDecisionId: result.policy.trace.policyDecisionId,
      primaryAction: result.policy.actionPlan.primaryAction,
      stateId: state.stateId,
      stateVersion: state.stateVersion,
      preSendDecision: result.preSend.decision,
      outcomeReviewId: result.outcomeReview?.reviewId,
      resolutionStatus: result.outcomeReview?.resolutionStatus,
      safetyHandling: result.policy.actionPlan.safetyHandling,
      policyHash: bundle.policyConfig.policyHash,
    };
  }

  async listReviews(accountId: string, conversationId: string): Promise<PersistedRepairReviewRecord[]> {
    return this.repository.listReviews(accountId, conversationId);
  }

  createOutcomeReviewWorker(options: OutcomeReviewWorkerFactoryOptions = {}): OutcomeReviewWorker {
    return new OutcomeReviewWorker(this.repository, {
      workerId: options.workerId ?? 'auto-reply-outcome-worker',
      batchSize: options.batchSize,
      leaseSeconds: options.leaseSeconds,
      pollMs: options.pollMs,
      onError: options.onError,
      evidenceProvider: options.evidenceProvider,
      now: options.now,
      policyProvider: options.policyProvider ?? (async (record) => (await this.resolvePolicyBundle(record.accountId, options.now?.() ?? new Date()))?.outcomePolicy),
    });
  }

  async pollOutcomeReviews(options: OutcomeReviewWorkerFactoryOptions = {}): Promise<Awaited<ReturnType<OutcomeReviewWorker['pollOnce']>>> {
    return this.createOutcomeReviewWorker(options).pollOnce();
  }

  async reconcileSendOutcome(input: { outcomeReviewId?: string; outcome: 'simulated' | 'known_success' | 'known_failure' | 'unknown'; externalMessageRef?: string }): Promise<void> {
    if (!input.outcomeReviewId) return;
    const current = await this.repository.getReview(input.outcomeReviewId);
    if (!current || current.reviewType !== 'OUTCOME' || ['resolved', 'closed', 'review_failed'].includes(current.resolutionStatus)) return;
    const state = await this.repository.getConversationState(current.accountId, current.conversationId);
    const now = new Date().toISOString();
    const next: PersistedRepairReviewRecord = { ...current, reasonCodes: [...current.reasonCodes], evidenceRefs: [...current.evidenceRefs], evidenceTypes: [...current.evidenceTypes] };
    if (input.outcome === 'known_success') {
      const evidenceId = `sender:${input.externalMessageRef ?? current.runId}`;
      next.evidenceRefs = [...new Set([...next.evidenceRefs, evidenceId])];
      next.evidenceTypes = [...new Set([...next.evidenceTypes, 'SENDER_PERSISTED'])];
    } else if (input.outcome === 'known_failure') {
      next.reasonCodes = [...new Set([...next.reasonCodes, 'SENDER_KNOWN_FAILURE'])];
      next.nextAction = 'RECONCILE_SEND';
    } else if (input.outcome === 'unknown') {
      next.reasonCodes = [...new Set([...next.reasonCodes, 'SENDER_OUTCOME_UNKNOWN'])];
      next.nextAction = 'RECONCILE_SEND';
    } else {
      return;
    }
    const eventType = input.outcome === 'known_success' ? 'sender.outcome_persisted' : 'sender.outcome_uncertain';
    const event: PersistedRepairReviewEvent = {
      eventId: createId(),
      reviewId: next.reviewId,
      accountId: next.accountId,
      conversationId: next.conversationId,
      eventType,
      sourceEventId: `sender:${next.runId}`,
      sourceSequence: Math.max(1, next.expectedStateVersion),
      stateVersion: next.expectedStateVersion,
      policyVersion: state?.policyVersion ?? 'unknown',
      idempotencyKey: `repair:sender:${next.reviewId}:${input.outcome}:${input.externalMessageRef ?? 'none'}`,
      occurredAt: now,
      payload: { outcome: input.outcome, externalMessageRef: input.externalMessageRef ?? null },
    };
    await this.repository.applyOutcomeReviewMutation({ record: next, event });
  }

  private async resolvePolicyBundle(accountId: string, now: Date): Promise<AutoReplyRepairPolicyBundle | undefined> {
    const provided = this.policyProvider ? await this.policyProvider(accountId, now) : undefined;
    if (provided) return provided;
    return undefined;
  }

  private reviewArtifacts(args: { input: AutoReplyRepairCandidateInput; state: ConversationState; sourceEventId: string; sourceSequence: number; policyVersion: string; policyHash: string; result: Awaited<ReturnType<AutoReplyRepairOrchestrator['execute']>>; now: Date }): PersistedRepairArtifact[] {
    const { input: candidate, state, sourceEventId, sourceSequence, policyVersion, policyHash, result, now } = args;
    const preSend = result.preSend.record;
    const preRecord: PersistedRepairReviewRecord = {
      reviewId: preSend.reviewId,
      accountId: preSend.accountId,
      conversationId: preSend.conversationId,
      runId: preSend.runId,
      goalId: preSend.goalId,
      stateId: preSend.stateId,
      reviewType: 'PRE_SEND',
      decision: preSend.decision,
      resolutionStatus: preSend.decision === 'APPROVE' ? 'review_pending' : 'unknown',
      reasonCodes: preSend.reasonCodes,
      evidenceRefs: preSend.evidenceRefs,
      evidenceTypes: [],
      reviewerSource: preSend.reviewerSource,
      attempt: preSend.attempt,
      idempotencyKey: preSend.idempotencyKey,
      reviewedAt: preSend.reviewedAt,
      nextAction: preSend.nextAction,
      expectedStateVersion: state.stateVersion,
    };
    const artifacts: PersistedRepairArtifact[] = [{ review: preRecord, event: reviewEvent({ review: preRecord, input: candidate, sourceEventId, sourceSequence, stateVersion: state.stateVersion, policyVersion, eventType: 'pre_send.reviewed', now, payload: { decision: preSend.decision, reasonCodes: preSend.reasonCodes, policyHash } }) }];
    const outcome = result.outcomeReview;
    if (!outcome) return artifacts;
    const outcomeRecord: PersistedRepairReviewRecord = {
      reviewId: outcome.reviewId,
      accountId: outcome.accountId,
      conversationId: outcome.conversationId,
      runId: outcome.runId,
      goalId: outcome.goalId,
      stateId: outcome.stateId,
      reviewType: 'OUTCOME',
      decision: outcome.decision,
      resolutionStatus: outcome.resolutionStatus,
      reasonCodes: [],
      evidenceRefs: outcome.evidenceRefs,
      evidenceTypes: outcome.evidenceTypes,
      evidenceWindowStart: outcome.evidenceWindowStart,
      evidenceWindowEnd: outcome.evidenceWindowEnd,
      reviewerSource: outcome.reviewerSource,
      attempt: outcome.attempt,
      idempotencyKey: outcome.idempotencyKey,
      reviewedAt: outcome.reviewedAt,
      nextReviewAt: outcome.nextReviewAt,
      nextAction: outcome.nextAction,
      expectedStateVersion: outcome.expectedStateVersion,
      supersedesReviewId: outcome.supersedesReviewId,
      deadLetteredAt: outcome.deadLetteredAt,
    };
    artifacts.push({ review: outcomeRecord, event: reviewEvent({ review: outcomeRecord, input: candidate, sourceEventId, sourceSequence, stateVersion: state.stateVersion, policyVersion, eventType: 'outcome.review_pending', now, payload: { resolutionStatus: outcome.resolutionStatus, evidenceTypes: outcome.evidenceTypes, policyHash } }) });
    return artifacts;
  }
}

function reviewEvent(input: { review: PersistedRepairReviewRecord; input: AutoReplyRepairCandidateInput; sourceEventId: string; sourceSequence: number; stateVersion: number; policyVersion: string; eventType: string; now: Date; payload: Record<string, unknown> }): PersistedRepairReviewEvent {
  return { eventId: createId(), reviewId: input.review.reviewId, accountId: input.review.accountId, conversationId: input.review.conversationId, eventType: input.eventType, sourceEventId: input.sourceEventId, sourceSequence: input.sourceSequence, stateVersion: input.stateVersion, policyVersion: input.policyVersion, idempotencyKey: `${input.review.idempotencyKey}:${input.eventType}`, occurredAt: input.now.toISOString(), payload: input.payload };
}

function factsFromContext(context: AutoReplyContext, verifiedAt: string): Array<{ factRef: string; key: string; accountId: string; conversationId: string; productId?: string; orderRefs?: readonly string[]; verifiedAt: string; value?: unknown }> {
  const facts: Array<{ factRef: string; key: string; accountId: string; conversationId: string; productId?: string; orderRefs?: readonly string[]; verifiedAt: string; value?: unknown }> = [];
  if (context.product) {
    facts.push({ factRef: `product:${context.product.id}:title`, key: 'product_title', accountId: context.conversation.accountId, conversationId: context.conversation.id, productId: context.product.id, verifiedAt, value: context.product.title });
    if (context.product.priceMinor !== undefined) facts.push({ factRef: `product:${context.product.id}:price`, key: 'price_minor', accountId: context.conversation.accountId, conversationId: context.conversation.id, productId: context.product.id, verifiedAt, value: context.product.priceMinor });
  }
  for (const order of context.orders) facts.push({ factRef: `order:${order.id}:status`, key: 'order_status', accountId: context.conversation.accountId, conversationId: context.conversation.id, orderRefs: [order.orderNo], verifiedAt, value: { paymentStatus: order.paymentStatus, orderStatus: order.orderStatus, deliveryStatus: order.deliveryStatus, afterSalesStatus: order.afterSalesStatus } });
  return facts;
}

function containsSensitiveReply(value: string): boolean {
  return /(cookie|api\s*key|access[_ -]?token|验证码|密码|秘钥|密钥)/i.test(value);
}

function stableSourceSequence(sourceEventId: string, occurredAt: string): number {
  const timestamp = Date.parse(occurredAt);
  const base = Number.isFinite(timestamp) ? Math.max(1, timestamp) * 1_000 : 1;
  let hash = 0;
  for (const character of sourceEventId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return base + (hash % 1_000);
}

function toRepairErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_:-]{1,64}$/.test(error.message)) return error.message;
  const candidate = error as { code?: unknown } | null;
  return typeof candidate?.code === 'string' ? candidate.code : 'REPAIR_FAILED';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
