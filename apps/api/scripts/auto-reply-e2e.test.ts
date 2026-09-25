import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { InboundInboxWorker } from '../src/inbound-inbox-worker.js';
import { XianyuImClient } from '../src/xianyu-im.js';

function replyPayload(text: string): string {
  return JSON.stringify({ decision: 'reply', text });
}

test('transaction status notices are persisted as system messages and never enter auto reply', async () => {
  const runtime = createApp(loadConfig({
    ...process.env,
    AUTO_REPLY_AGENT_SEND_DELAY_SECONDS: '0',
    HOST: '127.0.0.1', PORT: '0', DATABASE_URL: '', REDIS_URL: '', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false',
    XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process', AUTO_REPLY_MODEL_ENABLED: 'false', AUTO_REPLY_SEND_MODE: 'simulate',
    AUTO_REPLY_AGENT_DEBOUNCE_MS: '0',
  }));
  await runtime.listen();
  try {
    const boot = await runtime.auth.bootstrap({ email: 'system-message-e2e@example.com', password: 'password-123', displayName: 'System Message E2E' });
    const adminId = boot.admin.id;
    const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'system-message-seller' });
    const conversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'system-message-buyer', buyerDisplayName: '系统消息买家', externalConversationRef: 'system-message-conversation' });

    const result = await runtime.xianyuIm.handleExternalEvent(adminId, {
      accountId: account.id,
      externalConversationRef: conversation.externalConversationRef!,
      externalMessageRef: 'system-message-1.PNM',
      senderRef: conversation.buyerRef,
      senderName: conversation.buyerDisplayName,
      direction: 'inbound',
      bodyType: 'text',
      bodyText: '[我已拍下，待付款]',
      occurredAt: new Date().toISOString(),
    });

    assert.equal(result.created, true);
    assert.equal(result.autoReply, undefined);
    const messages = await runtime.messages.listMessages(adminId, conversation.id, { limit: 20 });
    assert.equal(messages.items[0]?.bodyType, 'system');
    assert.equal(messages.items[0]?.senderRole, 'system');
    assert.equal(messages.items.filter((message) => message.direction === 'outbound').length, 0);
  } finally {
    await runtime.close();
  }
});

test('delayed auto reply is cancelled by a human reply and never persists AI text', async () => {
  const runtime = createApp(loadConfig({
    ...process.env,
    AUTO_REPLY_AGENT_SEND_DELAY_SECONDS: '0',
    HOST: '127.0.0.1', PORT: '0', DATABASE_URL: '', REDIS_URL: '', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false',
    XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process', AUTO_REPLY_MODEL_ENABLED: 'false', AUTO_REPLY_SEND_MODE: 'simulate',
    AUTO_REPLY_AGENT_DEBOUNCE_MS: '0',
  }));
  await runtime.listen();
  try {
    const boot = await runtime.auth.bootstrap({ email: 'delay-cancel-e2e@example.com', password: 'password-123', displayName: 'Delay Cancel E2E' });
    const adminId = boot.admin.id;
    const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'delay-cancel-seller' });
    const conversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'delay-cancel-buyer', buyerDisplayName: '延迟买家', externalConversationRef: 'delay-cancel-conversation' });
    const current = await runtime.autoReplyAgentSettings.get(adminId, account.id);
    await runtime.autoReplyAgentSettings.update({ adminId, accountId: account.id, expectedVersion: current.configVersion, patch: { sendDelaySeconds: 1, debounceMs: 0 }, requestId: 'delay-cancel-settings', traceId: 'delay-cancel-settings' });

    const pending = runtime.xianyuIm.handleExternalEvent(adminId, {
      accountId: account.id,
      externalConversationRef: conversation.externalConversationRef!,
      externalMessageRef: 'delay-cancel-inbound.PNM',
      senderRef: conversation.buyerRef,
      senderName: conversation.buyerDisplayName,
      direction: 'inbound',
      bodyType: 'text',
      bodyText: '请问多少钱？',
      occurredAt: new Date().toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await runtime.messages.createMessage({ adminId, conversationId: conversation.id, direction: 'outbound', senderRole: 'agent', bodyType: 'text', bodyText: '人工已接管，请稍等。', source: 'human', requestId: 'delay-cancel-human', traceId: 'delay-cancel-human' });
    const result = await pending;

    assert.equal(result.autoReply?.run.status, 'skipped');
    assert.equal(result.autoReply?.run.failureCode, 'AUTO_REPLY_CANCELLED_BY_HUMAN_REPLY');
    const messages = await runtime.messages.listMessages(adminId, conversation.id, { limit: 20 });
    assert.equal(messages.items.filter((message) => message.direction === 'outbound' && message.source === 'ai').length, 0);
    assert.equal(messages.items.filter((message) => message.direction === 'outbound' && message.source === 'human').length, 1);
  } finally {
    await runtime.close();
  }
});

test('delayed auto reply sends and persists when no human reply arrives', async () => {
  const runtime = createApp(loadConfig({
    ...process.env,
    AUTO_REPLY_AGENT_SEND_DELAY_SECONDS: '0',
    HOST: '127.0.0.1', PORT: '0', DATABASE_URL: '', REDIS_URL: '', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false',
    XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process', AUTO_REPLY_MODEL_ENABLED: 'false', AUTO_REPLY_SEND_MODE: 'simulate',
    AUTO_REPLY_AGENT_DEBOUNCE_MS: '0',
  }));
  await runtime.listen();
  try {
    const boot = await runtime.auth.bootstrap({ email: 'delay-send-e2e@example.com', password: 'password-123', displayName: 'Delay Send E2E' });
    const adminId = boot.admin.id;
    const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'delay-send-seller' });
    const conversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'delay-send-buyer', buyerDisplayName: '延迟发送买家', externalConversationRef: 'delay-send-conversation' });
    const current = await runtime.autoReplyAgentSettings.get(adminId, account.id);
    await runtime.autoReplyAgentSettings.update({ adminId, accountId: account.id, expectedVersion: current.configVersion, patch: { sendDelaySeconds: 1, debounceMs: 0 }, requestId: 'delay-send-settings', traceId: 'delay-send-settings' });

    const result = await runtime.xianyuIm.handleExternalEvent(adminId, {
      accountId: account.id,
      externalConversationRef: conversation.externalConversationRef!,
      externalMessageRef: 'delay-send-inbound.PNM',
      senderRef: conversation.buyerRef,
      senderName: conversation.buyerDisplayName,
      direction: 'inbound',
      bodyType: 'text',
      bodyText: '你好',
      occurredAt: new Date().toISOString(),
    });

    assert.equal(result.autoReply?.run.status, 'persisted');
    assert.equal(result.autoReply?.outboundMessage?.source, 'ai');
    const messages = await runtime.messages.listMessages(adminId, conversation.id, { limit: 20 });
    assert.equal(messages.items.filter((message) => message.direction === 'outbound' && message.source === 'ai').length, 1);
  } finally {
    await runtime.close();
  }
});

test('production listener callback defers to the inbox worker and publishes both message events', async () => {
  const runtime = createApp(loadConfig({
    ...process.env,
    AUTO_REPLY_AGENT_SEND_DELAY_SECONDS: '0',
    HOST: '127.0.0.1',
    PORT: '0',
    DATABASE_URL: '',
    REDIS_URL: '',
    ALLOW_IN_MEMORY: 'true',
    COOKIE_SECURE: 'false',
    XIANYU_QR_MODE: 'stub',
    AGENT_RUNTIME: 'in-process',
    AUTO_REPLY_MODEL_ENABLED: 'false',
    AUTO_REPLY_SEND_MODE: 'simulate',
    AUTOMATION_BUYER_ALLOWLIST: 'Buyer',
    AUTO_REPLY_AGENT_DEBOUNCE_MS: '0',
  }));
  await runtime.listen();
  const events: Array<{ type: string; direction?: string; source?: string }> = [];

  try {
    const boot = await runtime.auth.bootstrap({ email: 'listener-worker@example.com', password: 'password-123', displayName: 'Listener Worker' });
    const adminId = boot.admin.id;
    const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'listener-worker-seller' });
    const conversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-1', buyerDisplayName: 'Buyer', externalConversationRef: 'listener-worker-conversation' });
    const unsubscribe = runtime.messages.realtime.subscribe(conversation.id, (event) => {
      const message = event.payload.message as { direction?: string; source?: string } | undefined;
      events.push({ type: event.type, direction: message?.direction, source: message?.source });
    });

    const inbound = await runtime.xianyuIm.handleExternalEvent(adminId, {
      accountId: account.id,
      externalConversationRef: conversation.externalConversationRef!,
      externalMessageRef: 'listener-worker-inbound.PNM',
      senderRef: conversation.buyerRef,
      senderName: conversation.buyerDisplayName,
      direction: 'inbound',
      bodyType: 'text',
      bodyText: '有货吗',
      occurredAt: new Date().toISOString(),
    }, { deferAutoReply: true });

    assert.equal(inbound.created, true);
    assert.equal(inbound.autoReply, undefined);
    assert.deepEqual(events, [{ type: 'chat.message.created', direction: 'inbound', source: 'system' }]);

    const worker = new InboundInboxWorker(runtime.store, runtime.xianyuIm, { workerId: 'listener-worker-test', leaseMs: 5_000, maxAttempts: 2 });
    assert.equal(await worker.pollOnce(), 1);

    const messages = await runtime.messages.listMessages(adminId, conversation.id, { limit: 20 });
    assert.equal(messages.items.filter((message) => message.direction === 'inbound').length, 1);
    assert.equal(messages.items.filter((message) => message.direction === 'outbound' && message.source === 'ai').length, 1);
    const runs = await runtime.store.listAutoReplyRuns(adminId, { accountId: account.id, page: 1, pageSize: 20 });
    assert.equal(runs.items[0]?.status, 'persisted');
    assert.equal(events.filter((event) => event.type === 'chat.message.created' && event.direction === 'outbound' && event.source === 'ai').length, 1);
    unsubscribe();
  } finally {
    await runtime.close();
  }
});

test('xianyu listener drives product and general auto-reply chains without real send', async () => {
  const runtime = createApp(loadConfig({
    ...process.env,
    AUTO_REPLY_AGENT_SEND_DELAY_SECONDS: '0',
    HOST: '127.0.0.1',
    PORT: '0',
    DATABASE_URL: '',
    REDIS_URL: '',
    ALLOW_IN_MEMORY: 'true',
    COOKIE_SECURE: 'false',
    XIANYU_QR_MODE: 'stub',
    AGENT_RUNTIME: 'in-process',
    AUTO_REPLY_SEND_MODE: 'simulate',
    AUTOMATION_BUYER_ALLOWLIST: '一只橘喵喵亮晶晶',
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

test('real push handles a GitHub skill question through the Responses search path', async () => {
  const originalFetch = globalThis.fetch;
  const modelRequests: Array<Record<string, unknown>> = [];
  let modelCall = 0;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    modelRequests.push(body);
    modelCall += 1;
    const payload = modelCall === 1
      ? { model: 'buyer-agent-test', output: [{ type: 'function_call', call_id: 'call-product-1', name: 'get_product_info', arguments: '{}' }] }
      : { model: 'buyer-agent-test', output_text: replyPayload('我暂时无法联网核实 GitHub 上是否有这个 skill，建议提供仓库链接。'), output: [{ type: 'web_search_call', id: 'web-search-1', status: 'completed' }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: replyPayload('我暂时无法联网核实 GitHub 上是否有这个 skill，建议提供仓库链接。') }] }] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const runtime = createApp(loadConfig({
    ...process.env,
    AUTO_REPLY_AGENT_SEND_DELAY_SECONDS: '0',
    HOST: '127.0.0.1', PORT: '0', DATABASE_URL: '', REDIS_URL: '', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process',
    API_KEY: 'test-key', BASE_URL: 'https://model.example/v1', MODEL: 'buyer-agent-test', WIRE_API: 'responses', AUTO_REPLY_MODEL_ENABLED: 'true', AUTO_REPLY_SEND_MODE: 'simulate', AUTOMATION_BUYER_ALLOWLIST: '["买家"]', AUTO_REPLY_AGENT_DEBOUNCE_MS: '0', AUTO_REPLY_AGENT_REPLY_SEGMENT_DELAY_MS: '0',
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
    socket.emit('message', pushFrame('buyer-agent-push-1', 'buyer-agent-conversation-1', 'buyer-agent-message-1.PNM', 'buyer-agent-buyer-1', 'github上有没有这个skill', '买家'));
    await waitFor(() => results.length >= 1);
    const result = results[0]!;
    assert.equal(result.created, true);
    assert.equal(result.autoReply?.run.status, 'persisted');
    assert.equal(result.autoReply?.run.senderOutcome, 'simulated');
    assert.equal(result.autoReply?.outboundMessage?.bodyText, '我暂时无法联网核实 GitHub 上是否有这个 skill，建议提供仓库链接。');
    assert.equal(modelCall, 2);
    assert.equal((modelRequests[0]?.tools as unknown[]).length, 4);
    assert.equal((modelRequests[1]?.tools as unknown[]).length, 5);
    assert.deepEqual((modelRequests[1]?.tools as Array<Record<string, unknown>>).at(-1), { type: 'web_search' });
    assert.equal((modelRequests[1]?.input as Array<{ type: string }>).at(-1)?.type, 'function_call_output');
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
    const content = modelCall === 1 ? replyPayload('初始配置回复。') : replyPayload('更新配置后的回复，这是一段用于验证设置即时生效的较长文本。');
    return new Response(JSON.stringify({ model: 'settings-e2e', choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const runtime = createApp(loadConfig({
    ...process.env,
    AUTO_REPLY_AGENT_SEND_DELAY_SECONDS: '0',
    HOST: '127.0.0.1', PORT: '0', DATABASE_URL: '', REDIS_URL: '', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process',
    API_KEY: 'settings-e2e-key', BASE_URL: 'https://model.example/v1', MODEL: 'settings-e2e', WIRE_API: 'chat', AUTO_REPLY_MODEL_ENABLED: 'true', AUTO_REPLY_SEND_MODE: 'simulate', AUTOMATION_BUYER_ALLOWLIST: '["设置买家"]', AUTO_REPLY_AGENT_DEBOUNCE_MS: '0',
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
    assert.match((modelRequests[0]?.messages as Array<{ role: string; content: string }>)[0]?.content ?? '', /^初始系统提示/);

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
    const updatedSystemPrompt = (modelRequests[1]?.messages as Array<{ role: string; content: string }>)[0]?.content ?? '';
    assert.match(updatedSystemPrompt, /^初始系统提示/);
    assert.match(updatedSystemPrompt, /以下是账号级回复风格提示/);
    assert.match(updatedSystemPrompt, /设置页更新后的系统提示/);
    assert.match(updatedSystemPrompt, /账号级提示只影响表达风格/);
    assert.ok(updatedSystemPrompt.indexOf('初始系统提示') < updatedSystemPrompt.indexOf('设置页更新后的系统提示'));
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
