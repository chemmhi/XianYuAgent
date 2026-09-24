import type { AutoReplyDecision, AutoReplyOrderContext, AutoReplyProductContext, AutoReplyRunRecord, AutoReplyRunStage, AutoReplyRunStatus, AutoReplyRunUpdate, ConversationRecord, MessageRecord, Store } from './domain.js';
import type { MessageService } from './messages.js';
import { digestJson } from './security.js';
import type { AutoReplyRepairCandidateResult, AutoReplyRepairRuntime } from './auto-reply-repair-runtime.js';
import type { AutoReplyGodViewSink } from './auto-reply-god-view.js';

export type AutoReplyIntent = 'price' | 'availability' | 'delivery' | 'general' | 'refund' | 'complaint' | 'cross_product' | 'credential_request' | 'prompt_injection' | 'other';

export interface AutoReplyClassification {
  intent: AutoReplyIntent;
  confidence: number;
  decision: AutoReplyDecision;
  riskFlags: string[];
}

export interface AutoReplyContext {
  conversation: ConversationRecord;
  inboundMessage: MessageRecord;
  recentMessages: Array<Pick<MessageRecord, 'direction' | 'senderRole' | 'bodyText'> & Partial<Pick<MessageRecord, 'createdAt' | 'source' | 'bodyType' | 'bodyRef'>>>;
  product?: AutoReplyProductContext;
  orders: AutoReplyOrderContext[];
}

export interface AutoReplyGeneratedReply {
  text: string;
  segments?: string[];
}

/** High-level, redacted execution evidence for one agent step. */
export interface AutoReplyGeneratorObservation {
  eventType: string;
  stage: AutoReplyRunStage;
  status?: AutoReplyRunStatus;
  log: Record<string, unknown>;
  durationMs?: number;
}

export type AutoReplyGeneratorObserver = (observation: AutoReplyGeneratorObservation) => Promise<void> | void;

export interface AutoReplyGenerator {
  readonly supportsStructuredDecision?: boolean;
  readonly supportsMultimodal?: boolean;
  generate(input: { adminId?: string; context: AutoReplyContext; classification: AutoReplyClassification; observe?: AutoReplyGeneratorObserver; runId?: string; traceId?: string }): Promise<string | AutoReplyGeneratedReply | undefined>;
  segmentReply?(input: { reply: string }): Promise<string[] | undefined>;
}

export interface AutoReplySendInput {
  adminId: string;
  accountId: string;
  requestId: string;
  conversation: ConversationRecord;
  recipientRef: string;
  text: string;
  mode: 'simulate' | 'live';
  traceId: string;
  runId?: string;
  inboundMessageId?: string;
  productRef?: string;
  riskFlags?: string[];
  segmentIndex?: number;
  segmentCount?: number;
}

export interface AutoReplySender {
  send(input: AutoReplySendInput): Promise<{ outcome: 'simulated' | 'known_success' | 'known_failure' | 'unknown'; externalMessageRef?: string; outboxJobId?: string }>;
  markPersisted?(input: { outboxJobId?: string; outboundMessageId: string }): Promise<void>;
  recoverRun?(input: { adminId: string; runId: string }): Promise<{ outboundMessageIds: string[]; senderOutcome?: 'known_success' | 'unknown' }>;
}

export class NoopAutoReplySender implements AutoReplySender {
  readonly calls: Array<{ conversationId: string; recipientRef: string; text: string; mode: 'simulate' | 'live'; traceId: string }> = [];

  async send(input: AutoReplySendInput): Promise<{ outcome: 'simulated' | 'known_success' | 'known_failure' | 'unknown'; externalMessageRef?: string; outboxJobId?: string }> {
    this.calls.push({ conversationId: input.conversation.id, recipientRef: input.recipientRef, text: input.text, mode: input.mode, traceId: input.traceId });
    return { outcome: 'simulated', externalMessageRef: `simulated:auto-reply:${input.traceId}` };
  }
}

export class ExternalAutoReplySender implements AutoReplySender {
  constructor(private readonly sendExternal: (input: AutoReplySendInput) => Promise<{ externalMessageRef?: string }>) {}

  async send(input: AutoReplySendInput): Promise<{ outcome: 'simulated' | 'known_success' | 'known_failure' | 'unknown'; externalMessageRef?: string; outboxJobId?: string }> {
    if (input.mode === 'simulate') return { outcome: 'simulated', externalMessageRef: `simulated:auto-reply:${input.traceId}` };
    const sent = await this.sendExternal(input);
    return { outcome: 'known_success', externalMessageRef: sent.externalMessageRef };
  }
}

export class RuleBasedIntentClassifier {
  classify(text: string): AutoReplyClassification {
    const value = text.trim().toLowerCase();
    const rules: Array<{ intent: AutoReplyIntent; flag: string; patterns: RegExp[] }> = [
      { intent: 'prompt_injection', flag: 'prompt_injection', patterns: [/ignore\s+(all|previous|prior)\s+instructions/i, /忽略.*(指令|提示|规则)/, /system\s*prompt/i] },
      { intent: 'credential_request', flag: 'credential_request', patterns: [/(密码|验证码|cookie|token|api\s*key|密钥|秘钥)/i] },
      { intent: 'refund', flag: 'refund_request', patterns: [/(退款|退货|售后|退钱)/i] },
      { intent: 'complaint', flag: 'complaint', patterns: [/(投诉|举报|骗子|差评|维权)/i] },
      { intent: 'cross_product', flag: 'cross_product_request', patterns: [/(另一个商品|其他商品|别的商品|换一个链接)/i] },
      { intent: 'price', flag: 'price_question', patterns: [/(多少钱|价格|优惠|便宜|能少|能降价|砍价)/i] },
      { intent: 'availability', flag: 'availability_question', patterns: [/(有货|库存|还有吗|能拍吗)/i] },
      { intent: 'delivery', flag: 'delivery_question', patterns: [/(发货|什么时候发|多久发|几天发|交付)/i] },
    ];
    for (const rule of rules) {
      if (rule.patterns.some((pattern) => pattern.test(value))) {
        const highRisk = ['prompt_injection', 'credential_request', 'refund', 'complaint', 'cross_product'].includes(rule.intent);
        return { intent: rule.intent, confidence: highRisk ? 0.98 : 0.9, decision: highRisk ? 'handoff' : 'replied', riskFlags: [rule.flag] };
      }
    }
    return { intent: value ? 'general' : 'other', confidence: value ? 0.7 : 0.1, decision: value ? 'replied' : 'skipped', riskFlags: value ? [] : ['empty_message'] };
  }
}

export class TemplateAutoReplyGenerator implements AutoReplyGenerator {
  async generate(input: { context: AutoReplyContext; classification: AutoReplyClassification }): Promise<string | undefined> {
    const productTitle = input.context.product?.title ?? input.context.conversation.itemTitle ?? '这个商品';
    const price = input.context.product?.priceMinor === undefined ? undefined : (input.context.product.priceMinor / 100).toFixed(2);
    const template = input.context.product?.defaultReplyTemplate?.trim();
    if (template) return template.replaceAll('{{productTitle}}', productTitle).replaceAll('{{buyerName}}', input.context.conversation.buyerDisplayName ?? '');
    switch (input.classification.intent) {
      case 'price': return price ? `你好，${productTitle}当前价格是${price}元，具体优惠我可以再帮你确认。` : `你好，${productTitle}的价格以页面显示为准，我可以再帮你确认优惠。`;
      case 'availability': return `你好，${productTitle}目前按页面库存销售，能拍下就代表还有库存。`;
      case 'delivery': return `你好，已收到你的发货问题，我先帮你确认具体安排。`;
      default: return '你好，已收到你的消息，我先结合商品信息帮你确认。';
    }
  }
}

export interface AutoReplyProcessResult {
  run: AutoReplyRunRecord;
  inboundMessage: MessageRecord;
  outboundMessage?: MessageRecord;
  classification?: AutoReplyClassification;
  context?: AutoReplyContext;
  repair?: AutoReplyRepairCandidateResult;
}

export interface AutoReplyServiceOptions {
  enabled?: boolean;
  sendMode?: 'simulate' | 'live';
  buyerAllowlist?: string[];
  totalTimeoutMs?: number;
  debounceMs?: number;
  maxHistory?: number;
  maxReplyLength?: number;
  replySegmentDelayMs?: number;
  classifier?: RuleBasedIntentClassifier;
  generator?: AutoReplyGenerator;
  sender?: AutoReplySender;
  repairRuntime?: AutoReplyRepairRuntime;
  /** Production/runtime wiring must provide the repaired route explicitly. */
  requireRepairRuntime?: boolean;
  godView?: AutoReplyGodViewSink;
  configProvider?: (adminId: string, accountId: string) => Promise<AutoReplyServiceRuntimeOptions>;
}

export interface AutoReplyServiceRuntimeOptions {
  enabled?: boolean;
  sendMode?: 'simulate' | 'live';
  buyerAllowlist?: string[];
  totalTimeoutMs?: number;
  debounceMs?: number;
  maxHistory?: number;
  maxReplyLength?: number;
  replySegmentDelayMs?: number;
  generator?: AutoReplyGenerator;
}

export class AutoReplyService {
  private readonly enabled: boolean;
  private readonly sendMode: 'simulate' | 'live';
  private readonly buyerAllowlist: string[];
  private readonly totalTimeoutMs: number;
  private readonly debounceMs: number;
  private readonly maxHistory: number;
  private readonly maxReplyLength: number;
  private readonly replySegmentDelayMs: number;
  private readonly classifier: RuleBasedIntentClassifier;
  private readonly generator: AutoReplyGenerator;
  private readonly sender: AutoReplySender;
  private readonly repairRuntime?: AutoReplyRepairRuntime;
  private readonly requireRepairRuntime: boolean;
  private readonly godView?: AutoReplyGodViewSink;
  private readonly configProvider?: (adminId: string, accountId: string) => Promise<AutoReplyServiceRuntimeOptions>;
  private readonly lastAcceptedAt = new Map<string, number>();

  constructor(
    private readonly store: Store,
    private readonly messages: MessageService,
    private readonly audit: (input: { actorId: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string }) => Promise<string>,
    options: AutoReplyServiceOptions = {},
  ) {
    this.enabled = options.enabled ?? true;
    this.sendMode = options.sendMode ?? 'simulate';
    this.buyerAllowlist = [...new Set((options.buyerAllowlist ?? []).map(normalizeBuyerName).filter((value): value is string => Boolean(value)))];
    this.totalTimeoutMs = Math.max(1_000, Math.min(options.totalTimeoutMs ?? 60_000, 300_000));
    this.debounceMs = Math.max(0, Math.min(options.debounceMs ?? 2_000, 30_000));
    this.maxHistory = Math.max(1, Math.min(options.maxHistory ?? 20, 50));
    this.maxReplyLength = Math.max(30, Math.min(options.maxReplyLength ?? 500, 2_000));
    this.replySegmentDelayMs = Math.max(0, Math.min(options.replySegmentDelayMs ?? 350, 5_000));
    this.classifier = options.classifier ?? new RuleBasedIntentClassifier();
    this.generator = options.generator ?? new TemplateAutoReplyGenerator();
    this.sender = options.sender ?? new NoopAutoReplySender();
    this.repairRuntime = options.repairRuntime;
    this.requireRepairRuntime = options.requireRepairRuntime === true;
    if (this.requireRepairRuntime && (!this.repairRuntime || this.repairRuntime.currentMode !== 'enforce')) {
      throw new Error('AUTO_REPLY_REPAIR_RUNTIME_REQUIRED');
    }
    this.godView = options.godView;
    this.configProvider = options.configProvider;
  }

  async processInbound(input: { adminId: string; conversationId: string; inboundMessageId: string; senderName?: string; requestId?: string; traceId?: string; sourceEventId?: string; sourceSequence?: number }): Promise<AutoReplyProcessResult> {
    const traceId = input.traceId ?? `auto-reply:${input.inboundMessageId}`;
    const requestId = input.requestId ?? traceId;
    const conversation = await this.store.getConversation(input.adminId, input.conversationId);
    if (!conversation) throw new Error('CONVERSATION_NOT_FOUND');
    const inboundMessage = await this.findMessage(input.adminId, input.conversationId, input.inboundMessageId);
    if (!inboundMessage) throw new Error('INBOUND_MESSAGE_NOT_FOUND');
    const inputDigest = digestJson({ inboundMessageId: inboundMessage.id, bodyType: inboundMessage.bodyType, bodyText: inboundMessage.bodyText ?? '' });
    const replay = await this.store.findAutoReplyRunByInboundMessage(input.adminId, inboundMessage.id);
    if (replay) {
      if (this.sender.recoverRun) {
        try {
          const recovered = await this.sender.recoverRun({ adminId: input.adminId, runId: replay.id });
          const recoveredOutboundMessageId = recovered.outboundMessageIds.at(-1);
          if (recoveredOutboundMessageId) {
            const updated = replay.status === 'persisted'
              ? replay
              : await this.store.updateAutoReplyRun(replay.id, { status: 'persisted', decision: 'replied', senderOutcome: recovered.senderOutcome ?? 'known_success', outboundMessageId: recoveredOutboundMessageId, eventPayload: { input: { kind: 'outbox_recovery' }, output: { recovered: true, outboundMessageId: recoveredOutboundMessageId } } });
            return { run: updated ?? replay, inboundMessage, outboundMessage: await this.findMessage(input.adminId, input.conversationId, recoveredOutboundMessageId) };
          }
        } catch {
          // A replay must remain idempotent even if recovery is temporarily unavailable.
        }
      }
      return { run: replay, inboundMessage };
    }
    let run: AutoReplyRunRecord;
    let repair: AutoReplyRepairCandidateResult | undefined;
    let repairRoute: Awaited<ReturnType<AutoReplyRepairRuntime['routeInbound']>>;
    try {
      run = await this.store.createAutoReplyRun({ adminId: input.adminId, accountId: conversation.accountId, conversationId: conversation.id, inboundMessageId: inboundMessage.id, intent: 'pending', decision: 'skipped', status: 'received', inputDigest });
    } catch (error) {
      // A concurrent push can pass the read-before-create check. Treat the
      // database uniqueness race as an idempotent replay instead of failing
      // the second listener task.
      if ((error as { code?: string }).code === '23505') {
        const concurrent = await this.store.findAutoReplyRunByInboundMessage(input.adminId, inboundMessage.id);
        if (concurrent) return { run: concurrent, inboundMessage };
      }
      throw error;
    }
    const updateRun = async (patch: AutoReplyRunUpdate) => {
      const normalizedPatch: AutoReplyRunUpdate = patch.status === undefined
        ? patch
        : { ...patch, eventPayload: { ...(patch.eventPayload ?? {}), log: patch.eventPayload?.log ?? autoReplyRunLogForStatus(patch.status) } };
      const updated = await this.store.updateAutoReplyRun(run.id, { ...normalizedPatch, eventTraceId: traceId });
      if (updated) run = updated;
      return updated;
    };
    const buyer = {
      adminId: input.adminId,
      accountId: conversation.accountId,
      conversationId: conversation.id,
      buyerRef: conversation.buyerRef,
      buyerName: normalizeBuyerName(input.senderName) ?? normalizeBuyerName(conversation.buyerDisplayName),
      externalConversationRef: conversation.externalConversationRef,
    };
    await this.godView?.emit({
      phase: 'inbound',
      event: 'inbound.received',
      traceId,
      runId: run.id,
      buyer,
      payload: {
        messageId: inboundMessage.id,
        direction: inboundMessage.direction,
        bodyType: inboundMessage.bodyType,
        bodyText: inboundMessage.bodyText ?? '',
        bodyRef: inboundMessage.bodyRef,
        createdAt: inboundMessage.createdAt,
        requestId,
      },
    });
    const observeGenerator = async (observation: AutoReplyGeneratorObservation): Promise<void> => {
      try {
        await this.store.appendAutoReplyRunEvent({
          runId: run.id,
          accountId: conversation.accountId,
          eventType: observation.eventType,
          stage: observation.stage,
          status: observation.status ?? run.status,
          durationMs: observation.durationMs,
          traceId,
          payload: { log: { ...observation.log, traceId } },
        });
      } catch {
        // Observability must not make an otherwise valid reply fail.
      }
    };
    try {
      const runtime = await this.resolveRuntimeOptions(input.adminId, conversation.accountId);
      const modelDecidesRouting = runtime.generator.supportsStructuredDecision === true;
      const supportedMessage = inboundMessage.bodyType === 'text'
        ? Boolean(inboundMessage.bodyText?.trim())
        : inboundMessage.bodyType === 'image' && runtime.generator.supportsMultimodal === true && Boolean(inboundMessage.bodyRef?.trim());
      if (!runtime.enabled || inboundMessage.direction !== 'inbound' || !supportedMessage) {
        const failureCode = !runtime.enabled ? 'AUTO_REPLY_DISABLED' : 'UNSUPPORTED_MESSAGE';
        const updated = await updateRun({ status: 'skipped', decision: 'skipped', failureCode, eventPayload: {
          input: { kind: 'inbound_message', messageId: inboundMessage.id, digest: inputDigest, bodyType: inboundMessage.bodyType, direction: inboundMessage.direction, supportedMessage, enabled: runtime.enabled, textLength: inboundMessage.bodyText?.length ?? 0 },
          output: { decision: 'skipped', reason: failureCode },
          error: { code: failureCode },
        } });
        return { run: updated ?? run, inboundMessage };
      }

      const buyerName = normalizeBuyerName(input.senderName) ?? normalizeBuyerName(conversation.buyerDisplayName);
      const buyerIdentityKeys = [buyerName, normalizeBuyerName(conversation.buyerRef), normalizeBuyerName(conversation.externalConversationRef)].filter((value): value is string => Boolean(value));
      if (runtime.buyerAllowlist.length > 0 && !buyerIdentityKeys.some((key) => runtime.buyerAllowlist.includes(key))) {
        const updated = await updateRun({ status: 'skipped', decision: 'skipped', failureCode: 'TEST_BUYER_NOT_ALLOWLISTED', riskFlags: ['test_buyer_not_allowlisted'], eventPayload: {
          input: { kind: 'buyer_gate', buyerIdentityMatched: false, allowlistConfigured: true, identityKeyCount: buyerIdentityKeys.length },
          output: { decision: 'skipped', reason: 'TEST_BUYER_NOT_ALLOWLISTED' },
          error: { code: 'TEST_BUYER_NOT_ALLOWLISTED' },
        } });
        await this.recordAudit(input.adminId, conversation.accountId, run.id, requestId, traceId, { decision: 'skipped', reason: 'TEST_BUYER_NOT_ALLOWLISTED' });
        return { run: updated ?? run, inboundMessage };
      }

      const ruleClassification = this.classifier.classify(inboundMessage.bodyText ?? '');
      const hardSafety = modelDecidesRouting && ['prompt_injection', 'credential_request'].includes(ruleClassification.intent);
      let classification = modelDecidesRouting
        ? {
            intent: hardSafety ? ruleClassification.intent : 'general' as const,
            confidence: hardSafety ? ruleClassification.confidence : 1,
            decision: 'replied' as const,
            riskFlags: [
              ...(hardSafety ? ruleClassification.riskFlags : []),
              ...(inboundMessage.bodyType === 'image' ? ['multimodal_input'] : []),
            ],
          }
        : ruleClassification;
      await updateRun({ intent: classification.intent, decision: classification.decision, status: 'classified', riskFlags: classification.riskFlags, eventPayload: {
        input: { kind: 'intent_classification', messageId: inboundMessage.id, digest: inputDigest, bodyType: inboundMessage.bodyType, textLength: inboundMessage.bodyText?.length ?? 0 },
        output: { intent: classification.intent, confidence: classification.confidence, decision: classification.decision, riskFlags: classification.riskFlags },
      } });
      await this.godView?.emit({
        phase: 'route',
        event: 'route.classified',
        traceId,
        runId: run.id,
        buyer,
        payload: { ruleClassification, classification, modelDecidesRouting, hardSafety, allowlisted: true },
      });
      if (classification.decision === 'replied') {
        const debounceKey = `${input.adminId}:${conversation.id}`;
        const now = Date.now();
        const lastAcceptedAt = this.lastAcceptedAt.get(debounceKey);
        if (runtime.debounceMs > 0 && lastAcceptedAt !== undefined && now - lastAcceptedAt < runtime.debounceMs) {
          const updated = await updateRun({ status: 'skipped', decision: 'skipped', failureCode: 'AUTO_REPLY_DEBOUNCED', riskFlags: ['debounced'], eventPayload: {
            input: { kind: 'debounce_gate', debounceMs: runtime.debounceMs, elapsedMs: Math.max(0, now - lastAcceptedAt) },
            output: { decision: 'skipped', reason: 'AUTO_REPLY_DEBOUNCED' },
            error: { code: 'AUTO_REPLY_DEBOUNCED' },
          } });
          await this.recordAudit(input.adminId, conversation.accountId, run.id, requestId, traceId, { decision: 'skipped', reason: 'AUTO_REPLY_DEBOUNCED', debounceMs: runtime.debounceMs });
          return { run: updated ?? run, inboundMessage };
        }
        this.lastAcceptedAt.set(debounceKey, now);
      }
      const context = await this.buildContext(input.adminId, conversation, inboundMessage, runtime.maxHistory);
      const contextDigest = digestJson({ conversationId: conversation.id, productId: context.product?.id, orderRefs: context.orders.map((order) => order.orderNo), history: context.recentMessages.map((message) => ({ direction: message.direction, senderRole: message.senderRole, createdAt: message.createdAt, bodyText: message.bodyText ?? '' })) });
      await updateRun({ status: 'context_loaded', contextDigest, productId: context.product?.id, orderRefs: context.orders.map((order) => order.orderNo), eventPayload: {
        input: { kind: 'context_lookup', conversationId: conversation.id, maxHistory: runtime.maxHistory },
        output: { contextDigest, historyCount: context.recentMessages.length, productId: context.product?.id, orderRefs: context.orders.map((order) => order.orderNo), orderRefsCount: context.orders.length },
      } });
      await this.godView?.emit({
        phase: 'memory',
        event: 'memory.loaded',
        traceId,
        runId: run.id,
        buyer,
        payload: { contextDigest, maxHistory: runtime.maxHistory, context },
      });

      if (this.repairRuntime?.enabled) {
        try {
          repairRoute = await this.repairRuntime.routeInbound({ conversation, inboundMessage, context, classification });
          if (repairRoute) {
            const routePayload = { input: { kind: 'repair_policy_route', contextDigest }, output: { primaryAction: repairRoute.primaryAction, safetyHandling: repairRoute.safetyHandling, policyDecisionId: repairRoute.policyDecisionId, policyVersion: repairRoute.policyVersion, policyHash: repairRoute.policyHash, reasonCodes: repairRoute.reasonCodes } };
            await this.store.appendAutoReplyRunEvent({ runId: run.id, accountId: conversation.accountId, eventType: 'repair.policy_routed', stage: 'reply_generation', status: run.status, traceId, payload: routePayload });
            await this.godView?.emit({
              phase: 'route',
              event: 'route.policy',
              traceId,
              runId: run.id,
              buyer,
              payload: routePayload.output,
            });
          }
        } catch (error) {
          if (this.repairRuntime.currentMode === 'enforce') throw error;
        }
      }

      const repairOwnsRoute = Boolean(repairRoute);
      const repairRefusal = repairOwnsRoute && repairRoute?.primaryAction === 'REFUSE_SENSITIVE';
      const repairHandoff = repairOwnsRoute && repairRoute?.primaryAction === 'HANDOFF';
      if (repairRoute?.safetyHandling === 'PARTIAL_REFUSAL' && classification.intent === 'credential_request') {
        const safeClassification = this.classifier.classify(stripSensitiveTerms(inboundMessage.bodyText ?? ''));
        if (safeClassification.intent !== 'credential_request' && safeClassification.intent !== 'other') {
          classification = { ...classification, intent: safeClassification.intent, confidence: safeClassification.confidence, decision: 'replied', riskFlags: [...classification.riskFlags, 'sensitive_partial'] };
        }
      }
      if (conversation.handlingMode === 'human' || repairHandoff) {
        const riskFlags = [...classification.riskFlags, ...(conversation.handlingMode === 'human' ? ['human_mode'] : [])];
        const reason = conversation.handlingMode === 'human' ? 'human_mode' : repairHandoff ? 'repair_policy_handoff' : hardSafety ? 'safety_gate' : 'classifier_handoff';
        const updated = await updateRun({ status: 'handoff', decision: 'handoff', riskFlags, eventPayload: {
          input: { kind: 'reply_gate', intent: classification.intent, decision: classification.decision, reason },
          output: { decision: 'handoff', riskFlags },
        } });
        await this.recordAudit(input.adminId, conversation.accountId, run.id, requestId, traceId, { decision: 'handoff', intent: classification.intent, riskFlags });
        return { run: updated ?? run, inboundMessage, classification, context };
      }

      const generatedReply = repairRefusal
        ? { text: '这类敏感信息我无法提供，但我可以继续帮你查询商品、订单、库存或发货信息。' }
        : normalizeGeneratedReply(await withTimeout(runtime.generator.generate({ adminId: input.adminId, context, classification, observe: observeGenerator, runId: run.id, traceId }), runtime.totalTimeoutMs));
      let reply = generatedReply ? normalizeReply(generatedReply.text) : undefined;
      if (!reply) {
        const updated = await updateRun({ status: 'failed', decision: 'failed', failureCode: 'REPLY_EMPTY', eventPayload: {
          input: { kind: 'reply_generation', intent: classification.intent, contextDigest },
          output: { decision: 'failed', outputLength: 0 },
          error: { code: 'REPLY_EMPTY' },
        } });
        await this.recordAudit(input.adminId, conversation.accountId, run.id, requestId, traceId, { decision: 'failed', intent: classification.intent, failureCode: 'REPLY_EMPTY' });
        return { run: updated ?? run, inboundMessage, classification, context };
      }
      if (containsSensitiveInstruction(reply)) {
        const replyDigest = digestJson({ reply });
        const updated = await updateRun({ status: 'handoff', decision: 'handoff', riskFlags: [...classification.riskFlags, 'generated_sensitive_content'], failureCode: 'GENERATED_CONTENT_BLOCKED', eventPayload: {
          input: { kind: 'reply_safety_check', replyDigest, outputLength: reply.length },
          output: { decision: 'handoff', reason: 'generated_sensitive_content' },
          error: { code: 'GENERATED_CONTENT_BLOCKED' },
        } });
        await this.recordAudit(input.adminId, conversation.accountId, run.id, requestId, traceId, { decision: 'handoff', intent: classification.intent, failureCode: 'GENERATED_CONTENT_BLOCKED' });
        return { run: updated ?? run, inboundMessage, classification, context };
      }

      if (repairRoute?.safetyHandling === 'PARTIAL_REFUSAL' && !/(无法提供|不能提供|不能协助|无法协助)/.test(reply)) {
        reply = `关于敏感凭证类信息我无法提供；${reply}`;
      }
      const replyDigest = digestJson({ reply });
      await updateRun({ status: 'generated', replyDigest, eventPayload: {
        input: { kind: 'reply_generation', intent: classification.intent, contextDigest },
        output: { replyDigest, outputLength: reply.length },
      } });
      const segments = await this.resolveReplySegments(runtime.generator, generatedReply?.segments, reply, runtime);
      if (this.repairRuntime?.enabled) {
        try {
          repair = await this.repairRuntime.reviewCandidate({
            adminId: input.adminId,
            runId: run.id,
            conversation,
            inboundMessage,
            context,
            classification,
            reply: { text: reply, segments },
            requestId,
            traceId,
            sourceEventId: input.sourceEventId,
            sourceSequence: input.sourceSequence,
          });
        } catch (error) {
          try {
            await this.store.appendAutoReplyRunEvent({
              runId: run.id,
              accountId: conversation.accountId,
              eventType: 'repair.failed',
              stage: 'reply_generation',
              status: run.status,
              traceId,
              payload: {
                repairMode: this.repairRuntime.currentMode,
                failureCode: toFailureCode(error),
              },
            });
          } catch {
            // A repair telemetry failure must never break the response path.
          }
          if (this.repairRuntime.currentMode === 'enforce') throw error;
        }
      }
      let lastOutboundMessageId: string | undefined;
      let lastOutcome: Awaited<ReturnType<AutoReplySender['send']>>['outcome'] = 'simulated';
      let lastExternalMessageRef: string | undefined;
      for (let index = 0; index < segments.length; index += 1) {
        if (index > 0 && runtime.replySegmentDelayMs > 0) await delay(runtime.replySegmentDelayMs);
        const segment = segments[index]!;
        const sendRequestId = segments.length > 1 ? `${requestId}:segment:${index + 1}` : requestId;
        const sent = await this.sender.send({ adminId: input.adminId, accountId: conversation.accountId, requestId: sendRequestId, conversation, recipientRef: conversation.buyerRef, text: segment, mode: runtime.sendMode, traceId, runId: run.id, inboundMessageId: inboundMessage.id, productRef: context.product?.id, riskFlags: classification.riskFlags, segmentIndex: index, segmentCount: segments.length });
        await this.godView?.emit({
          phase: 'send',
          event: 'send.result',
          traceId,
          runId: run.id,
          buyer,
          payload: { segmentIndex: index, segmentCount: segments.length, text: segment, outcome: sent.outcome, externalMessageRef: sent.externalMessageRef, outboxJobId: sent.outboxJobId, mode: runtime.sendMode },
        });
        lastOutcome = sent.outcome;
        lastExternalMessageRef = sent.externalMessageRef;
        if (sent.outcome === 'known_failure' || sent.outcome === 'unknown') throw new Error(sent.outcome === 'unknown' ? 'AUTO_REPLY_SEND_UNKNOWN' : 'AUTO_REPLY_SEND_FAILED');
        const simulatedRef = sent.outcome === 'simulated' ? `${sent.externalMessageRef ?? `simulated:auto-reply:${inboundMessage.id}`}:${index + 1}` : sent.externalMessageRef;
        const outbound = await this.messages.createMessage({ adminId: input.adminId, conversationId: conversation.id, direction: 'outbound', senderRole: 'agent', bodyType: 'text', bodyText: segment, externalMessageRef: simulatedRef, source: 'ai', productRef: context.product?.id, riskFlags: [...classification.riskFlags, ...(sent.outcome === 'simulated' ? ['simulated_send'] : []), ...(segments.length > 1 ? [`reply_segment_${index + 1}_of_${segments.length}`] : [])], requestId: sendRequestId, traceId });
        try { await this.sender.markPersisted?.({ outboxJobId: sent.outboxJobId, outboundMessageId: outbound.message.messageId }); } catch { /* local message is authoritative; outbox reconciliation can retry the link */ }
        lastOutboundMessageId = outbound.message.messageId;
      }
      if (repair?.outcomeReviewId && this.repairRuntime) {
        try { await this.repairRuntime.reconcileSendOutcome({ outcomeReviewId: repair.outcomeReviewId, outcome: lastOutcome, externalMessageRef: lastExternalMessageRef }); } catch { /* reconcile must not break legacy success */ }
      }
      await updateRun({ status: 'simulated', senderOutcome: lastOutcome, eventPayload: {
        input: { kind: 'send', replyDigest, segmentCount: segments.length, mode: runtime.sendMode },
        output: { senderOutcome: lastOutcome, segmentCount: segments.length },
      } });
      const updated = await updateRun({ status: 'persisted', decision: 'replied', senderOutcome: lastOutcome, outboundMessageId: lastOutboundMessageId, eventPayload: {
        input: { kind: 'persistence', replyDigest, segmentCount: segments.length, senderOutcome: lastOutcome },
        output: { decision: 'replied', senderOutcome: lastOutcome, outboundMessageId: lastOutboundMessageId, persisted: true, segmentCount: segments.length },
      } });
      await this.recordAudit(input.adminId, conversation.accountId, run.id, requestId, traceId, { decision: 'replied', intent: classification.intent, senderOutcome: lastOutcome, outboundMessageId: lastOutboundMessageId, segmentCount: segments.length, contextDigest, replyDigest });
      await this.godView?.emit({
        phase: 'run',
        event: 'run.finished',
        traceId,
        runId: run.id,
        buyer,
        payload: { status: 'persisted', decision: 'replied', intent: classification.intent, senderOutcome: lastOutcome, outboundMessageId: lastOutboundMessageId, segmentCount: segments.length, reply, contextDigest, replyDigest },
      });
      return { run: updated ?? run, inboundMessage, outboundMessage: lastOutboundMessageId ? await this.findMessage(input.adminId, input.conversationId, lastOutboundMessageId) : undefined, classification, context, repair };
    } catch (error) {
      const failureCode = toFailureCode(error);
      if (repair?.outcomeReviewId && this.repairRuntime) {
        try {
          await this.repairRuntime.reconcileSendOutcome({ outcomeReviewId: repair.outcomeReviewId, outcome: failureCode === 'AUTO_REPLY_SEND_FAILED' ? 'known_failure' : 'unknown' });
        } catch {
          // Repair reconciliation is best-effort and must never mask the legacy failure.
        }
      }
      if (failureCode === 'AGENT_HANDOFF') {
        const reason = safeEventReason(error);
        const updated = await updateRun({ status: 'handoff', decision: 'handoff', failureCode, eventPayload: {
          input: { kind: 'exception_recovery', status: run.status, intent: run.intent },
          output: { decision: 'handoff', failureCode },
          error: { code: failureCode, ...(reason ? { reason } : {}) },
        } });
        await this.recordAudit(input.adminId, conversation.accountId, run.id, requestId, traceId, { decision: 'handoff', intent: run.intent, failureCode, ...(reason ? { reason } : {}) });
        await this.godView?.emit({
          phase: 'run',
          event: 'run.handoff',
          traceId,
          runId: run.id,
          buyer,
          payload: { status: 'handoff', decision: 'handoff', failureCode, reason },
        });
        return { run: updated ?? run, inboundMessage };
      }
      const reason = safeEventReason(error);
      const updated = await updateRun({ status: 'failed', decision: 'failed', failureCode, eventPayload: {
        input: { kind: 'exception', status: run.status, intent: run.intent },
        output: { decision: 'failed', failureCode },
        error: { code: failureCode, ...(reason ? { reason } : {}) },
      } });
      await this.recordAudit(input.adminId, conversation.accountId, run.id, requestId, traceId, { decision: 'failed', failureCode });
      await this.godView?.emit({
        phase: 'run',
        event: 'run.failed',
        traceId,
        runId: run.id,
        buyer,
        payload: { status: 'failed', decision: 'failed', failureCode, currentStatus: run.status },
      });
      return { run: updated ?? run, inboundMessage };
    }
  }

  private async buildContext(adminId: string, conversation: ConversationRecord, inboundMessage: MessageRecord, maxHistory = this.maxHistory): Promise<AutoReplyContext> {
    const history = await this.store.listAutoReplyMessages(adminId, conversation.id, { limit: maxHistory + 1 });
    const product = await this.findProduct(adminId, conversation);
    const orders = await this.findOrders(adminId, conversation);
    return {
      conversation,
      inboundMessage,
      recentMessages: history.items
        .filter((message) => message.messageId !== inboundMessage.id)
        .slice(-maxHistory)
        .map((message) => ({ direction: message.direction, senderRole: message.senderRole, bodyType: message.bodyType, bodyText: message.bodyText, bodyRef: message.bodyRef })),
      product,
      orders,
    };
  }

  private async resolveRuntimeOptions(adminId: string, accountId: string): Promise<Required<AutoReplyServiceRuntimeOptions>> {
    const provided = this.configProvider ? await this.configProvider(adminId, accountId) : {};
    const buyerAllowlist = [...new Set((provided.buyerAllowlist ?? this.buyerAllowlist).map(normalizeBuyerName).filter((value): value is string => Boolean(value)))];
    return {
      enabled: provided.enabled ?? this.enabled,
      sendMode: provided.sendMode ?? this.sendMode,
      buyerAllowlist,
      totalTimeoutMs: Math.max(1_000, Math.min(provided.totalTimeoutMs ?? this.totalTimeoutMs, 300_000)),
      debounceMs: Math.max(0, Math.min(provided.debounceMs ?? this.debounceMs, 30_000)),
      maxHistory: Math.max(1, Math.min(provided.maxHistory ?? this.maxHistory, 50)),
      maxReplyLength: Math.max(30, Math.min(provided.maxReplyLength ?? this.maxReplyLength, 2_000)),
      replySegmentDelayMs: Math.max(0, Math.min(provided.replySegmentDelayMs ?? this.replySegmentDelayMs, 5_000)),
      generator: provided.generator ?? this.generator,
    };
  }

  private async resolveReplySegments(generator: AutoReplyGenerator, proposed: string[] | undefined, reply: string, runtime: Required<AutoReplyServiceRuntimeOptions>): Promise<string[]> {
    if (reply.length > runtime.maxReplyLength) throw new Error('AUTO_REPLY_REPLY_TOO_LONG');
    const validated = validateSemanticSegments(proposed, reply);
    if (validated) return validated;
    const needsSemanticSplit = reply.length > 120 || /\n/.test(reply);
    if (generator.segmentReply && needsSemanticSplit) {
      const segmented = await withTimeout(generator.segmentReply({ reply }), runtime.totalTimeoutMs);
      const retried = validateSemanticSegments(segmented, reply);
      if (retried) return retried;
    }
    return [reply];
  }

  private async findProduct(adminId: string, conversation: ConversationRecord): Promise<AutoReplyContext['product']> {
    if (!conversation.itemRef) return undefined;
    const product = await this.store.getAutoReplyProduct(adminId, isUuid(conversation.itemRef)
      ? { accountId: conversation.accountId, productId: conversation.itemRef }
      : { accountId: conversation.accountId, externalProductRef: conversation.itemRef });
    if (product) return product;
    if (conversation.itemTitle && conversation.itemTitle !== conversation.itemRef) {
      return this.store.getAutoReplyProduct(adminId, { accountId: conversation.accountId, title: conversation.itemTitle });
    }
    return undefined;
  }

  private async findOrders(adminId: string, conversation: ConversationRecord): Promise<AutoReplyOrderContext[]> {
    const result = await this.store.listAutoReplyOrders(adminId, {
      accountId: conversation.accountId,
      buyerId: conversation.buyerRef,
      conversationId: conversation.id,
      limit: 50,
    });
    return result.items;
  }

  private async findMessage(adminId: string, conversationId: string, messageId: string): Promise<MessageRecord | undefined> {
    const result = await this.store.listMessages(adminId, conversationId, { limit: 200 });
    return result.items.find((message) => message.id === messageId);
  }

  private async recordAudit(adminId: string, accountId: string, runId: string, requestId: string, traceId: string, payload: unknown): Promise<void> {
    await this.audit({ actorId: adminId, action: 'auto_reply.processed', targetRef: runId, requestId, traceId, payload, accountId });
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeGeneratedReply(value: string | AutoReplyGeneratedReply | undefined): AutoReplyGeneratedReply | undefined {
  if (typeof value === 'string') return { text: value };
  if (!value || typeof value.text !== 'string') return undefined;
  return { text: value.text, segments: Array.isArray(value.segments) ? value.segments : undefined };
}

function normalizeReply(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .replace(/[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
  return normalized || undefined;
}

function containsSensitiveInstruction(value: string): boolean {
  return /(cookie|token|api\s*key|password|密码|验证码|系统提示|system\s*prompt)/i.test(value);
}

function toFailureCode(error: unknown): string {
  const candidate = error as { code?: unknown } | null;
  if (typeof candidate?.code === 'string' && /^[A-Z0-9_:-]{1,64}$/.test(candidate.code)) return candidate.code;
  if (error instanceof Error && /^[A-Z0-9_:-]{1,64}$/.test(error.message)) return error.message;
  return 'AUTO_REPLY_FAILED';
}

function safeEventReason(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message.trim() : '';
  return /^[A-Z0-9_:-]{1,64}$/.test(message) ? message : undefined;
}

function stripSensitiveTerms(value: string): string {
  return value
    .replace(/cookie|api\s*key|access[_ -]?token|验证码|密码|秘钥|密钥/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateSemanticSegments(proposed: string[] | undefined, reply: string): string[] | undefined {
  if (!proposed || proposed.length === 0) return undefined;
  const segments = proposed.map((segment) => normalizeReply(segment)).filter((segment): segment is string => Boolean(segment));
  if (segments.length !== proposed.length) return undefined;
  const joined = segments.join('');
  const normalizedReply = reply.replace(/\s+/g, '');
  if (joined.replace(/\s+/g, '') !== normalizedReply) return undefined;
  return segments;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('AGENT_TOTAL_TIMEOUT')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeBuyerName(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

function autoReplyRunLogForStatus(status: AutoReplyRunStatus): Record<string, unknown> {
  switch (status) {
    case 'received': return { phase: 'gateway', state: 'received', message: '已接收买家消息，准备开始处理' };
    case 'classified': return { phase: 'intent', state: 'completed', message: '已完成意图识别与安全判断' };
    case 'context_loaded': return { phase: 'context', state: 'completed', message: '已加载会话、商品与订单上下文' };
    case 'generated': return { phase: 'reply', state: 'completed', message: '已生成候选回复' };
    case 'simulated': return { phase: 'sending', state: 'completed', message: '已完成消息发送动作' };
    case 'persisted': return { phase: 'persist', state: 'completed', message: '已保存自动回复结果' };
    case 'handoff': return { phase: 'handoff', state: 'handoff', message: '已转交人工处理' };
    case 'skipped': return { phase: 'workflow', state: 'skipped', message: '本次自动回复已跳过' };
    case 'failed': return { phase: 'workflow', state: 'failed', message: '自动回复处理失败' };
  }
}
