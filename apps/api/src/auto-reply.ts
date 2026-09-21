import type { AutoReplyDecision, AutoReplyRunRecord, ConversationRecord, MessageRecord, OrderRecord, ProductRecord, Store } from './domain.js';
import type { MessageService } from './messages.js';
import { digestJson } from './security.js';

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
  recentMessages: Array<Pick<MessageRecord, 'direction' | 'senderRole' | 'bodyText' | 'createdAt' | 'source'>>;
  product?: Pick<ProductRecord, 'id' | 'accountId' | 'externalProductRef' | 'title' | 'description' | 'defaultReplyTemplate' | 'aiPrompt' | 'priceMinor'>;
  orders: Array<Pick<OrderRecord, 'id' | 'orderNo' | 'buyerId' | 'itemId' | 'itemTitle' | 'paymentStatus' | 'orderStatus' | 'deliveryStatus' | 'afterSalesStatus'>>;
}

export interface AutoReplyGeneratedReply {
  text: string;
  segments?: string[];
}

export interface AutoReplyGenerator {
  generate(input: { adminId?: string; context: AutoReplyContext; classification: AutoReplyClassification }): Promise<string | AutoReplyGeneratedReply | undefined>;
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
}

export interface AutoReplySender {
  send(input: AutoReplySendInput): Promise<{ outcome: 'simulated' | 'known_success' | 'known_failure' | 'unknown'; externalMessageRef?: string }>;
}

export class NoopAutoReplySender implements AutoReplySender {
  readonly calls: Array<{ conversationId: string; recipientRef: string; text: string; mode: 'simulate' | 'live'; traceId: string }> = [];

  async send(input: AutoReplySendInput): Promise<{ outcome: 'simulated' | 'known_success' | 'known_failure' | 'unknown'; externalMessageRef?: string }> {
    this.calls.push({ conversationId: input.conversation.id, recipientRef: input.recipientRef, text: input.text, mode: input.mode, traceId: input.traceId });
    return { outcome: 'simulated', externalMessageRef: `simulated:auto-reply:${input.traceId}` };
  }
}

export class ExternalAutoReplySender implements AutoReplySender {
  constructor(private readonly sendExternal: (input: AutoReplySendInput) => Promise<{ externalMessageRef?: string }>) {}

  async send(input: AutoReplySendInput): Promise<{ outcome: 'simulated' | 'known_success' | 'known_failure' | 'unknown'; externalMessageRef?: string }> {
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
}

export interface AutoReplyServiceOptions {
  enabled?: boolean;
  sendMode?: 'simulate' | 'live';
  testBuyerNames?: string[];
  totalTimeoutMs?: number;
  debounceMs?: number;
  maxHistory?: number;
  maxReplyLength?: number;
  replySegmentDelayMs?: number;
  classifier?: RuleBasedIntentClassifier;
  generator?: AutoReplyGenerator;
  sender?: AutoReplySender;
  configProvider?: (adminId: string, accountId: string) => Promise<AutoReplyServiceRuntimeOptions>;
}

export interface AutoReplyServiceRuntimeOptions {
  enabled?: boolean;
  sendMode?: 'simulate' | 'live';
  testBuyerNames?: string[];
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
  private readonly testBuyerNames: string[];
  private readonly totalTimeoutMs: number;
  private readonly debounceMs: number;
  private readonly maxHistory: number;
  private readonly maxReplyLength: number;
  private readonly replySegmentDelayMs: number;
  private readonly classifier: RuleBasedIntentClassifier;
  private readonly generator: AutoReplyGenerator;
  private readonly sender: AutoReplySender;
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
    this.testBuyerNames = [...new Set((options.testBuyerNames ?? []).map(normalizeBuyerName).filter((value): value is string => Boolean(value)))];
    this.totalTimeoutMs = Math.max(1_000, Math.min(options.totalTimeoutMs ?? 60_000, 300_000));
    this.debounceMs = Math.max(0, Math.min(options.debounceMs ?? 2_000, 30_000));
    this.maxHistory = Math.max(1, Math.min(options.maxHistory ?? 20, 50));
    this.maxReplyLength = Math.max(30, Math.min(options.maxReplyLength ?? 500, 2_000));
    this.replySegmentDelayMs = Math.max(0, Math.min(options.replySegmentDelayMs ?? 350, 5_000));
    this.classifier = options.classifier ?? new RuleBasedIntentClassifier();
    this.generator = options.generator ?? new TemplateAutoReplyGenerator();
    this.sender = options.sender ?? new NoopAutoReplySender();
    this.configProvider = options.configProvider;
  }

  async processInbound(input: { adminId: string; conversationId: string; inboundMessageId: string; senderName?: string; requestId?: string; traceId?: string }): Promise<AutoReplyProcessResult> {
    const traceId = input.traceId ?? `auto-reply:${input.inboundMessageId}`;
    const requestId = input.requestId ?? traceId;
    const conversation = await this.store.getConversation(input.adminId, input.conversationId);
    if (!conversation) throw new Error('CONVERSATION_NOT_FOUND');
    const inboundMessage = await this.findMessage(input.adminId, input.conversationId, input.inboundMessageId);
    if (!inboundMessage) throw new Error('INBOUND_MESSAGE_NOT_FOUND');
    const inputDigest = digestJson({ inboundMessageId: inboundMessage.id, bodyType: inboundMessage.bodyType, bodyText: inboundMessage.bodyText ?? '' });
    const replay = await this.store.findAutoReplyRunByInboundMessage(input.adminId, inboundMessage.id);
    if (replay) return { run: replay, inboundMessage };
    let run: AutoReplyRunRecord;
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
    try {
      const runtime = await this.resolveRuntimeOptions(input.adminId, conversation.accountId);
      if (!runtime.enabled || inboundMessage.direction !== 'inbound' || inboundMessage.bodyType !== 'text' || !inboundMessage.bodyText?.trim()) {
        const updated = await this.store.updateAutoReplyRun(run.id, { status: 'skipped', decision: 'skipped', failureCode: !runtime.enabled ? 'AUTO_REPLY_DISABLED' : 'UNSUPPORTED_MESSAGE' });
        return { run: updated ?? run, inboundMessage };
      }

      const buyerName = normalizeBuyerName(input.senderName) ?? normalizeBuyerName(conversation.buyerDisplayName);
      if (runtime.testBuyerNames.length > 0 && (!buyerName || !runtime.testBuyerNames.includes(buyerName))) {
        const updated = await this.store.updateAutoReplyRun(run.id, { status: 'skipped', decision: 'skipped', failureCode: 'TEST_BUYER_NOT_ALLOWLISTED', riskFlags: ['test_buyer_not_allowlisted'] });
        await this.recordAudit(input.adminId, conversation.accountId, run.id, requestId, traceId, { decision: 'skipped', reason: 'TEST_BUYER_NOT_ALLOWLISTED' });
        return { run: updated ?? run, inboundMessage };
      }

      const classification = this.classifier.classify(inboundMessage.bodyText);
      await this.store.updateAutoReplyRun(run.id, { intent: classification.intent, decision: classification.decision, status: 'classified', riskFlags: classification.riskFlags });
      if (classification.decision === 'replied') {
        const debounceKey = `${input.adminId}:${conversation.id}`;
        const now = Date.now();
        const lastAcceptedAt = this.lastAcceptedAt.get(debounceKey);
        if (runtime.debounceMs > 0 && lastAcceptedAt !== undefined && now - lastAcceptedAt < runtime.debounceMs) {
          const updated = await this.store.updateAutoReplyRun(run.id, { status: 'skipped', decision: 'skipped', failureCode: 'AUTO_REPLY_DEBOUNCED', riskFlags: ['debounced'] });
          await this.recordAudit(input.adminId, conversation.accountId, run.id, requestId, traceId, { decision: 'skipped', reason: 'AUTO_REPLY_DEBOUNCED', debounceMs: runtime.debounceMs });
          return { run: updated ?? run, inboundMessage };
        }
        this.lastAcceptedAt.set(debounceKey, now);
      }
      const context = await this.buildContext(input.adminId, conversation, inboundMessage, runtime.maxHistory);
      const contextDigest = digestJson({ conversationId: conversation.id, productId: context.product?.id, orderRefs: context.orders.map((order) => order.orderNo), history: context.recentMessages.map((message) => ({ direction: message.direction, senderRole: message.senderRole, createdAt: message.createdAt, bodyText: message.bodyText ?? '' })) });
      await this.store.updateAutoReplyRun(run.id, { status: 'context_loaded', contextDigest, productId: context.product?.id, orderRefs: context.orders.map((order) => order.orderNo) });

      if (conversation.handlingMode === 'human' || classification.decision === 'handoff') {
        const riskFlags = [...classification.riskFlags, ...(conversation.handlingMode === 'human' ? ['human_mode'] : [])];
        const updated = await this.store.updateAutoReplyRun(run.id, { status: 'handoff', decision: 'handoff', riskFlags });
        await this.recordAudit(input.adminId, conversation.accountId, run.id, requestId, traceId, { decision: 'handoff', intent: classification.intent, riskFlags });
        return { run: updated ?? run, inboundMessage, classification, context };
      }

      const generated = await withTimeout(runtime.generator.generate({ adminId: input.adminId, context, classification }), runtime.totalTimeoutMs);
      const generatedReply = normalizeGeneratedReply(generated);
      const reply = generatedReply ? normalizeReply(generatedReply.text) : undefined;
      if (!reply) {
        const updated = await this.store.updateAutoReplyRun(run.id, { status: 'failed', decision: 'failed', failureCode: 'REPLY_EMPTY' });
        await this.recordAudit(input.adminId, conversation.accountId, run.id, requestId, traceId, { decision: 'failed', intent: classification.intent, failureCode: 'REPLY_EMPTY' });
        return { run: updated ?? run, inboundMessage, classification, context };
      }
      if (containsSensitiveInstruction(reply)) {
        const updated = await this.store.updateAutoReplyRun(run.id, { status: 'handoff', decision: 'handoff', riskFlags: [...classification.riskFlags, 'generated_sensitive_content'], failureCode: 'GENERATED_CONTENT_BLOCKED' });
        await this.recordAudit(input.adminId, conversation.accountId, run.id, requestId, traceId, { decision: 'handoff', intent: classification.intent, failureCode: 'GENERATED_CONTENT_BLOCKED' });
        return { run: updated ?? run, inboundMessage, classification, context };
      }

      const replyDigest = digestJson({ reply });
      await this.store.updateAutoReplyRun(run.id, { status: 'generated', replyDigest });
      const segments = await this.resolveReplySegments(runtime.generator, generatedReply?.segments, reply, runtime);
      let lastOutboundMessageId: string | undefined;
      let lastOutcome: Awaited<ReturnType<AutoReplySender['send']>>['outcome'] = 'simulated';
      for (let index = 0; index < segments.length; index += 1) {
        if (index > 0 && runtime.replySegmentDelayMs > 0) await delay(runtime.replySegmentDelayMs);
        const segment = segments[index]!;
        const sent = await this.sender.send({ adminId: input.adminId, accountId: conversation.accountId, requestId, conversation, recipientRef: conversation.buyerRef, text: segment, mode: runtime.sendMode, traceId });
        lastOutcome = sent.outcome;
        if (sent.outcome === 'known_failure' || sent.outcome === 'unknown') throw new Error(sent.outcome === 'unknown' ? 'AUTO_REPLY_SEND_UNKNOWN' : 'AUTO_REPLY_SEND_FAILED');
        const simulatedRef = sent.outcome === 'simulated' ? `${sent.externalMessageRef ?? `simulated:auto-reply:${inboundMessage.id}`}:${index + 1}` : sent.externalMessageRef;
        const outbound = await this.messages.createMessage({ adminId: input.adminId, conversationId: conversation.id, direction: 'outbound', senderRole: 'agent', bodyType: 'text', bodyText: segment, externalMessageRef: simulatedRef, source: 'ai', productRef: context.product?.id, riskFlags: [...classification.riskFlags, ...(sent.outcome === 'simulated' ? ['simulated_send'] : []), ...(segments.length > 1 ? [`reply_segment_${index + 1}_of_${segments.length}`] : [])], requestId, traceId });
        lastOutboundMessageId = outbound.message.messageId;
      }
      await this.store.updateAutoReplyRun(run.id, { status: 'simulated', senderOutcome: lastOutcome });
      const updated = await this.store.updateAutoReplyRun(run.id, { status: 'persisted', decision: 'replied', senderOutcome: lastOutcome, outboundMessageId: lastOutboundMessageId });
      await this.recordAudit(input.adminId, conversation.accountId, run.id, requestId, traceId, { decision: 'replied', intent: classification.intent, senderOutcome: lastOutcome, outboundMessageId: lastOutboundMessageId, segmentCount: segments.length, contextDigest, replyDigest });
      return { run: updated ?? run, inboundMessage, outboundMessage: lastOutboundMessageId ? await this.findMessage(input.adminId, input.conversationId, lastOutboundMessageId) : undefined, classification, context };
    } catch (error) {
      const failureCode = toFailureCode(error);
      if (failureCode === 'AGENT_HANDOFF') {
        const updated = await this.store.updateAutoReplyRun(run.id, { status: 'handoff', decision: 'handoff', failureCode });
        await this.recordAudit(input.adminId, conversation.accountId, run.id, requestId, traceId, { decision: 'handoff', intent: run.intent, failureCode });
        return { run: updated ?? run, inboundMessage };
      }
      const updated = await this.store.updateAutoReplyRun(run.id, { status: 'failed', decision: 'failed', failureCode });
      await this.recordAudit(input.adminId, conversation.accountId, run.id, requestId, traceId, { decision: 'failed', failureCode });
      return { run: updated ?? run, inboundMessage };
    }
  }

  private async buildContext(adminId: string, conversation: ConversationRecord, inboundMessage: MessageRecord, maxHistory = this.maxHistory): Promise<AutoReplyContext> {
    const history = await this.store.listMessages(adminId, conversation.id, { limit: maxHistory });
    const product = await this.findProduct(adminId, conversation);
    const orders = await this.findOrders(adminId, conversation);
    return { conversation, inboundMessage, recentMessages: history.items.map((message) => ({ direction: message.direction, senderRole: message.senderRole, bodyText: message.bodyText, createdAt: message.createdAt, source: message.source })), product, orders: orders.map((order) => ({ id: order.id, orderNo: order.orderNo, buyerId: order.buyerId, itemId: order.itemId, itemTitle: order.itemTitle, paymentStatus: order.paymentStatus, orderStatus: order.orderStatus, deliveryStatus: order.deliveryStatus, afterSalesStatus: order.afterSalesStatus })) };
  }

  private async resolveRuntimeOptions(adminId: string, accountId: string): Promise<Required<AutoReplyServiceRuntimeOptions>> {
    const provided = this.configProvider ? await this.configProvider(adminId, accountId) : {};
    const testBuyerNames = [...new Set((provided.testBuyerNames ?? this.testBuyerNames).map(normalizeBuyerName).filter((value): value is string => Boolean(value)))];
    return {
      enabled: provided.enabled ?? this.enabled,
      sendMode: provided.sendMode ?? this.sendMode,
      testBuyerNames,
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
    const result = await this.store.listProducts(adminId, { accountId: conversation.accountId, keyword: conversation.itemRef, page: 1, pageSize: 10 });
    const product = result.items.find((item) => item.id === conversation.itemRef || item.externalProductRef === conversation.itemRef) ?? result.items.find((item) => item.title === conversation.itemTitle);
    if (!product) return undefined;
    return { id: product.id, accountId: product.accountId, externalProductRef: product.externalProductRef, title: product.title, description: product.description, defaultReplyTemplate: product.defaultReplyTemplate, aiPrompt: product.aiPrompt, priceMinor: product.priceMinor };
  }

  private async findOrders(adminId: string, conversation: ConversationRecord): Promise<OrderRecord[]> {
    // The order list contract intentionally does not search by buyer id. Load
    // every page in the scoped account, then retain only orders owned by this
    // buyer or explicitly linked to this conversation. Item-only matches
    // belong to other buyers and must never block or influence an AI reply.
    const items: OrderRecord[] = [];
    const pageSize = 100;
    for (let page = 1; page <= 1_000; page += 1) {
      const result = await this.store.listOrders(adminId, { accountId: conversation.accountId, page, pageSize });
      items.push(...result.items);
      if (page >= result.totalPages || result.items.length === 0) break;
      if (page === 1_000) throw new Error('ORDER_CONTEXT_INCOMPLETE');
    }
    return items.filter((order) => order.buyerId === conversation.buyerRef || order.conversationId === conversation.id);
  }

  private async findMessage(adminId: string, conversationId: string, messageId: string): Promise<MessageRecord | undefined> {
    const result = await this.store.listMessages(adminId, conversationId, { limit: 200 });
    return result.items.find((message) => message.id === messageId);
  }

  private async recordAudit(adminId: string, accountId: string, runId: string, requestId: string, traceId: string, payload: unknown): Promise<void> {
    await this.audit({ actorId: adminId, action: 'auto_reply.processed', targetRef: runId, requestId, traceId, payload, accountId });
  }
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
