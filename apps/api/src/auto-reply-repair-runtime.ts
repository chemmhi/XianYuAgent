import type { AutoReplyClassification, AutoReplyContext, AutoReplyGeneratedReply } from './auto-reply.js';
import { AutoReplyRepairOrchestrator } from './auto-reply-repair-orchestrator.js';
import { createDefaultAutoReplyRepairPolicy, type AutoReplyRepairMode } from './auto-reply-repair-config.js';
import { AutoReplyRepairRepository, type PersistedRepairArtifact, type PersistedRepairReviewEvent, type PersistedRepairReviewRecord } from './auto-reply-repair-repository.js';
import { ConversationStateReducer } from './auto-reply-state.js';
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
}

export class AutoReplyRepairRuntime {
  private readonly repository: AutoReplyRepairRepository;
  private readonly reducer = new ConversationStateReducer();
  private readonly orchestrator = new AutoReplyRepairOrchestrator();

  constructor(private readonly store: Store, private readonly mode: AutoReplyRepairMode) {
    this.repository = new AutoReplyRepairRepository(store);
  }

  get enabled(): boolean { return this.mode !== 'off'; }
  get currentMode(): AutoReplyRepairMode { return this.mode; }

  async reviewCandidate(input: AutoReplyRepairCandidateInput): Promise<AutoReplyRepairCandidateResult | undefined> {
    if (this.mode === 'off') return undefined;
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
    const bundle = createDefaultAutoReplyRepairPolicy(input.conversation.accountId, now);
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
    const signals = {
      intent: input.classification.intent,
      factQuestion: ['price', 'availability', 'delivery'].includes(input.classification.intent),
      currentGoalFactsSufficient: verifiedFacts.length > 0,
      sensitiveClass: input.classification.intent === 'credential_request' ? 'EQUIVALENT_SECRET' : 'NONE',
      safeBusinessPart: input.classification.intent !== 'credential_request',
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
    const artifacts = this.reviewArtifacts({ input, state, sourceEventId, sourceSequence, policyVersion: bundle.policyConfig.policyVersion, result, now });
    await this.repository.persistShadowArtifacts({ state, expectedStateVersion: current?.stateVersion ?? 0, artifacts });
    try {
      await this.store.appendAutoReplyRunEvent({
        runId: input.runId,
        accountId: input.conversation.accountId,
        eventType: 'repair.shadow_reviewed',
        stage: 'reply_generation',
        status: 'generated',
        traceId: input.traceId,
        payload: {
          repairMode: this.mode,
          policyDecisionId: result.policy.trace.policyDecisionId,
          primaryAction: result.policy.actionPlan.primaryAction,
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
      // Shadow telemetry cannot break the legacy response path.
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
    };
  }

  async listReviews(accountId: string, conversationId: string): Promise<PersistedRepairReviewRecord[]> {
    return this.repository.listReviews(accountId, conversationId);
  }

  private reviewArtifacts(args: { input: AutoReplyRepairCandidateInput; state: ConversationState; sourceEventId: string; sourceSequence: number; policyVersion: string; result: Awaited<ReturnType<AutoReplyRepairOrchestrator['execute']>>; now: Date }): PersistedRepairArtifact[] {
    const { input: candidate, state, sourceEventId, sourceSequence, policyVersion, result, now } = args;
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
    const artifacts: PersistedRepairArtifact[] = [{ review: preRecord, event: reviewEvent({ review: preRecord, input: candidate, sourceEventId, sourceSequence, stateVersion: state.stateVersion, policyVersion, eventType: 'pre_send.reviewed', now, payload: { decision: preSend.decision, reasonCodes: preSend.reasonCodes } }) }];
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
    artifacts.push({ review: outcomeRecord, event: reviewEvent({ review: outcomeRecord, input: candidate, sourceEventId, sourceSequence, stateVersion: state.stateVersion, policyVersion, eventType: 'outcome.review_pending', now, payload: { resolutionStatus: outcome.resolutionStatus, evidenceTypes: outcome.evidenceTypes } }) });
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
