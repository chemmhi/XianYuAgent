import { createApp } from '../dist/app.js';
import { loadConfig } from '../dist/config.js';
import { XianyuImClient } from '../dist/xianyu-im.js';

class FakeSocket {
  readyState = 0;
  sent = [];
  listeners = new Map();

  send(data) {
    const message = JSON.parse(data);
    this.sent.push(message);
    if (message.lwp === '/reg') {
      queueMicrotask(() => this.emit('message', JSON.stringify({ code: 200, headers: { mid: message.headers.mid }, body: {} })));
    }
  }

  close() { this.readyState = 3; this.emit('close'); }

  on(event, listener) {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
    return this;
  }

  once(event, listener) {
    const wrapped = (...args) => { this.removeListener(event, wrapped); listener(...args); };
    return this.on(event, wrapped);
  }

  removeListener(event, listener) {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((candidate) => candidate !== listener));
    return this;
  }

  emit(event, ...args) {
    if (event === 'open') this.readyState = 1;
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }
}

function pushFrame(mid, conversationRef, messageRef, senderRef, bodyText, senderName) {
  const content = Buffer.from(JSON.stringify({ contentType: 1, text: { text: bodyText } }), 'utf8').toString('base64');
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

function summarizeModelResponse(response) {
  return {
    id: response?.id,
    model: response?.model,
    output_text: response?.output_text,
    output: Array.isArray(response?.output) ? response.output.map((item) => {
      if (item?.type === 'function_call') return { type: item.type, call_id: item.call_id, name: item.name, arguments: item.arguments };
      if (item?.type === 'message') return { type: item.type, role: item.role, content: Array.isArray(item.content) ? item.content.map((part) => ({ type: part.type, text: part.text })) : [] };
      return { type: item?.type };
    }) : undefined,
    error: response?.error,
  };
}

async function waitFor(predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out waiting for model-backed auto-reply chain');
}

if (typeof process.loadEnvFile === 'function') process.loadEnvFile('.env');

const originalFetch = globalThis.fetch;
const modelTrace = [];
const configuredBaseUrl = String(process.env.BASE_URL ?? '').replace(/\/$/, '');
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const isModelRequest = url.startsWith(`${configuredBaseUrl}/v1/responses`) || url.endsWith('/v1/responses');
  if (!isModelRequest) return originalFetch(input, init);
  const request = init?.body ? JSON.parse(String(init.body)) : undefined;
  const response = await originalFetch(input, init);
  const responseText = await response.clone().text();
  modelTrace.push({ request, status: response.status, response: JSON.parse(responseText) });
  return new Response(responseText, { status: response.status, headers: response.headers });
};

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
  WIRE_API: 'responses',
  AUTO_REPLY_SEND_MODE: 'simulate',
  AUTOMATION_BUYER_ALLOWLIST: JSON.stringify(['一只橘喵喵亮晶晶']),
  AUTO_REPLY_AGENT_DEBOUNCE_MS: '0',
  AUTO_REPLY_AGENT_REPLY_SEGMENT_DELAY_MS: '0',
}));

await runtime.listen();
let client;
const lifecycle = [];

try {
  const suffix = Date.now();
  const boot = await runtime.auth.bootstrap({ email: `provider-trace-${suffix}@example.com`, password: 'password-123', displayName: 'Provider Trace' });
  const adminId = boot.admin.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `provider-trace-seller-${suffix}`, displayName: '测试店铺' });
  const product = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: `provider-trace-item-${suffix}`, title: '数字资料包', description: '包含完整资料说明，购买后按页面指引获取。', priceMinor: 1999, status: 'published' });
  const conversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-provider-trace', buyerDisplayName: '一只橘喵喵亮晶晶', itemRef: product.externalProductRef, itemTitle: product.title, externalConversationRef: `provider-trace-conversation-${suffix}` });
  const order = await runtime.store.createOrder({ adminId, order: { orderNo: `PROVIDER-TRACE-${suffix}`, accountId: account.id, buyerId: 'buyer-provider-trace', buyerName: '一只橘喵喵亮晶晶', conversationId: conversation.id, itemId: product.externalProductRef, itemTitle: product.title, amountMinor: 1999, paymentStatus: 'unpaid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'manual' } });
  const buyerMessage = '请问这个数字资料包具体包含什么，购买后怎么使用？';
  lifecycle.push({ stage: 'fixture', input: { buyer: '一只橘喵喵亮晶晶', message: buyerMessage, product: { id: product.id, externalProductRef: product.externalProductRef, title: product.title, priceMinor: product.priceMinor }, order: { orderNo: order.orderNo, paymentStatus: order.paymentStatus } } });

  const socket = new FakeSocket();
  const results = [];
  client = new XianyuImClient({
    accountId: account.id,
    credential: { cookieHeader: 'unb=provider-trace', accessToken: 'trace-token', deviceId: 'trace-device' },
    heartbeatIntervalMs: 60_000,
    webSocketFactory: () => socket,
    onEvent: async (event) => {
      lifecycle.push({ stage: 'gateway_event', input: { direction: event.direction, externalConversationRef: event.externalConversationRef, externalMessageRef: event.externalMessageRef, senderName: event.senderName, bodyText: event.bodyText } });
      const result = await runtime.xianyuIm.handleExternalEvent(adminId, event);
      results.push(result);
      lifecycle.push({ stage: 'chain_result', output: { created: result.created, run: result.autoReply?.run, classification: result.autoReply?.classification, context: result.autoReply?.context, outboundMessage: result.autoReply?.outboundMessage } });
    },
  });

  const connectPromise = client.connect();
  queueMicrotask(() => socket.emit('open'));
  await connectPromise;
  lifecycle.push({ stage: 'listener_ready', output: { connected: client.connected, sentFrames: socket.sent.map((item) => item.lwp).filter(Boolean) } });

  socket.emit('message', pushFrame('provider-trace-push', conversation.externalConversationRef, `provider-trace-message-${suffix}.PNM`, 'buyer-provider-trace', buyerMessage, '一只橘喵喵亮晶晶'));
  await waitFor(() => results.length >= 1);

  const result = results[0];
  const history = await runtime.messages.listMessages(adminId, conversation.id, { limit: 20 });
  const storedRun = await runtime.store.findAutoReplyRunByInboundMessage(adminId, result.autoReply.inboundMessage.id);
  lifecycle.push({ stage: 'persistence_check', output: { messages: history.items.map((message) => ({ direction: message.direction, source: message.source, bodyText: message.bodyText, externalMessageRef: message.externalMessageRef })), run: storedRun } });

  const realSendFrames = socket.sent.filter((item) => item.lwp === '/r/MessageSend/sendByReceiverScope');
  console.log(JSON.stringify({
    config: { baseUrl: process.env.BASE_URL, model: process.env.MODEL, wireApi: 'responses', sendMode: 'simulate' },
    lifecycle,
    modelTrace: modelTrace.map((entry) => ({
      status: entry.status,
      request: { model: entry.request?.model, input: entry.request?.input, toolCount: entry.request?.tools?.length, toolChoice: entry.request?.tool_choice },
      response: summarizeModelResponse(entry.response),
    })),
    assertions: { runPersisted: storedRun?.status === 'persisted', outboundPersisted: history.items.some((message) => message.direction === 'outbound' && message.source === 'ai'), realSendFrames: realSendFrames.length },
  }, null, 2));
} finally {
  await client?.disconnect();
  runtime.server.closeAllConnections?.();
  runtime.server.closeIdleConnections?.();
  await runtime.close();
}
