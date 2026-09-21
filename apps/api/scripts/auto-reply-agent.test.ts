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

test('buyer Agent can resolve the latest persisted configuration per message', async () => {
  const seenPrompts: string[] = [];
  const client: ModelClient = { complete: async (request) => { seenPrompts.push(request.messages[0]?.content ?? ''); return { content: '已按最新配置处理。', model: 'test' }; } };
  const store = {} as Store;
  const updated = resolveAutoReplyAgentConfig({ AUTO_REPLY_AGENT_SYSTEM_PROMPT: '设置页最新提示词', AUTO_REPLY_AGENT_CONFIG_VERSION: 'settings-v2' });
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}), { configProvider: async () => updated });
  const reply = await agent.generate({ adminId: 'admin-1', context: context(), classification });
  assert.equal(reply, '已按最新配置处理。');
  assert.deepEqual(seenPrompts, ['设置页最新提示词']);
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
  ];
  const calls: string[] = [];
  const client: ModelClient = {
    complete: async (request) => {
      calls.push(request.messages.at(-1)?.content ?? '');
      if (calls.length === 1) return { content: '', model: 'test', toolCalls: [{ id: 'tool-conversations', type: 'function', function: { name: 'get_buyer_conversations', arguments: '{}' } }] };
      return { content: '我已结合你之前咨询的商品信息说明。', model: 'test' };
    },
  };
  const store = {
    listConversations: async () => ({ items: conversations, hasMore: false }),
    listMessages: async (_adminId: string, conversationId: string) => ({ items: [{ conversationId, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: conversationId, createdAt: '2026-09-21T00:00:00.000Z' }], hasMore: false, latestCursor: 1, hasMoreHistory: false }),
  } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  await agent.generate({ adminId: 'admin-1', context: context(), classification });
  const toolPayload = JSON.parse(calls[1] ?? '{}') as { conversations: Array<{ conversationId: string; itemRef?: string }> };
  assert.deepEqual(toolPayload.conversations.map((item) => item.conversationId), ['conversation-1', 'conversation-2']);
  assert.deepEqual(toolPayload.conversations.map((item) => item.itemRef), ['item-1', 'item-2']);
});

test('buyer orders tool reads all pages and filters buyer/account scope', async () => {
  const pages = [
    { items: [{ orderNo: 'buyer-1-page-1', accountId: 'account-1', buyerId: 'buyer-1', itemId: 'item-1', itemTitle: '商品一', paymentStatus: 'unpaid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' }, { orderNo: 'other-buyer', accountId: 'account-1', buyerId: 'buyer-other', itemId: 'item-1', itemTitle: '商品一', paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' }], totalPages: 2 },
    { items: [{ orderNo: 'buyer-1-page-2', accountId: 'account-1', buyerId: 'buyer-1', itemId: 'item-2', itemTitle: '商品二', paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'shipped', afterSalesStatus: 'none', createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z' }], totalPages: 2 },
  ];
  const requestedPages: number[] = [];
  const client: ModelClient = {
    complete: async (request) => request.messages.at(-1)?.role === 'tool'
      ? { content: '订单信息已确认。', model: 'test' }
      : { content: '', model: 'test', toolCalls: [{ id: 'tool-orders', type: 'function', function: { name: 'get_buyer_orders', arguments: '{}' } }] },
  };
  const store = { listOrders: async (_adminId: string, query: { page?: number }) => { requestedPages.push(query.page ?? 0); return pages[(query.page ?? 1) - 1] as never; } } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  const reply = await agent.generate({ adminId: 'admin-1', context: context(), classification });
  assert.equal(reply, '订单信息已确认。');
  assert.deepEqual(requestedPages, [1, 2]);
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
  const runtime = createApp(loadConfig({ HOST: '127.0.0.1', PORT: '0', DATABASE_URL: '', REDIS_URL: '', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process', AUTO_REPLY_SEND_MODE: 'simulate', AUTO_REPLY_TEST_BUYER_NAMES: '["买家"]', AUTO_REPLY_AGENT_DEBOUNCE_MS: '1000', AUTO_REPLY_AGENT_REPLY_SEGMENT_CHARS: '8', AUTO_REPLY_AGENT_MAX_REPLY_SEGMENTS: '4', AUTO_REPLY_AGENT_REPLY_SEGMENT_DELAY_MS: '0' }));
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
    const longReply = new AutoReplyService(runtime.store, runtime.messages, async () => 'audit-agent-segments', {
      sendMode: 'simulate', testBuyerNames: ['买家'], debounceMs: 0, maxReplyLength: 500, maxReplySegmentChars: 40, maxReplySegments: 4, replySegmentDelayMs: 0,
      generator: { generate: async () => '这是第一段很长的内容，用于模拟人工分段发送。'.repeat(4) },
      sender: longSender,
    });
    const third = await runtime.store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '请详细介绍', externalMessageRef: 'agent-debounce-3.PNM', source: 'system', traceId: 'agent-debounce-3' });
    const thirdResult = await longReply.processInbound({ adminId: admin.id, conversationId: conversation.id, inboundMessageId: third.message.id, senderName: '买家' });
    assert.equal(thirdResult.run.status, 'persisted');
    const messages = await runtime.messages.listMessages(admin.id, conversation.id, { limit: 20 });
    outboundTexts.push(...messages.items.filter((message) => message.direction === 'outbound').map((message) => message.bodyText ?? ''));
    assert.ok(outboundTexts.length > 1);
    assert.equal(longSender.calls.length, outboundTexts.length - 1);
  } finally {
    await runtime.close();
  }
});
