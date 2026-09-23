import assert from 'node:assert/strict';
import test from 'node:test';
import { composeAutoReplyAgentSystemPrompt, resolveAutoReplyAgentConfig } from '../src/auto-reply-agent-config.js';
import { AUTO_REPLY_AGENT_TOOLS, ToolCallingAutoReplyAgent, type AutoReplyAgentTrace } from '../src/auto-reply-agent.js';
import { AutoReplyService, NoopAutoReplySender, type AutoReplyClassification, type AutoReplyContext, type AutoReplyGeneratorObservation } from '../src/auto-reply.js';
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

function replyPayload(text: string, segments?: string[]): string {
  return JSON.stringify({ decision: 'reply', text, ...(segments ? { segments } : {}) });
}

function contentText(value: ModelMessage['content'] | undefined): string {
  return typeof value === 'string' ? value : '';
}

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
  const client: ModelClient = { complete: async (request) => { seenPrompts.push(typeof request.messages[0]?.content === 'string' ? request.messages[0].content : ''); return { content: replyPayload('已按最新配置处理。'), model: 'test' }; } };
  const store = {} as Store;
  const updated = resolveAutoReplyAgentConfig({ AUTO_REPLY_AGENT_SYSTEM_PROMPT: '设置页最新提示词', AUTO_REPLY_AGENT_CONFIG_VERSION: 'settings-v2' });
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}), { configProvider: async (adminId, accountId) => { providerArgs.push([adminId, accountId]); return updated; } });
  const reply = await agent.generate({ adminId: 'admin-1', context: context(), classification });
  assert.deepEqual(reply, { text: '已按最新配置处理。', segments: undefined });
  assert.equal(seenPrompts.length, 1);
  assert.match(seenPrompts[0] ?? '', /^设置页最新提示词/);
  assert.deepEqual(providerArgs, [['admin-1', 'account-1']]);
});

test('account persona supplements base system rules instead of replacing them', () => {
  const base = resolveAutoReplyAgentConfig({});
  const prompt = composeAutoReplyAgentSystemPrompt(base.systemPrompt, '请使用更自然、更像真人的语气回复。');
  assert.match(prompt, /你只能根据当前买家消息和只读工具返回的真实事实作答/);
  assert.match(prompt, /请使用更自然、更像真人的语气回复/);
  assert.match(prompt, /账号级提示只影响表达风格/);
  assert.ok(prompt.indexOf('你只能根据当前买家消息') < prompt.indexOf('请使用更自然、更像真人的语气回复'));
});

test('agent system contract requires relevant tools before handoff', async () => {
  let systemPrompt = '';
  const client: ModelClient = {
    complete: async (request) => {
      systemPrompt = contentText(request.messages[0]?.content);
      return { content: replyPayload('我先根据当前事实回复。'), model: 'test' };
    },
  };
  const agent = new ToolCallingAutoReplyAgent({} as Store, client, resolveAutoReplyAgentConfig({}));
  await agent.generate({ adminId: 'admin-1', context: context(), classification });
  assert.match(systemPrompt, /上下文不足但相关只读工具可能补足事实时，必须先调用工具/);
  assert.match(systemPrompt, /handoff 只能作为最后手段/);
  assert.match(systemPrompt, /工具已经尝试且仍无结果、工具失败/);
});

test('agent chooses product tool then returns final answer', async () => {
  const requests: Array<{ messages: ModelMessage[]; tools?: unknown[] }> = [];
  let call = 0;
  const client: ModelClient = {
    complete: async (request) => {
      requests.push(request);
      call += 1;
      if (call === 1) return { content: '', model: 'test', toolCalls: [{ id: 'tool-1', type: 'function', function: { name: 'get_product_info', arguments: '{}' } }] };
      return { content: replyPayload('这是一个数字资料包，页面显示价格为 19.99 元。'), model: 'test' };
    },
  };
  const product = { id: 'product-1', accountId: 'account-1', externalProductRef: 'item-1', title: '资料包', description: '数字资料', browseCount: 321, wantCount: 33, collectCount: 8, defaultReplyTemplate: '付款后发送下载说明。', knowledgeBase: '只回答商品适用范围和使用方式。', attributes: { internalOnly: 'do-not-expose', xianyu: { detail: { summary: { browseCount: 321, wantCount: 33, collectCount: 8, favoriteCount: 2, interactFavoriteCount: 1, soldCount: 45, quantity: 9, rawResponse: { shouldNotExpose: true } } } } }, priceMinor: 1_999, status: 'published', updatedAt: '2026-09-21T00:00:00.000Z' };
  const store = { listAutoReplyProducts: async () => ({ items: [product], total: 1 }) } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  const reply = await agent.generate({ adminId: 'admin-1', context: context(), classification });
  assert.deepEqual(reply, { text: '这是一个数字资料包，页面显示价格为 19.99 元。', segments: undefined });
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.tools?.length, AUTO_REPLY_AGENT_TOOLS.length);
  assert.equal(requests[1]?.messages.at(-1)?.role, 'tool');
  const productPayload = contentText(requests[1]?.messages.at(-1)?.content);
  assert.match(productPayload, /^商品信息\n/);
  assert.match(productPayload, /标题：资料包/);
  assert.match(productPayload, /价格：19\.99元/);
  assert.match(productPayload, /描述：数字资料/);
  assert.match(productPayload, /浏览量：321/);
  assert.match(productPayload, /想要人数：33/);
  assert.match(productPayload, /收藏人数：8/);
  assert.match(productPayload, /知识库：只回答商品适用范围和使用方式。/);
  assert.match(productPayload, /回复模板：付款后发送下载说明。/);
  assert.doesNotMatch(productPayload, /createdAt|updatedAt|attributes|accountId|productRef|favoriteCount|rawResponse/);
  assert.throws(() => JSON.parse(productPayload));
});

test('agent sends document context without internal identifiers and with newest history first', async () => {
  let request: ModelMessage | undefined;
  const client: ModelClient = {
    complete: async (input) => {
      request = input.messages[1];
      return { content: replyPayload('已收到，我先结合商品信息说明。'), model: 'test' };
    },
  };
  const agent = new ToolCallingAutoReplyAgent({} as Store, client, resolveAutoReplyAgentConfig({ AUTO_REPLY_AGENT_MAX_HISTORY: '3' }));
  await agent.generate({
    adminId: 'admin-1',
    context: context({
      recentMessages: [
        { direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '最早的问题' },
        { direction: 'outbound', senderRole: 'agent', bodyType: 'text', bodyText: '中间的回复' },
        { direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '最近的问题' },
      ],
      product: { id: 'product-1', accountId: 'account-1', externalProductRef: 'item-1', title: '资料包', description: '商品说明', priceMinor: 1_999, status: 'published' },
    }),
    classification,
  });
  const prompt = contentText(request?.content);
  assert.match(prompt, /当前买家消息：/);
  assert.match(prompt, /已加载会话消息（最新在前）：/);
  assert.ok(prompt.indexOf('最近的问题') < prompt.indexOf('中间的回复'));
  assert.ok(prompt.indexOf('中间的回复') < prompt.indexOf('最早的问题'));
  assert.match(prompt, /商品事实：/);
  assert.doesNotMatch(prompt, /account-1|conversation-1|buyer-1|item-1|账号：|会话：|商品引用：/);
  assert.doesNotMatch(prompt, /"currentMessage"|"recentMessages"|"product"/);
});

test('shop catalog tool explicitly supports broad inventory questions without a keyword', async () => {
  const shopTool = AUTO_REPLY_AGENT_TOOLS.find((tool) => tool.function.name === 'list_shop_products');
  assert.match(shopTool?.function.description ?? '', /店铺有哪些商品/);
  let requestCount = 0;
  let receivedKeyword: string | undefined = 'not-called';
  const client: ModelClient = {
    complete: async () => {
      requestCount += 1;
      if (requestCount === 1) return { content: '', model: 'test', toolCalls: [{ id: 'tool-shop-catalog', type: 'function', function: { name: 'list_shop_products', arguments: '{}' } }] };
      return { content: replyPayload('店铺里目前有资料包和开发服务。'), model: 'test' };
    },
  };
  const store = {
    listAutoReplyProducts: async (_adminId: string, query: { keyword?: string }) => {
      receivedKeyword = query.keyword;
      return { items: [{ id: 'product-1', accountId: 'account-1', externalProductRef: 'item-1', title: '资料包', description: '数字资料', priceMinor: 1_999, status: 'published' }], total: 1 };
    },
  } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  const reply = await agent.generate({ adminId: 'admin-1', context: context(), classification });
  assert.deepEqual(reply, { text: '店铺里目前有资料包和开发服务。', segments: undefined });
  assert.equal(receivedKeyword, undefined);
  assert.equal(requestCount, 2);
});

test('agent emits high-level redacted observations for model, tool, and final decision', async () => {
  const observations: AutoReplyGeneratorObservation[] = [];
  let call = 0;
  const client: ModelClient = {
    complete: async () => {
      call += 1;
      if (call === 1) return { content: '', model: 'test-model', toolCalls: [{ id: 'tool-1', type: 'function', function: { name: 'get_product_info', arguments: JSON.stringify({ productRef: 'item-1' }) } }] };
      return { content: replyPayload('这是一个包含商品描述的最终回复。'), model: 'test-model', usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } };
    },
  };
  const product = { id: 'product-1', accountId: 'account-1', externalProductRef: 'item-1', title: '资料包', description: '不应写入观测日志的商品描述', defaultReplyTemplate: undefined, knowledgeBase: undefined, priceMinor: 1_999, status: 'published', updatedAt: '2026-09-21T00:00:00.000Z' };
  const store = { listAutoReplyProducts: async () => ({ items: [product], total: 1 }) } as unknown as Store;
  const config = resolveAutoReplyAgentConfig({});
  const agent = new ToolCallingAutoReplyAgent(store, client, config);

  await agent.generate({ adminId: 'admin-1', context: context(), classification, observe: (observation) => { observations.push(observation); } });

  assert.deepEqual(observations.map((item) => item.eventType), [
    'agent.model.started',
    'agent.model.completed',
    'agent.tool.started',
    'agent.tool.completed',
    'agent.model.started',
    'agent.model.completed',
    'agent.final.reply',
  ]);
  assert.equal(observations[1]?.log.state, 'tool_requested');
  assert.equal(observations[4]?.log.state, 'started');
  assert.equal(observations[5]?.log.state, 'completed');
  const toolStarted = observations[2]?.log ?? {};
  assert.deepEqual(toolStarted.argumentKeys, ['productRef']);
  assert.equal(JSON.stringify(observations).includes('不应写入观测日志的商品描述'), false);
  assert.equal(JSON.stringify(observations).includes('这是一个包含商品描述的最终回复'), false);
  assert.deepEqual(observations[6]?.log, {
    phase: 'agent', state: 'completed', message: 'Agent 已完成回复决策', decision: 'reply', loop: 2, toolCalls: 1, tools: ['get_product_info'], configDigest: config.digest, replyLength: 16, segmentCount: 1,
  });
});

test('agent preserves model-provided semantic segments and supports a segmentation retry', async () => {
  let calls = 0;
  const client: ModelClient = {
    complete: async () => {
      calls += 1;
      if (calls === 1) return { content: replyPayload('先说明商品是什么。再说明使用方式。', ['先说明商品是什么。', '再说明使用方式。']), model: 'test' };
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
    const client = new OpenAICompatibleModelClient({ apiKey: 'test-key', baseUrl: 'https://model.example/v1', model: 'test-model', wireApi: 'chat' });
    const result = await client.complete({ messages: [{ role: 'user', content: '查询商品' }], tools: AUTO_REPLY_AGENT_TOOLS, toolChoice: 'auto' });
    assert.equal((requestBody?.tools as unknown[]).length, AUTO_REPLY_AGENT_TOOLS.length);
    assert.equal(requestBody?.tool_choice, 'auto');
    assert.equal(result.content, '');
    assert.equal(result.toolCalls?.[0]?.function.name, 'get_product_info');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('agent rejects unstructured final output instead of sending raw model text', async () => {
  const agent = new ToolCallingAutoReplyAgent({} as Store, { complete: async () => ({ content: '可以的，我来帮你确认。', model: 'test' }) }, resolveAutoReplyAgentConfig({}));
  await assert.rejects(() => agent.generate({ adminId: 'admin-1', context: context(), classification }), (error: unknown) => (error as { code?: string }).code === 'AGENT_INVALID_OUTPUT');
});

test('agent routes structured handoff output without returning reply text', async () => {
  const agent = new ToolCallingAutoReplyAgent({} as Store, { complete: async () => ({ content: JSON.stringify({ decision: 'handoff', reason: '需要人工确认售后状态' }), model: 'test' }) }, resolveAutoReplyAgentConfig({}));
  await assert.rejects(() => agent.generate({ adminId: 'admin-1', context: context(), classification }), (error: unknown) => (error as { code?: string; message?: string }).code === 'AGENT_HANDOFF' && (error as { message?: string }).message === '需要人工确认售后状态');
});

test('OpenAI-compatible transport maps image content for Chat and Responses APIs', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    return new Response(JSON.stringify('messages' in body
      ? { model: 'test', choices: [{ message: { content: JSON.stringify({ decision: 'reply', text: '看到了图片。' }) } }] }
      : { model: 'test', output_text: JSON.stringify({ decision: 'reply', text: '看到了图片。' }), output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ decision: 'reply', text: '看到了图片。' }) }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const content = [{ type: 'text', text: '请识别图片' }, { type: 'image_url', image_url: { url: 'https://img.example/item.png', detail: 'auto' } }] as const;
    const chat = new OpenAICompatibleModelClient({ apiKey: 'test-key', baseUrl: 'https://model.example/v1', model: 'chat-model', wireApi: 'chat' });
    await chat.complete({ messages: [{ role: 'user', content }] });
    const responses = new OpenAICompatibleModelClient({ apiKey: 'test-key', baseUrl: 'https://model.example/v1', model: 'responses-model', wireApi: 'responses' });
    await responses.complete({ messages: [{ role: 'user', content }] });
    const chatContent = ((requests[0]?.messages as Array<Record<string, unknown>>)[0]?.content) as Array<Record<string, unknown>>;
    assert.equal(chatContent[1]?.type, 'image_url');
    const responseInput = requests[1]?.input as Array<Record<string, unknown>>;
    assert.deepEqual(responseInput[0]?.content, [
      { type: 'input_text', text: '请识别图片' },
      { type: 'input_image', image_url: 'https://img.example/item.png', detail: 'auto' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('agent includes buyer images but omits product cover images in multimodal content', async () => {
  let request: ModelMessage | undefined;
  const client: ModelClient = { complete: async (input) => { request = input.messages[1]; return { content: replyPayload('已看到了图片。'), model: 'test' }; } };
  const agent = new ToolCallingAutoReplyAgent({} as Store, client, resolveAutoReplyAgentConfig({}));
  await agent.generate({
    adminId: 'admin-1',
    context: context({
      inboundMessage: { ...context().inboundMessage, bodyType: 'image', bodyText: undefined, bodyRef: 'https://img.example/buyer.png' },
      conversation: { ...context().conversation, itemImageUrl: 'https://img.example/product.png' },
    }),
    classification,
  });
  assert.ok(Array.isArray(request?.content));
  const content = request?.content as Array<{ type: string; image_url?: { url: string } }>;
  assert.deepEqual(content.filter((part) => part.type === 'image_url').map((part) => part.image_url?.url), ['https://img.example/buyer.png']);
});

test('buyer conversation tool filters same buyer across products and orders', async () => {
  const conversations = [
    { id: 'conversation-1', itemRef: 'item-1', itemTitle: '商品一' },
    { id: 'conversation-2', itemRef: 'item-2', itemTitle: '商品二' },
  ];
  const calls: string[] = [];
  const conversationQueries: Array<{ accountId: string; buyerRef: string; limit?: number }> = [];
  const client: ModelClient = {
    complete: async (request) => {
      calls.push(contentText(request.messages.at(-1)?.content));
      if (calls.length === 1) return { content: '', model: 'test', toolCalls: [{ id: 'tool-conversations', type: 'function', function: { name: 'get_buyer_conversations', arguments: '{}' } }] };
      return { content: replyPayload('我已结合你之前咨询的商品信息说明。'), model: 'test' };
    },
  };
  const store = {
    listAutoReplyConversations: async (_adminId: string, query: { accountId: string; buyerRef: string; limit?: number }) => {
      conversationQueries.push(query);
      return { items: conversations };
    },
    listAutoReplyMessages: async (_adminId: string, conversationId: string) => ({ items: [{ direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: conversationId === 'conversation-1' ? '想了解商品一' : '想了解商品二' }], hasMoreHistory: false }),
  } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  await agent.generate({ adminId: 'admin-1', context: context(), classification });
  const toolPayload = calls[1] ?? '';
  assert.deepEqual(conversationQueries, [{ accountId: 'account-1', buyerRef: 'buyer-1', limit: 20 }]);
  assert.match(toolPayload, /商品：商品一/);
  assert.match(toolPayload, /想了解商品一/);
  assert.match(toolPayload, /商品：商品二/);
  assert.match(toolPayload, /想了解商品二/);
  assert.doesNotMatch(toolPayload, /conversation-1|conversation-2|item-1|item-2|createdAt|updatedAt|会话ID：|商品引用：/);
  assert.throws(() => JSON.parse(toolPayload));
});

test('buyer orders tool reads scoped facts and filters buyer/account scope', async () => {
  const orders = [
    { orderNo: 'buyer-1-order-1', itemId: 'item-1', itemTitle: '商品一', paymentStatus: 'unpaid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none' },
    { orderNo: 'buyer-1-order-2', itemId: 'item-2', itemTitle: '商品二', paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'shipped', afterSalesStatus: 'none' },
  ];
  const requestedQueries: Array<{ accountId: string; buyerId?: string; conversationId?: string; limit?: number }> = [];
  let orderToolPayload: string | undefined;
  const client: ModelClient = {
    complete: async (request) => {
      if (request.messages.at(-1)?.role === 'tool') {
        orderToolPayload = contentText(request.messages.at(-1)?.content);
        return { content: replyPayload('订单信息已确认。'), model: 'test' };
      }
      return { content: '', model: 'test', toolCalls: [{ id: 'tool-orders', type: 'function', function: { name: 'get_buyer_orders', arguments: '{}' } }] };
    },
  };
  const store = {
    listAutoReplyOrders: async (_adminId: string, query: { accountId: string; buyerId?: string; conversationId?: string; limit?: number }) => {
      requestedQueries.push(query);
      return { items: orders.slice(0, query.limit ?? 20), total: orders.length };
    },
  } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  const reply = await agent.generate({ adminId: 'admin-1', context: context(), classification });
  assert.deepEqual(reply, { text: '订单信息已确认。', segments: undefined });
  assert.deepEqual(requestedQueries, [{ accountId: 'account-1', buyerId: 'buyer-1', conversationId: 'conversation-1', limit: 20 }]);
  const orderPayload = orderToolPayload ?? '';
  assert.match(orderPayload, /订单号：buyer-1-order-1/);
  assert.match(orderPayload, /订单号：buyer-1-order-2/);
  assert.doesNotMatch(orderPayload, /item-1|item-2|createdAt|updatedAt|accountId|buyerId|conversationId|商品引用：/);
  assert.throws(() => JSON.parse(orderPayload));
});

test('product tool resolves external numeric refs without UUID lookup and stays account scoped', async () => {
  const product = { id: 'product-account-1', accountId: 'account-1', externalProductRef: '1078553391460', title: '数字资料包', description: '公开说明', priceMinor: 1_999, status: 'published', updatedAt: '2026-09-21T00:00:00.000Z' };
  let productQuery: { accountId?: string; keyword?: string; productId?: string; limit?: number } | undefined;
  let toolPayload: string | undefined;
  const client: ModelClient = {
    complete: async (request) => {
      if (request.messages.at(-1)?.role === 'tool') {
        toolPayload = contentText(request.messages.at(-1)?.content);
        return { content: replyPayload('这是数字资料包。'), model: 'test' };
      }
      return { content: '', model: 'test', toolCalls: [{ id: 'tool-product-external', type: 'function', function: { name: 'get_product_info', arguments: JSON.stringify({ productRef: '1078553391460' }) } }] };
    },
  };
  const store = {
    listAutoReplyProducts: async (_adminId: string, query: { accountId: string; keyword?: string; productId?: string; limit?: number }) => { productQuery = query; return { items: [product], total: 1 }; },
  } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  const reply = await agent.generate({ adminId: 'admin-1', context: { ...context(), conversation: { ...context().conversation, itemRef: '1078553391460' } }, classification });
  assert.deepEqual(reply, { text: '这是数字资料包。', segments: undefined });
  assert.deepEqual(productQuery, { accountId: 'account-1', keyword: '1078553391460', limit: 50 });
  const payload = toolPayload ?? '';
  assert.match(payload, /标题：数字资料包/);
  assert.doesNotMatch(payload, /1078553391460|product-1|createdAt|updatedAt|accountId|商品引用：/);
  assert.throws(() => JSON.parse(payload));
});

test('shop product tool searches keyword, limits results, and excludes other accounts', async () => {
  const queries: Array<{ accountId?: string; keyword?: string; limit?: number }> = [];
  let toolPayload: string | undefined;
  const client: ModelClient = {
    complete: async (request) => {
      if (request.messages.at(-1)?.role === 'tool') {
        toolPayload = typeof request.messages.at(-1)?.content === 'string' ? request.messages.at(-1)?.content : undefined;
        return { content: replyPayload('有两款相关耳机可以选择。'), model: 'test' };
      }
      return { content: '', model: 'test', toolCalls: [{ id: 'tool-shop-products', type: 'function', function: { name: 'list_shop_products', arguments: JSON.stringify({ keyword: '耳机', limit: 2 }) } }] };
    },
  };
  const store = {
    listAutoReplyProducts: async (_adminId: string, query: { accountId: string; keyword?: string; limit?: number }) => {
      queries.push(query);
      return {
        items: [
          { id: 'earbuds-a', accountId: 'account-1', externalProductRef: 'earbuds-a', title: '蓝牙耳机 A', description: '降噪耳机', browseCount: 120, wantCount: 12, collectCount: 8, priceMinor: 12900, knowledgeBase: '支持主动降噪问答。', defaultReplyTemplate: '现货当天发出。', status: 'published' },
          { id: 'earbuds-b', accountId: 'account-1', externalProductRef: 'earbuds-b', title: '蓝牙耳机 B', description: '开放式耳机', browseCount: 88, wantCount: 9, collectCount: 4, priceMinor: 9900, knowledgeBase: '说明佩戴方式。', defaultReplyTemplate: '下单后自动发货。', status: 'published' },
        ],
        total: 2,
      };
    },
  } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  const reply = await agent.generate({ adminId: 'admin-1', context: context(), classification });
  assert.deepEqual(reply, { text: '有两款相关耳机可以选择。', segments: undefined });
  assert.deepEqual(queries, [{ accountId: 'account-1', keyword: '耳机', limit: 2 }]);
  const payload = toolPayload ?? '';
  assert.match(payload, /关键词：耳机/);
  assert.match(payload, /匹配总数：2/);
  assert.match(payload, /标题：蓝牙耳机 A/);
  assert.match(payload, /价格：129\.00元/);
  assert.match(payload, /描述：降噪耳机/);
  assert.match(payload, /浏览量：120/);
  assert.match(payload, /想要人数：12/);
  assert.match(payload, /收藏人数：8/);
  assert.match(payload, /知识库：支持主动降噪问答。/);
  assert.match(payload, /标题：蓝牙耳机 B/);
  assert.match(payload, /描述：开放式耳机/);
  assert.match(payload, /浏览量：88/);
  assert.match(payload, /想要人数：9/);
  assert.match(payload, /收藏人数：4/);
  assert.match(payload, /知识库：说明佩戴方式。/);
  assert.doesNotMatch(payload, /earbuds-a|earbuds-b|foreign-product|createdAt|updatedAt|attributes|accountId|productRef|browseCount|wantCount/);
  assert.throws(() => JSON.parse(payload));
});

test('insufficient product facts return not-found and hand off instead of guessing', async () => {
  let toolPayload: string | undefined;
  const client: ModelClient = {
    complete: async (request) => {
      if (request.messages.at(-1)?.role === 'tool') {
        toolPayload = contentText(request.messages.at(-1)?.content);
        return { content: JSON.stringify({ decision: 'handoff', reason: '商品事实不足' }), model: 'test' };
      }
      return { content: '', model: 'test', toolCalls: [{ id: 'tool-product-missing', type: 'function', function: { name: 'get_product_info', arguments: JSON.stringify({ productRef: 'missing-item' }) } }] };
    },
  };
  const store = { listAutoReplyProducts: async () => ({ items: [], total: 0 }) } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  await assert.rejects(() => agent.generate({ adminId: 'admin-1', context: context(), classification }), (error: unknown) => (error as { code?: string }).code === 'AGENT_HANDOFF');
  const payload = toolPayload ?? '';
  assert.match(payload, /未找到商品/);
  assert.match(payload, /原因：PRODUCT_NOT_FOUND/);
  assert.doesNotMatch(payload, /missing-item|商品引用：/);
  assert.throws(() => JSON.parse(payload));
});

test('tool read errors stop generation before a synthesized reply', async () => {
  let calls = 0;
  const client: ModelClient = {
    complete: async () => { calls += 1; return { content: '', model: 'test', toolCalls: [{ id: 'tool-shop-error', type: 'function', function: { name: 'list_shop_products', arguments: '{}' } }] }; },
  };
  const store = { listAutoReplyProducts: async () => { throw new Error('PRODUCT_READ_FAILED'); } } as unknown as Store;
  const agent = new ToolCallingAutoReplyAgent(store, client, resolveAutoReplyAgentConfig({}));
  await assert.rejects(() => agent.generate({ adminId: 'admin-1', context: context(), classification }), /PRODUCT_READ_FAILED/);
  assert.equal(calls, 1);
});

test('agent fails safely when loop limit is reached', async () => {
  let calls = 0;
  const client: ModelClient = { complete: async () => { calls += 1; return { content: '', model: 'test', toolCalls: [{ id: `tool-${calls}`, type: 'function', function: { name: 'get_product_info', arguments: JSON.stringify({ productRef: `item-${calls}` }) } }] }; } };
  const product = { id: 'product-1', accountId: 'account-1', externalProductRef: 'item-1', title: '资料包', status: 'published', updatedAt: '2026-09-21T00:00:00.000Z' };
  const store = { listAutoReplyProducts: async () => ({ items: [product], total: 1 }) } as unknown as Store;
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
