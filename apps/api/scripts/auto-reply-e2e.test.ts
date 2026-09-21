import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { XianyuImClient } from '../src/xianyu-im.js';

test('xianyu listener drives product and general auto-reply chains without real send', async () => {
  const runtime = createApp(loadConfig({
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '0',
    DATABASE_URL: '',
    REDIS_URL: '',
    ALLOW_IN_MEMORY: 'true',
    COOKIE_SECURE: 'false',
    XIANYU_QR_MODE: 'stub',
    AGENT_RUNTIME: 'in-process',
    AUTO_REPLY_SEND_MODE: 'simulate',
    AUTO_REPLY_TEST_BUYER_NAMES: '一只橘喵喵亮晶晶',
  }));
  await runtime.listen();
  let client: XianyuImClient | undefined;

  try {
    const boot = await runtime.auth.bootstrap({ email: 'auto-reply@example.com', password: 'password-123', displayName: 'Auto Reply Admin' });
    const adminId = boot.admin.id;
    const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'seller-1', displayName: '测试店铺' });
    await runtime.store.upsertCredential({ adminId, accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=seller-1', accessToken: 'access-token', deviceId: 'device-1' });
    const product = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: 'item-1', title: '资料包', description: '数字资料', priceMinor: 1_999, status: 'draft' });
    const productConversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-1', buyerDisplayName: '一只橘喵喵亮晶晶', itemRef: 'item-1', itemTitle: '资料包', externalConversationRef: 'conv-product' });
    const blockedConversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-3', buyerDisplayName: '其他买家', externalConversationRef: 'conv-blocked' });
    const order = await runtime.store.createOrder({ adminId, order: { orderNo: 'ORDER-AUTO-1', accountId: account.id, buyerId: 'buyer-1', buyerName: '一只橘喵喵亮晶晶', conversationId: productConversation.id, itemId: 'item-1', itemTitle: '资料包', amountMinor: 1_999, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'manual' } });
    await runtime.store.createOrder({ adminId, order: { orderNo: 'ORDER-AUTO-OTHER-PAID', accountId: account.id, buyerId: 'buyer-other', itemId: 'item-1', itemTitle: '资料包', amountMinor: 1_999, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'manual' } });

    const socket = new FakeSocket();
    const completed: Array<{ created: boolean; autoReply?: { run: { status: string; decision: string; intent: string; senderOutcome?: string; failureCode?: string; productId?: string; outboundMessageId?: string }; inboundMessage: { id: string }; outboundMessage?: { bodyText?: string } } }> = [];
    client = new XianyuImClient({
      accountId: account.id,
      credential: { cookieHeader: 'unb=seller-1', accessToken: 'access-token', deviceId: 'device-1' },
      heartbeatIntervalMs: 60_000,
      webSocketFactory: () => socket,
      onEvent: async (event) => {
        const result = await runtime.xianyuIm.handleExternalEvent(adminId, event);
        completed.push(result as typeof completed[number]);
      },
    });

    const connectPromise = client.connect();
    queueMicrotask(() => socket.emit('open'));
    await connectPromise;
    assert.equal(client.connected, true);

    socket.emit('message', pushFrame('push-product-1', 'conv-product', 'inbound-product-1.PNM', 'buyer-1', '请问多少钱？', '一只橘喵喵亮晶晶'));
    await waitFor(() => completed.length >= 1);
    const productResult = completed[0]!;
    assert.equal(productResult.created, true);
    assert.equal(productResult.autoReply?.run.intent, 'price');
    assert.equal(productResult.autoReply?.run.decision, 'replied');
    assert.equal(productResult.autoReply?.run.status, 'persisted');
    assert.equal(productResult.autoReply?.run.senderOutcome, 'simulated');
    assert.equal(productResult.autoReply?.run.productId, product.id);
    assert.equal(productResult.autoReply?.context?.orders.some((candidate) => candidate.orderNo === order.orderNo), true);
    assert.equal(productResult.autoReply?.context?.orders.some((candidate) => candidate.orderNo === 'ORDER-AUTO-OTHER-PAID'), false);
    assert.match(productResult.autoReply?.outboundMessage?.bodyText ?? '', /资料包当前价格是19\.99元/);

    const productMessages = await runtime.messages.listMessages(adminId, productConversation.id, { limit: 20 });
    assert.equal(productMessages.items.filter((message) => message.direction === 'inbound').length, 1);
    assert.equal(productMessages.items.filter((message) => message.direction === 'outbound').length, 1);
    assert.equal(productMessages.items.find((message) => message.direction === 'outbound')?.source, 'ai');
    assert.equal((await runtime.store.findAutoReplyRunByInboundMessage(adminId, productResult.autoReply!.inboundMessage.id))?.outboundMessageId, productResult.autoReply?.run.outboundMessageId);

    socket.emit('message', pushFrame('push-general-1', 'conv-general', 'inbound-general-1.PNM', 'buyer-2', '你好', '一只橘喵喵亮晶晶'));
    await waitFor(() => completed.length >= 2);
    const generalResult = completed[1]!;
    assert.equal(generalResult.created, true);
    assert.equal(generalResult.autoReply?.run.intent, 'general');
    assert.equal(generalResult.autoReply?.run.status, 'persisted');
    assert.equal(generalResult.autoReply?.run.productId, undefined);
    assert.match(generalResult.autoReply?.outboundMessage?.bodyText ?? '', /已收到你的消息/);
    const generalConversation = await runtime.store.findConversationByExternalRef(adminId, account.id, 'conv-general');
    assert.ok(generalConversation);
    const generalMessages = await runtime.messages.listMessages(adminId, generalConversation.id, { limit: 20 });
    assert.equal(generalMessages.items.filter((message) => message.direction === 'outbound').length, 1);

    socket.emit('message', pushFrame('push-blocked-1', 'conv-blocked', 'inbound-blocked-1.PNM', 'buyer-3', '你好', '其他买家'));
    await waitFor(() => completed.length >= 3);
    assert.equal(completed[2]?.created, true);
    assert.equal(completed[2]?.autoReply?.run.status, 'skipped');
    assert.equal(completed[2]?.autoReply?.run.failureCode, 'TEST_BUYER_NOT_ALLOWLISTED');
    assert.equal((await runtime.messages.listMessages(adminId, blockedConversation.id, { limit: 20 })).items.filter((message) => message.direction === 'outbound').length, 0);

    socket.emit('message', pushFrame('push-product-duplicate', 'conv-product', 'inbound-product-1.PNM', 'buyer-1', '请问多少钱？', '一只橘喵喵亮晶晶'));
    await waitFor(() => completed.length >= 4);
    assert.equal(completed[3]?.created, false);
    assert.equal((await runtime.messages.listMessages(adminId, productConversation.id, { limit: 20 })).items.filter((message) => message.direction === 'outbound').length, 1);

    const sendRequests = socket.sent.filter((message) => message.lwp === '/r/MessageSend/sendByReceiverScope');
    assert.equal(sendRequests.length, 0, 'dry-run must never call the Xianyu send endpoint');
    await client.disconnect();
  } finally {
    // Disconnect even when an assertion fails so the heartbeat timer cannot
    // keep the test process alive and hide the original failure.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    await client?.disconnect();
    runtime.server.closeAllConnections?.();
    runtime.server.closeIdleConnections?.();
    await runtime.close();
  }
});

test('real push enters buyer Agent tool loop, simulates reply, and persists run without sending', async () => {
  const originalFetch = globalThis.fetch;
  const modelRequests: Array<Record<string, unknown>> = [];
  let modelCall = 0;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    modelRequests.push(body);
    modelCall += 1;
    const message = modelCall === 1
      ? { content: '', tool_calls: [{ id: 'call-product-1', type: 'function', function: { name: 'get_product_info', arguments: '{}' } }] }
      : { content: '这是一个数字资料包，页面显示价格为 19.99 元。' };
    return new Response(JSON.stringify({ model: 'buyer-agent-test', choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const runtime = createApp(loadConfig({
    ...process.env,
    HOST: '127.0.0.1', PORT: '0', DATABASE_URL: '', REDIS_URL: '', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process',
    API_KEY: 'test-key', BASE_URL: 'https://model.example/v1', MODEL: 'buyer-agent-test', WIRE_API: 'chat', AUTO_REPLY_MODEL_ENABLED: 'true', AUTO_REPLY_SEND_MODE: 'simulate', AUTO_REPLY_TEST_BUYER_NAMES: '["买家"]', AUTO_REPLY_AGENT_DEBOUNCE_MS: '0', AUTO_REPLY_AGENT_REPLY_SEGMENT_DELAY_MS: '0',
  }));
  await runtime.listen();
  let client: XianyuImClient | undefined;
  try {
    const boot = await runtime.auth.bootstrap({ email: 'buyer-agent-e2e@example.com', password: 'password-123', displayName: 'Buyer Agent E2E' });
    const adminId = boot.admin.id;
    const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'buyer-agent-e2e-seller', displayName: '测试店铺' });
    const product = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: 'buyer-agent-item-1', title: '数字资料包', description: '数字资料内容', priceMinor: 1_999, status: 'published' });
    const conversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-agent-buyer-1', buyerDisplayName: '买家', itemRef: product.externalProductRef, itemTitle: product.title, externalConversationRef: 'buyer-agent-conversation-1' });
    const socket = new FakeSocket();
    const results: any[] = [];
    client = new XianyuImClient({ accountId: account.id, credential: { cookieHeader: 'unb=buyer-agent-e2e-seller', accessToken: 'access-token', deviceId: 'device-1' }, heartbeatIntervalMs: 60_000, webSocketFactory: () => socket, onEvent: async (event) => { results.push(await runtime.xianyuIm.handleExternalEvent(adminId, event)); } });
    const connectPromise = client.connect();
    queueMicrotask(() => socket.emit('open'));
    await connectPromise;
    socket.emit('message', pushFrame('buyer-agent-push-1', 'buyer-agent-conversation-1', 'buyer-agent-message-1.PNM', 'buyer-agent-buyer-1', '请问这个是什么东西？', '买家'));
    await waitFor(() => results.length >= 1);
    const result = results[0]!;
    assert.equal(result.created, true);
    assert.equal(result.autoReply?.run.status, 'persisted');
    assert.equal(result.autoReply?.run.senderOutcome, 'simulated');
    assert.equal(result.autoReply?.outboundMessage?.bodyText, '这是一个数字资料包，页面显示价格为 19.99 元。');
    assert.equal(modelCall, 2);
    assert.equal((modelRequests[0]?.tools as unknown[]).length, 4);
    assert.equal((modelRequests[1]?.messages as Array<{ role: string }>).at(-1)?.role, 'tool');
    const stored = await runtime.messages.listMessages(adminId, conversation.id, { limit: 20 });
    assert.equal(stored.items.filter((message) => message.direction === 'outbound').length, 1);
    assert.ok(await runtime.store.findAutoReplyRunByInboundMessage(adminId, result.autoReply!.inboundMessage.id));
    assert.equal(socket.sent.filter((message) => message.lwp === '/r/MessageSend/sendByReceiverScope').length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await client?.disconnect();
    runtime.server.closeAllConnections?.();
    runtime.server.closeIdleConnections?.();
    await runtime.close();
  }
});

test('persisted Agent settings apply to the next buyer push without restart', async () => {
  const originalFetch = globalThis.fetch;
  const modelRequests: Array<Record<string, unknown>> = [];
  let modelCall = 0;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    modelRequests.push(body);
    modelCall += 1;
    const content = modelCall === 1 ? '初始配置回复。' : '更新配置后的回复，这是一段用于验证设置即时生效的较长文本。';
    return new Response(JSON.stringify({ model: 'settings-e2e', choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const runtime = createApp(loadConfig({
    ...process.env,
    HOST: '127.0.0.1', PORT: '0', DATABASE_URL: '', REDIS_URL: '', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process',
    API_KEY: 'settings-e2e-key', BASE_URL: 'https://model.example/v1', MODEL: 'settings-e2e', WIRE_API: 'chat', AUTO_REPLY_MODEL_ENABLED: 'true', AUTO_REPLY_SEND_MODE: 'simulate', AUTO_REPLY_TEST_BUYER_NAMES: '["设置买家"]', AUTO_REPLY_AGENT_DEBOUNCE_MS: '0',
    AUTO_REPLY_AGENT_SYSTEM_PROMPT: '初始系统提示',
  }));
  await runtime.listen();
  let client: XianyuImClient | undefined;
  try {
    const boot = await runtime.auth.bootstrap({ email: 'settings-agent-e2e@example.com', password: 'password-123', displayName: 'Settings Agent E2E' });
    const adminId = boot.admin.id;
    const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'settings-agent-seller', displayName: '设置测试店铺' });
    const product = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: 'settings-agent-item', title: '设置测试商品', description: '设置测试商品描述', priceMinor: 3_000, status: 'published' });
    const conversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'settings-agent-buyer', buyerDisplayName: '设置买家', itemRef: product.externalProductRef, itemTitle: product.title, externalConversationRef: 'settings-agent-conversation' });
    const socket = new FakeSocket();
    const results: any[] = [];
    client = new XianyuImClient({ accountId: account.id, credential: { cookieHeader: 'unb=settings-agent-seller', accessToken: 'settings-access', deviceId: 'settings-device' }, heartbeatIntervalMs: 60_000, webSocketFactory: () => socket, onEvent: async (event) => { results.push(await runtime.xianyuIm.handleExternalEvent(adminId, event)); } });
    const connectPromise = client.connect();
    queueMicrotask(() => socket.emit('open'));
    await connectPromise;

    socket.emit('message', pushFrame('settings-push-1', 'settings-agent-conversation', 'settings-message-1.PNM', 'settings-agent-buyer', '你好', '设置买家'));
    await waitFor(() => results.length >= 1);
    assert.equal(results[0]?.autoReply?.run.status, 'persisted');
    assert.equal((modelRequests[0]?.messages as Array<{ role: string; content: string }>)[0]?.content, '初始系统提示');

    const current = await runtime.autoReplyAgentSettings.get(adminId, account.id);
    const updated = await runtime.autoReplyAgentSettings.update({
      adminId,
      accountId: account.id,
      expectedVersion: current.configVersion,
      patch: { systemPrompt: '设置页更新后的系统提示', maxReplyLength: 50, debounceMs: 0 },
      requestId: 'settings-agent-update',
      traceId: 'settings-agent-update',
    });
    assert.equal(updated.systemPrompt, '设置页更新后的系统提示');

    socket.emit('message', pushFrame('settings-push-2', 'settings-agent-conversation', 'settings-message-2.PNM', 'settings-agent-buyer', '请继续介绍', '设置买家'));
    await waitFor(() => results.length >= 2);
    assert.equal(results[1]?.autoReply?.run.status, 'persisted');
    assert.equal((modelRequests[1]?.messages as Array<{ role: string; content: string }>)[0]?.content, '设置页更新后的系统提示');
    assert.ok((results[1]?.autoReply?.outboundMessage?.bodyText ?? '').length <= 50);
    assert.equal(socket.sent.filter((message) => message.lwp === '/r/MessageSend/sendByReceiverScope').length, 0);
    assert.equal((await runtime.messages.listMessages(adminId, conversation.id, { limit: 20 })).items.filter((message) => message.direction === 'outbound').length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await client?.disconnect();
    runtime.server.closeAllConnections?.();
    runtime.server.closeIdleConnections?.();
    await runtime.close();
  }
});

function pushFrame(mid: string, conversationRef: string, messageRef: string, senderRef: string, text: string, senderName: string): string {
  const content = Buffer.from(JSON.stringify({ contentType: 1, text: { text } }), 'utf8').toString('base64');
  const payload = {
    '1': {
      '2': conversationRef,
      '3': messageRef,
      '5': Date.now(),
      '6': { '3': { '5': content } },
      '10': { senderUserId: senderRef, senderNick: senderName, extJson: JSON.stringify({ messageId: messageRef }) },
    },
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  return JSON.stringify({ headers: { mid }, body: { syncPushPackage: { data: [{ data: encoded }] } } });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for auto-reply chain');
}

class FakeSocket {
  readyState = 0;
  sent: Array<Record<string, any>> = [];
  private readonly listeners = new Map<string, Array<(...args: any[]) => void>>();

  send(data: string): void {
    const message = JSON.parse(data) as Record<string, any>;
    this.sent.push(message);
    if (message.lwp === '/reg') {
      queueMicrotask(() => this.emit('message', JSON.stringify({ code: 200, headers: { mid: message.headers.mid }, body: {} })));
    }
  }

  close(): void { this.readyState = 3; this.emit('close'); }

  on(event: string, listener: (...args: any[]) => void): this {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
    return this;
  }

  once(event: string, listener: (...args: any[]) => void): this {
    const wrapped = (...args: any[]) => {
      this.removeListener(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  removeListener(event: string, listener: (...args: any[]) => void): this {
    const current = this.listeners.get(event) ?? [];
    this.listeners.set(event, current.filter((candidate) => candidate !== listener));
    return this;
  }

  emit(event: string, ...args: any[]): void {
    if (event === 'open') this.readyState = 1;
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }
}
