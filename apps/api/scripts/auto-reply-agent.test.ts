import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAutoReplyAgentConfig } from '../src/auto-reply-agent-config.js';
import { AUTO_REPLY_AGENT_TOOLS, ToolCallingAutoReplyAgent, type AutoReplyAgentTrace } from '../src/auto-reply-agent.js';
import { AutoReplyService, NoopAutoReplySender, type AutoReplyClassification, type AutoReplyContext } from '../src/auto-reply.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { OpenAICompatibleModelClient, type ModelClient, type ModelMessage } from '../src/pi-runtime.js';
import type { Store } from '../src/domain.js';

function context(overrides: Record<string, unknown> = {}): AutoReplyContext {
  return {
    conversation: {
      id: 'conversation-1', accountId: 'account-1', buyerRef: 'buyer-1', buyerDisplayName: '买家', itemRef: 'item-1', itemTitle: '资料包', unreadCount: 1, handlingMode: 'ai', version: 1,
      createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
    },
    inboundMessage: { id: 'message-1', conversationId: 'conversation-1', accountId: 'account-1', direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '这个是什么？', redactionState: 'visible', status: 'created', readStatus: 0, riskFlags: [], handlingMode: 'ai', createdAt: '2026-09-21T00:00:00.000Z' },
    recentMessages: [], product: undefined, orders: [], ...overrides,
  } as unknown as AutoReplyContext;
}

const classification: AutoReplyClassification = { intent: 'general', confidence: 0.9, decision: 'replied', riskFlags: [] };

test('buyer Agent configuration resolves independently from Workspace settings', () => {
  const config = resolveAutoReplyAgentConfig({ AUTO_REPLY_AGENT_MAX_LOOPS: '9', AUTO_REPLY_AGENT_MAX_TOOL_CALLS: '2', AUTO_REPLY_AGENT_DEBOUNCE_MS: '1500', AUTO_REPLY_AGENT_SYSTEM_PROMPT: '买家专用提示词' });
  assert.equal(config.maxLoops, 8);
  assert.equal(config.maxToolCalls, 2);
  assert.equal(config.debounceMs, 1_500);
  assert.equal(config.systemPrompt, '买家专用提示词');
  assert.notEqual(config.digest, '');
});

test('buyer Agent enforces a 30-character minimum max reply length', () => {
  const config = resolveAutoReplyAgentConfig({ AUTO_REPLY_AGENT_MAX_REPLY_LENGTH: '20' });
  assert.equal(config.maxReplyLength, 30);
  const accepted = resolveAutoReplyAgentConfig({ AUTO_REPLY_AGENT_MAX_REPLY_LENGTH: '30' });
  assert.equal(accepted.maxReplyLength, 30);
});

test('buyer Agent can resolve the latest persisted configuration per message', async () => {
  const seenPrompts: string[] = [];
  const providerArgs: Array<[string, string]> = [];
  const client: ModelClient = { complete: async (request) => { seenPrompts.push(request.messages[0]?.content ?? ''); return { content: '已按最新配置处理。', model: 'test' }; } };
  const store = {} as Store;
  const updated = resolveAutoReplyAgentConfig({ AUTO_REPLY_AGENT_SYSTEM_PROMPT: '设置页最新提示词', AUTO_REPLY_AGENT_CONFIG_VERSION: 'settings-v2' });
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}), { configProvider: async (adminId, accountId) => { providerArgs.push([adminId, accountId]); return updated; } });
  const reply = await agent.generate({ adminId: 'admin-1', context: context(), classification });
  assert.equal(reply, '已按最新配置处理。');
  assert.deepEqual(seenPrompts, ['设置页最新提示词']);
  assert.deepEqual(providerArgs, [['admin-1', 'account-1']]);
});

test('agent chooses product tool then returns final answer', async () => {
  const requests: Array<{ messages: ModelMessage[]; tools?: unknown[] }> = [];
  let call = 0;
  const client: ModelClient = {
    complete: async (request) => {
      requests.push(request);
      call += 1;
      if (call === 1) return { content: '', model: 'test', toolCalls: [{ id: 'tool-1', type: 'function', function: { name: 'get_product_info', arguments: '{}' } }] };
      return { content: '这是一个数字资料包，页面显示价格为 19.99 元。', model: 'test' };
    },
  };
  const product = { id: 'product-1', accountId: 'account-1', externalProductRef: 'item-1', title: '资料包', description: '数字资料', defaultReplyTemplate: undefined, aiPrompt: undefined, priceMinor: 1_999, status: 'published', updatedAt: '2026-09-21T00:00:00.000Z' };
  const store = { getProduct: async () => product, listProducts: async () => ({ items: [product], page: 1, pageSize: 100, total: 1, totalPages: 1 }) } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  const reply = await agent.generate({ adminId: 'admin-1', context: context(), classification });
  assert.equal(reply, '这是一个数字资料包，页面显示价格为 19.99 元。');
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.tools?.length, AUTO_REPLY_AGENT_TOOLS.length);
  assert.equal(requests[1]?.messages.at(-1)?.role, 'tool');
  assert.match(requests[1]?.messages.at(-1)?.content ?? '', /资料包/);
});

test('agent preserves model-provided semantic segments and supports a segmentation retry', async () => {
  let calls = 0;
  const client: ModelClient = {
    complete: async () => {
      calls += 1;
      if (calls === 1) return { content: JSON.stringify({ text: '先说明商品是什么。再说明使用方式。', segments: ['先说明商品是什么。', '再说明使用方式。'] }), model: 'test' };
      return { content: JSON.stringify({ segments: ['第一句。', '第二句。'] }), model: 'test' };
    },
  };
  const agent = new ToolCallingAutoReplyAgent({} as Store, client, resolveAutoReplyAgentConfig({}));
  const generated = await agent.generate({ adminId: 'admin-1', context: context(), classification });
  assert.deepEqual(generated, { text: '先说明商品是什么。再说明使用方式。', segments: ['先说明商品是什么。', '再说明使用方式。'] });
  const retried = await agent.segmentReply({ reply: '第一句。第二句。' });
  assert.deepEqual(retried, ['第一句。', '第二句。']);
});

test('OpenAI-compatible transport preserves native tool calls', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ model: 'test', choices: [{ message: { content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_product_info', arguments: '{}' } }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const client = new OpenAICompatibleModelClient({ apiKey: 'test-key', baseUrl: 'https://model.example/v1', model: 'test-model' });
    const result = await client.complete({ messages: [{ role: 'user', content: '查询商品' }], tools: AUTO_REPLY_AGENT_TOOLS, toolChoice: 'auto' });
    assert.equal((requestBody?.tools as unknown[]).length, AUTO_REPLY_AGENT_TOOLS.length);
    assert.equal(requestBody?.tool_choice, 'auto');
    assert.equal(result.content, '');
    assert.equal(result.toolCalls?.[0]?.function.name, 'get_product_info');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buyer conversation tool filters same buyer across products and orders', async () => {
  const conversations = [
    { id: 'conversation-1', accountId: 'account-1', buyerRef: 'buyer-1', itemRef: 'item-1', itemTitle: '商品一', unreadCount: 0, handlingMode: 'ai', version: 1 },
    { id: 'conversation-2', accountId: 'account-1', buyerRef: 'buyer-1', itemRef: 'item-2', itemTitle: '商品二', unreadCount: 0, handlingMode: 'ai', version: 1 },
    { id: 'conversation-other', accountId: 'account-1', buyerRef: 'buyer-other', itemRef: 'item-3', itemTitle: '其他商品', unreadCount: 0, handlingMode: 'ai', version: 1 },
    { id: 'conversation-other-account', accountId: 'account-2', buyerRef: 'buyer-1', itemRef: 'item-99', itemTitle: '其他账号商品', unreadCount: 0, handlingMode: 'ai', version: 1 },
  ];
  const calls: string[] = [];
  const conversationQueries: Array<{ accountId?: string; limit?: number; cursor?: string }> = [];
  const client: ModelClient = {
    complete: async (request) => {
      calls.push(request.messages.at(-1)?.content ?? '');
      if (calls.length === 1) return { content: '', model: 'test', toolCalls: [{ id: 'tool-conversations', type: 'function', function: { name: 'get_buyer_conversations', arguments: '{}' } }] };
      return { content: '我已结合你之前咨询的商品信息说明。', model: 'test' };
    },
  };
  const store = {
    listConversations: async (_adminId: string, query: { accountId?: string; limit?: number; cursor?: string }) => { conversationQueries.push(query); return { items: conversations, hasMore: false }; },
    listMessages: async (_adminId: string, conversationId: string) => ({ items: [{ conversationId, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: conversationId, createdAt: '2026-09-21T00:00:00.000Z' }], hasMore: false, latestCursor: 1, hasMoreHistory: false }),
  } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  await agent.generate({ adminId: 'admin-1', context: context(), classification });
  const toolPayload = JSON.parse(calls[1] ?? '{}') as { conversations: Array<{ conversationId: string; itemRef?: string }> };
  assert.equal(conversationQueries[0]?.accountId, 'account-1');
  assert.deepEqual(toolPayload.conversations.map((item) => item.conversationId), ['conversation-1', 'conversation-2']);
  assert.deepEqual(toolPayload.conversations.map((item) => item.itemRef), ['item-1', 'item-2']);
});

test('buyer orders tool reads all pages and filters buyer/account scope', async () => {
  const pages = [
    { items: [{ orderNo: 'buyer-1-page-1', accountId: 'account-1', buyerId: 'buyer-1', itemId: 'item-1', itemTitle: '商品一', paymentStatus: 'unpaid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' }, { orderNo: 'other-buyer', accountId: 'account-1', buyerId: 'buyer-other', itemId: 'item-1', itemTitle: '商品一', paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' }, { orderNo: 'other-account-same-buyer', accountId: 'account-2', buyerId: 'buyer-1', itemId: 'item-99', itemTitle: '其他账号商品', paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' }], totalPages: 2 },
    { items: [{ orderNo: 'buyer-1-page-2', accountId: 'account-1', buyerId: 'buyer-1', itemId: 'item-2', itemTitle: '商品二', paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'shipped', afterSalesStatus: 'none', createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z' }], totalPages: 2 },
  ];
  const requestedPages: number[] = [];
  const requestedAccountIds: Array<string | undefined> = [];
  let orderToolPayload: string | undefined;
  const client: ModelClient = {
    complete: async (request) => {
      if (request.messages.at(-1)?.role === 'tool') {
        orderToolPayload = request.messages.at(-1)?.content;
        return { content: '订单信息已确认。', model: 'test' };
      }
      return { content: '', model: 'test', toolCalls: [{ id: 'tool-orders', type: 'function', function: { name: 'get_buyer_orders', arguments: '{}' } }] };
    },
  };
  const store = { listOrders: async (_adminId: string, query: { page?: number; accountId?: string }) => { requestedPages.push(query.page ?? 0); requestedAccountIds.push(query.accountId); return pages[(query.page ?? 1) - 1] as never; } } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  const reply = await agent.generate({ adminId: 'admin-1', context: context(), classification });
  assert.equal(reply, '订单信息已确认。');
  assert.deepEqual(requestedPages, [1, 2]);
  assert.deepEqual(requestedAccountIds, ['account-1', 'account-1']);
  const orderPayload = JSON.parse(orderToolPayload ?? '{}') as { orders: Array<{ orderNo: string }> };
  assert.deepEqual(orderPayload.orders.map((order) => order.orderNo), ['buyer-1-page-1', 'buyer-1-page-2']);
});

test('product tool resolves external numeric refs without UUID lookup and stays account scoped', async () => {
  const product = { id: 'product-account-1', accountId: 'account-1', externalProductRef: '1078553391460', title: '数字资料包', description: '公开说明', priceMinor: 1_999, status: 'published', updatedAt: '2026-09-21T00:00:00.000Z' };
  const foreignProduct = { id: 'product-account-2', accountId: 'account-2', externalProductRef: '1078553391460', title: '其他账号商品', status: 'published', updatedAt: '2026-09-21T00:00:00.000Z' };
  let getProductCalls = 0;
  let productQuery: { accountId?: string; keyword?: string; page?: number; pageSize?: number } | undefined;
  let toolPayload: string | undefined;
  const client: ModelClient = {
    complete: async (request) => {
      if (request.messages.at(-1)?.role === 'tool') {
        toolPayload = request.messages.at(-1)?.content;
        return { content: '这是数字资料包。', model: 'test' };
      }
      return { content: '', model: 'test', toolCalls: [{ id: 'tool-product-external', type: 'function', function: { name: 'get_product_info', arguments: JSON.stringify({ productRef: '1078553391460' }) } }] };
    },
  };
  const store = {
    getProduct: async () => { getProductCalls += 1; throw new Error('UUID_LOOKUP_SHOULD_NOT_RUN'); },
    listProducts: async (_adminId: string, query: { accountId?: string; keyword?: string; page?: number; pageSize?: number }) => { productQuery = query; return { items: [foreignProduct, product], page: 1, pageSize: 100, total: 2, totalPages: 1 }; },
  } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  const reply = await agent.generate({ adminId: 'admin-1', context: { ...context(), conversation: { ...context().conversation, itemRef: '1078553391460' } }, classification });
  assert.equal(reply, '这是数字资料包。');
  assert.equal(getProductCalls, 0);
  assert.deepEqual(productQuery, { accountId: 'account-1', keyword: '1078553391460', page: 1, pageSize: 100 });
  const payload = JSON.parse(toolPayload ?? '{}') as { ok: boolean; product?: { externalProductRef?: string; title?: string } };
  assert.equal(payload.ok, true);
  assert.equal(payload.product?.externalProductRef, '1078553391460');
  assert.equal(payload.product?.title, '数字资料包');
});

test('shop product tool searches keyword, paginates, limits results, and excludes other accounts', async () => {
  const pageResults = [
    {
      items: [
        { id: 'foreign-product', accountId: 'account-2', externalProductRef: 'foreign-earbuds', title: '其他账号耳机', status: 'published', updatedAt: '2026-09-21T00:00:00.000Z' },
        { id: 'earbuds-a', accountId: 'account-1', externalProductRef: 'earbuds-a', title: '蓝牙耳机 A', status: 'published', updatedAt: '2026-09-21T00:00:00.000Z' },
      ],
      page: 1,
      pageSize: 100,
      total: 2,
      totalPages: 2,
    },
    {
      items: [{ id: 'earbuds-b', accountId: 'account-1', externalProductRef: 'earbuds-b', title: '蓝牙耳机 B', status: 'published', updatedAt: '2026-09-21T00:00:00.000Z' }],
      page: 2,
      pageSize: 100,
      total: 2,
      totalPages: 2,
    },
  ];
  const queries: Array<{ accountId?: string; keyword?: string; page?: number; pageSize?: number }> = [];
  let toolPayload: string | undefined;
  const client: ModelClient = {
    complete: async (request) => {
      if (request.messages.at(-1)?.role === 'tool') {
        toolPayload = request.messages.at(-1)?.content;
        return { content: '有两款相关耳机可以选择。', model: 'test' };
      }
      return { content: '', model: 'test', toolCalls: [{ id: 'tool-shop-products', type: 'function', function: { name: 'list_shop_products', arguments: JSON.stringify({ keyword: '耳机', limit: 2 }) } }] };
    },
  };
  const store = {
    listProducts: async (_adminId: string, query: { accountId?: string; keyword?: string; page?: number; pageSize?: number }) => { queries.push(query); return pageResults[(query.page ?? 1) - 1]!; },
  } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  const reply = await agent.generate({ adminId: 'admin-1', context: context(), classification });
  assert.equal(reply, '有两款相关耳机可以选择。');
  assert.deepEqual(queries, [
    { accountId: 'account-1', keyword: '耳机', page: 1, pageSize: 100 },
    { accountId: 'account-1', keyword: '耳机', page: 2, pageSize: 100 },
  ]);
  const payload = JSON.parse(toolPayload ?? '{}') as { ok: boolean; keyword?: string; total?: number; products: Array<{ id: string; accountId?: string }> };
  assert.equal(payload.ok, true);
  assert.equal(payload.keyword, '耳机');
  assert.equal(payload.total, 2);
  assert.deepEqual(payload.products.map((product) => product.id), ['earbuds-a', 'earbuds-b']);
  assert.equal(payload.products.some((product) => product.id === 'foreign-product'), false);
});

test('insufficient product facts return not-found and hand off instead of guessing', async () => {
  let toolPayload: string | undefined;
  const client: ModelClient = {
    complete: async (request) => {
      if (request.messages.at(-1)?.role === 'tool') {
        toolPayload = request.messages.at(-1)?.content;
        return { content: JSON.stringify({ decision: 'handoff', reason: '商品事实不足' }), model: 'test' };
      }
      return { content: '', model: 'test', toolCalls: [{ id: 'tool-product-missing', type: 'function', function: { name: 'get_product_info', arguments: JSON.stringify({ productRef: 'missing-item' }) } }] };
    },
  };
  const store = {
    getProduct: async () => undefined,
    listProducts: async () => ({ items: [], page: 1, pageSize: 100, total: 0, totalPages: 1 }),
  } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  await assert.rejects(() => agent.generate({ adminId: 'admin-1', context: context(), classification }), (error: unknown) => (error as { code?: string }).code === 'AGENT_HANDOFF');
  const payload = JSON.parse(toolPayload ?? '{}') as { ok: boolean; code?: string; productRef?: string };
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'PRODUCT_NOT_FOUND');
  assert.equal(payload.productRef, 'missing-item');
});

test('tool read errors stop generation before a synthesized reply', async () => {
  let calls = 0;
  const client: ModelClient = {
    complete: async () => { calls += 1; return { content: '', model: 'test', toolCalls: [{ id: 'tool-shop-error', type: 'function', function: { name: 'list_shop_products', arguments: '{}' } }] }; },
  };
  const store = { listProducts: async () => { throw new Error('PRODUCT_READ_FAILED'); } } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  await assert.rejects(() => agent.generate({ adminId: 'admin-1', context: context(), classification }), /PRODUCT_READ_FAILED/);
  assert.equal(calls, 1);
});

test('agent fails safely when loop limit is reached', async () => {
  let calls = 0;
  const client: ModelClient = { complete: async () => { calls += 1; return { content: '', model: 'test', toolCalls: [{ id: `tool-${calls}`, type: 'function', function: { name: 'get_product_info', arguments: JSON.stringify({ productRef: `item-${calls}` }) } }] }; } };
  const product = { id: 'product-1', accountId: 'account-1', externalProductRef: 'item-1', title: '资料包', status: 'published', updatedAt: '2026-09-21T00:00:00.000Z' };
  const store = { getProduct: async () => product, listProducts: async () => ({ items: [product], page: 1, pageSize: 100, total: 1, totalPages: 1 }) } as unknown as Store;
  const config = resolveAutoReplyAgentConfig({ AUTO_REPLY_AGENT_MAX_LOOPS: '2' });
  const traces: AutoReplyAgentTrace[] = [];
  const agent = new ToolCallingAutoReplyAgent(store, client, config, { onTrace: (trace) => { traces.push(trace); } });
  await assert.rejects(() => agent.generate({ adminId: 'admin-1', context: context(), classification }), /AGENT_MAX_LOOPS/);
  assert.equal(calls, 2);
  assert.deepEqual(traces, []);
});

test('agent rejects unknown tools and out-of-contract arguments', async () => {
  const client: ModelClient = {
    complete: async () => ({ content: '', model: 'test', toolCalls: [{ id: 'bad-tool', type: 'function', function: { name: 'get_product_info', arguments: '{"accountId":"other-account"}' } }] }),
  };
  const store = {} as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  await assert.rejects(() => agent.generate({ adminId: 'admin-1', context: context(), classification }), /AGENT_INVALID_TOOL_ARGUMENTS/);
});

test('auto-reply service debounces same-conversation messages and splits long replies', async () => {
  const runtime = createApp(loadConfig({ HOST: '127.0.0.1', PORT: '0', DATABASE_URL: '', REDIS_URL: '', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process', AUTO_REPLY_SEND_MODE: 'simulate', AUTO_REPLY_TEST_BUYER_NAMES: '["买家"]', AUTO_REPLY_AGENT_DEBOUNCE_MS: '1000', AUTO_REPLY_AGENT_REPLY_SEGMENT_DELAY_MS: '0' }));
  const admin = await runtime.store.createAdmin({ email: 'agent-debounce@example.com', passwordHash: 'hash', displayName: 'Agent Debounce' });
  const account = await runtime.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'agent-debounce-seller' });
  const conversation = await runtime.store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-1', buyerDisplayName: '买家', externalConversationRef: 'agent-debounce-conversation' });
  const outboundTexts: string[] = [];
  const sender = new NoopAutoReplySender();
  const autoReply = new AutoReplyService(runtime.store, runtime.messages, async () => 'audit-agent-debounce', {
    sendMode: 'simulate', testBuyerNames: ['买家'], debounceMs: 1_000, maxReplyLength: 500,
    generator: { generate: async () => '已收到。' },
    sender,
  });
  await runtime.listen();
  try {
    const first = await runtime.store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '你好', externalMessageRef: 'agent-debounce-1.PNM', source: 'system', traceId: 'agent-debounce-1' });
    const second = await runtime.store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '还有吗', externalMessageRef: 'agent-debounce-2.PNM', source: 'system', traceId: 'agent-debounce-2' });
    const firstResult = await autoReply.processInbound({ adminId: admin.id, conversationId: conversation.id, inboundMessageId: first.message.id, senderName: '买家' });
    const secondResult = await autoReply.processInbound({ adminId: admin.id, conversationId: conversation.id, inboundMessageId: second.message.id, senderName: '买家' });
    assert.equal(firstResult.run.status, 'persisted');
    assert.equal(secondResult.run.failureCode, 'AUTO_REPLY_DEBOUNCED');
    const longSender = new NoopAutoReplySender();
    const semanticSegments = ['这是商品的第一部分说明。', '这是商品的第二部分说明。', '如果你需要，我还可以继续补充。'];
    const longReply = new AutoReplyService(runtime.store, runtime.messages, async () => 'audit-agent-segments', {
      sendMode: 'simulate', testBuyerNames: ['买家'], debounceMs: 0, maxReplyLength: 500, replySegmentDelayMs: 0,
      generator: { generate: async () => ({ text: semanticSegments.join(''), segments: semanticSegments }) },
      sender: longSender,
    });
    const third = await runtime.store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '请详细介绍', externalMessageRef: 'agent-debounce-3.PNM', source: 'system', traceId: 'agent-debounce-3' });
    const thirdResult = await longReply.processInbound({ adminId: admin.id, conversationId: conversation.id, inboundMessageId: third.message.id, senderName: '买家' });
    assert.equal(thirdResult.run.status, 'persisted');
    const messages = await runtime.messages.listMessages(admin.id, conversation.id, { limit: 20 });
    outboundTexts.push(...messages.items.filter((message) => message.direction === 'outbound').map((message) => message.bodyText ?? ''));
    assert.equal(longSender.calls.length, semanticSegments.length);
    assert.deepEqual(longSender.calls.map((call) => call.text), semanticSegments);
    assert.deepEqual(outboundTexts.filter((text) => semanticSegments.includes(text)).sort(), [...semanticSegments].sort());

    const retrySender = new NoopAutoReplySender();
    const retrySegments = ['第一段说明商品内容，包含商品适用范围、交付形式和注意事项，方便买家先了解整体内容。', '第二段说明使用方式，包含查看步骤、使用限制和后续支持方式，买家可以按步骤操作。'];
    let retryCalls = 0;
    const retryReply = new AutoReplyService(runtime.store, runtime.messages, async () => 'audit-agent-segmentation-retry', {
      sendMode: 'simulate', testBuyerNames: ['买家'], debounceMs: 0, maxReplyLength: 500, replySegmentDelayMs: 0,
      generator: {
        generate: async () => retrySegments.join('\n'),
        segmentReply: async ({ reply }) => { retryCalls += 1; assert.equal(reply, retrySegments.join('\n')); return retrySegments; },
      },
      sender: retrySender,
    });
    const fourth = await runtime.store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '请再说明一下', externalMessageRef: 'agent-debounce-4.PNM', source: 'system', traceId: 'agent-debounce-4' });
    const fourthResult = await retryReply.processInbound({ adminId: admin.id, conversationId: conversation.id, inboundMessageId: fourth.message.id, senderName: '买家' });
    assert.equal(fourthResult.run.status, 'persisted');
    assert.equal(retryCalls, 1);
    assert.deepEqual(retrySender.calls.map((call) => call.text), retrySegments);
  } finally {
    await runtime.close();
  }
});
