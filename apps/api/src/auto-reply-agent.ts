import type { ConversationRecord, MessageRecord, OrderRecord, ProductRecord, Store } from './domain.js';
import type { AutoReplyAgentConfig } from './auto-reply-agent-config.js';
import type { AutoReplyClassification, AutoReplyContext, AutoReplyGenerator } from './auto-reply.js';
import { digestJson } from './security.js';
import type { ModelClient, ModelCompletionResult, ModelMessage, ModelToolCall, ModelToolDefinition } from './pi-runtime.js';

export const AUTO_REPLY_TOOL_NAMES = [
  'get_buyer_conversations',
  'get_product_info',
  'get_buyer_orders',
  'list_shop_products',
] as const;

type AutoReplyToolName = (typeof AUTO_REPLY_TOOL_NAMES)[number];

export class AutoReplyAgentError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'AutoReplyAgentError';
    this.code = code;
  }
}

export class AutoReplyAgentHandoffError extends AutoReplyAgentError {
  constructor(reason = '模型判断需要人工处理') {
    super('AGENT_HANDOFF', reason);
    this.name = 'AutoReplyAgentHandoffError';
  }
}

export interface AutoReplyAgentTrace {
  loops: number;
  toolCalls: number;
  tools: string[];
  configDigest: string;
}

export interface ToolCallingAutoReplyAgentOptions {
  configProvider?: (adminId: string, accountId: string) => Promise<AutoReplyAgentConfig | undefined>;
  onTrace?: (trace: AutoReplyAgentTrace) => void | Promise<void>;
}

export const AUTO_REPLY_AGENT_TOOLS: ModelToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_buyer_conversations',
      description: '读取当前买家在当前卖家账号下的全部相关会话，跨订单和跨商品。',
      parameters: { type: 'object', properties: { maxMessagesPerConversation: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_product_info',
      description: '读取当前卖家账号下指定商品的公开信息。未传商品引用时使用当前会话商品。',
      parameters: { type: 'object', properties: { productRef: { type: 'string', maxLength: 120 } }, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_buyer_orders',
      description: '分页读取当前买家在当前卖家账号下的订单安全摘要。',
      parameters: { type: 'object', properties: { maxOrders: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_shop_products',
      description: '搜索当前卖家店铺的商品摘要，用于相似商品或替代商品推荐。',
      parameters: { type: 'object', properties: { keyword: { type: 'string', maxLength: 120 }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false },
    },
  },
];

export class ToolCallingAutoReplyAgent implements AutoReplyGenerator {
  private readonly config: AutoReplyAgentConfig;

  constructor(
    private readonly store: Store,
    private readonly client: ModelClient,
    config: AutoReplyAgentConfig,
    private readonly options: ToolCallingAutoReplyAgentOptions = {},
  ) {
    this.config = config;
  }

  async generate(input: { adminId?: string; context: AutoReplyContext; classification: AutoReplyClassification }): Promise<string | undefined> {
    if (!input.adminId) throw new AutoReplyAgentError('AGENT_ADMIN_REQUIRED');
    const config = await this.options.configProvider?.(input.adminId, input.context.conversation.accountId) ?? this.config;
    const messages: ModelMessage[] = [
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: renderUserPrompt(config.userPromptTemplate, this.toInitialContext(input.context, input.classification)) },
    ];
    const trace: AutoReplyAgentTrace = { loops: 0, toolCalls: 0, tools: [], configDigest: config.digest };
    const seenCalls = new Set<string>();

    for (let loop = 1; loop <= config.maxLoops; loop += 1) {
      trace.loops = loop;
      const result = await this.client.complete({ messages, tools: AUTO_REPLY_AGENT_TOOLS, toolChoice: 'auto' });
      const toolCalls = result.toolCalls ?? [];
      if (toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: result.content ?? '', toolCalls });
        for (const call of toolCalls) {
          if (trace.toolCalls >= config.maxToolCalls) throw new AutoReplyAgentError('AGENT_TOOL_CALL_LIMIT');
          const parsed = parseToolCall(call);
          const signature = `${parsed.name}:${digestJson(parsed.arguments)}`;
          if (seenCalls.has(signature)) throw new AutoReplyAgentError('AGENT_DUPLICATE_TOOL_CALL');
          seenCalls.add(signature);
          trace.toolCalls += 1;
          trace.tools.push(parsed.name);
          const toolResult = await withTimeout(this.executeTool(parsed.name, parsed.arguments, input.adminId, input.context, config), config.toolTimeoutMs);
          messages.push({ role: 'tool', name: parsed.name, toolCallId: call.id, content: limitText(JSON.stringify(toolResult), config.maxToolResultChars) });
        }
        continue;
      }

      const content = result.content?.trim();
      if (!content) throw new AutoReplyAgentError('AGENT_EMPTY_RESPONSE');
      if (isHandoffPayload(content)) throw new AutoReplyAgentHandoffError('模型判断当前问题无法安全自动处理');
      await this.options.onTrace?.(trace);
      return content;
    }

    throw new AutoReplyAgentError('AGENT_MAX_LOOPS');
  }

  private toInitialContext(context: AutoReplyContext, classification: AutoReplyClassification): Record<string, unknown> {
    return {
      accountId: context.conversation.accountId,
      conversationId: context.conversation.id,
      buyerRef: context.conversation.buyerRef,
      buyerName: context.conversation.buyerDisplayName,
      itemRef: context.conversation.itemRef,
      itemTitle: context.conversation.itemTitle,
      currentMessage: { bodyType: context.inboundMessage.bodyType, bodyText: trimField(context.inboundMessage.bodyText, 2_000), createdAt: context.inboundMessage.createdAt },
      classification: { intent: classification.intent, confidence: classification.confidence, riskFlags: classification.riskFlags },
    };
  }

  private async executeTool(name: AutoReplyToolName, args: Record<string, unknown>, adminId: string, context: AutoReplyContext, config: AutoReplyAgentConfig): Promise<Record<string, unknown>> {
    switch (name) {
      case 'get_buyer_conversations': return this.getBuyerConversations(adminId, context, numberArg(args.maxMessagesPerConversation, config.maxHistory));
      case 'get_product_info': return this.getProductInfo(adminId, context, stringArg(args.productRef));
      case 'get_buyer_orders': return this.getBuyerOrders(adminId, context, numberArg(args.maxOrders, 20));
      case 'list_shop_products': return this.listShopProducts(adminId, context, stringArg(args.keyword), numberArg(args.limit, 10));
    }
  }

  private async getBuyerConversations(adminId: string, context: AutoReplyContext, maxMessagesPerConversation: number): Promise<Record<string, unknown>> {
    const conversations: ConversationRecord[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const result = await this.store.listConversations(adminId, { accountId: context.conversation.accountId, limit: 100, cursor });
      conversations.push(...result.items.filter((item) => item.accountId === context.conversation.accountId && item.buyerRef === context.conversation.buyerRef));
      if (!result.hasMore || !result.nextCursor) break;
      cursor = result.nextCursor;
    }
    const items = await Promise.all(conversations.slice(0, 50).map(async (conversation) => {
      const history = await this.store.listMessages(adminId, conversation.id, { limit: Math.min(20, maxMessagesPerConversation) });
      return {
        conversationId: conversation.id,
        itemRef: conversation.itemRef,
        itemTitle: conversation.itemTitle,
        lastMessageAt: conversation.lastMessageAt,
        messages: history.items.slice(-maxMessagesPerConversation).map((message) => safeMessage(message)),
      };
    }));
    return { ok: true, buyerRef: context.conversation.buyerRef, conversations: items };
  }

  private async getProductInfo(adminId: string, context: AutoReplyContext, requestedRef?: string): Promise<Record<string, unknown>> {
    const productRef = requestedRef?.trim() || context.conversation.itemRef;
    if (!productRef) return { ok: false, code: 'PRODUCT_REF_REQUIRED' };
    // External Xianyu item refs are commonly numeric while the local product
    // primary key is a UUID. Avoid sending an external ref through the UUID
    // lookup path, which would make PostgreSQL reject the value before the
    // scoped external-ref query gets a chance to resolve it.
    const byId = isUuid(productRef) ? await this.store.getProduct(adminId, productRef) : undefined;
    if (byId && byId.accountId === context.conversation.accountId) return { ok: true, product: safeProduct(byId) };
    const result = await this.store.listProducts(adminId, { accountId: context.conversation.accountId, keyword: productRef, page: 1, pageSize: 100 });
    const product = result.items.find((item) => item.accountId === context.conversation.accountId && (item.id === productRef || item.externalProductRef === productRef || item.title === productRef));
    return product ? { ok: true, product: safeProduct(product) } : { ok: false, code: 'PRODUCT_NOT_FOUND', productRef };
  }

  private async getBuyerOrders(adminId: string, context: AutoReplyContext, maxOrders: number): Promise<Record<string, unknown>> {
    const orders: OrderRecord[] = [];
    for (let page = 1; page <= 1_000; page += 1) {
      const result = await this.store.listOrders(adminId, { accountId: context.conversation.accountId, page, pageSize: 100 });
      orders.push(...result.items.filter((order) => order.accountId === context.conversation.accountId && (order.buyerId === context.conversation.buyerRef || order.conversationId === context.conversation.id)));
      if (page >= result.totalPages || result.items.length === 0) break;
      if (page === 1_000) throw new AutoReplyAgentError('AGENT_ORDER_CONTEXT_INCOMPLETE');
    }
    return { ok: true, orders: orders.slice(0, maxOrders).map(safeOrder), totalMatched: orders.length };
  }

  private async listShopProducts(adminId: string, context: AutoReplyContext, keyword: string | undefined, limit: number): Promise<Record<string, unknown>> {
    const normalizedKeyword = keyword?.trim() || undefined;
    const products: ProductRecord[] = [];
    let total = 0;
    for (let page = 1; page <= 1_000; page += 1) {
      const result = await this.store.listProducts(adminId, { accountId: context.conversation.accountId, keyword: normalizedKeyword, page, pageSize: 100 });
      products.push(...result.items.filter((product) => product.accountId === context.conversation.accountId));
      total = result.total;
      if (page >= result.totalPages || result.items.length === 0) break;
      if (page === 1_000) throw new AutoReplyAgentError('AGENT_PRODUCT_CONTEXT_INCOMPLETE');
    }
    return { ok: true, keyword: normalizedKeyword, products: products.slice(0, limit).map(safeProduct), total };
  }
}

function parseToolCall(call: ModelToolCall): { name: AutoReplyToolName; arguments: Record<string, unknown> } {
  if (!call.id || call.type !== 'function') throw new AutoReplyAgentError('AGENT_INVALID_TOOL_CALL');
  if (!(AUTO_REPLY_TOOL_NAMES as readonly string[]).includes(call.function.name)) throw new AutoReplyAgentError('AGENT_UNKNOWN_TOOL');
  let parsed: unknown;
  try { parsed = JSON.parse(call.function.arguments || '{}'); } catch { throw new AutoReplyAgentError('AGENT_INVALID_TOOL_ARGUMENTS'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AutoReplyAgentError('AGENT_INVALID_TOOL_ARGUMENTS');
  const argumentsObject = parsed as Record<string, unknown>;
  validateToolArguments(call.function.name as AutoReplyToolName, argumentsObject);
  return { name: call.function.name as AutoReplyToolName, arguments: argumentsObject };
}

function validateToolArguments(name: AutoReplyToolName, args: Record<string, unknown>): void {
  const allowed = name === 'get_buyer_conversations' ? ['maxMessagesPerConversation']
    : name === 'get_product_info' ? ['productRef']
      : name === 'get_buyer_orders' ? ['maxOrders']
        : ['keyword', 'limit'];
  if (Object.keys(args).some((key) => !allowed.includes(key))) throw new AutoReplyAgentError('AGENT_INVALID_TOOL_ARGUMENTS');
  if ('productRef' in args && (typeof args.productRef !== 'string' || args.productRef.length > 120)) throw new AutoReplyAgentError('AGENT_INVALID_TOOL_ARGUMENTS');
  if ('keyword' in args && (typeof args.keyword !== 'string' || args.keyword.length > 120)) throw new AutoReplyAgentError('AGENT_INVALID_TOOL_ARGUMENTS');
  for (const key of ['maxMessagesPerConversation', 'maxOrders', 'limit']) {
    if (key in args && (typeof args[key] !== 'number' || !Number.isInteger(args[key]) || (args[key] as number) < 1 || (args[key] as number) > 50)) throw new AutoReplyAgentError('AGENT_INVALID_TOOL_ARGUMENTS');
  }
}

function renderUserPrompt(template: string, context: Record<string, unknown>): string {
  return template.replaceAll('{{context}}', JSON.stringify(context, null, 2));
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, 120) : undefined;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function numberArg(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(50, Math.trunc(value))) : fallback;
}

function trimField(value: string | undefined, limit: number): string | undefined {
  const normalized = value?.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return normalized ? (normalized.length > limit ? `${normalized.slice(0, limit - 1).trim()}…` : normalized) : undefined;
}

function limitText(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function safeMessage(message: MessageRecord): Record<string, unknown> {
  return { direction: message.direction, senderRole: message.senderRole, bodyType: message.bodyType, bodyText: trimField(message.bodyText, 1_000), createdAt: message.createdAt };
}

function safeProduct(product: Pick<ProductRecord, 'id' | 'accountId' | 'externalProductRef' | 'title' | 'description' | 'defaultReplyTemplate' | 'priceMinor' | 'status' | 'updatedAt'>): Record<string, unknown> {
  return { id: product.id, externalProductRef: product.externalProductRef, title: trimField(product.title, 500), description: trimField(product.description, 2_000), priceMinor: product.priceMinor, status: product.status, updatedAt: product.updatedAt, defaultReplyTemplate: trimField(product.defaultReplyTemplate, 500) };
}

function safeOrder(order: OrderRecord): Record<string, unknown> {
  return { orderNo: order.orderNo, itemId: order.itemId, itemTitle: trimField(order.itemTitle, 500), paymentStatus: order.paymentStatus, orderStatus: order.orderStatus, deliveryStatus: order.deliveryStatus, afterSalesStatus: order.afterSalesStatus, createdAt: order.createdAt, updatedAt: order.updatedAt };
}

function isHandoffPayload(content: string): boolean {
  if (/^handoff\b/i.test(content.trim())) return true;
  try {
    const parsed = JSON.parse(content) as unknown;
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as { decision?: unknown }).decision === 'handoff');
  } catch {
    return false;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new AutoReplyAgentError('AGENT_TOOL_TIMEOUT')), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
