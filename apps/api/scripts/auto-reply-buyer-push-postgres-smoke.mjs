import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { hashPassword } from '../dist/security.js';
import { XianyuImClient } from '../dist/xianyu-im.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const suffix = `${process.pid}-${Date.now()}`;
const email = `auto-reply-push-pg-${suffix}@example.com`;
const sellerRef = `auto-reply-push-pg-${suffix}`;
const originalFetch = globalThis.fetch;
let modelCall = 0;
globalThis.fetch = (async (_input, init) => {
  modelCall += 1;
  const body = JSON.parse(String(init?.body));
  const message = modelCall === 1
    ? { content: '', tool_calls: [{ id: 'push-product-1', type: 'function', function: { name: 'get_product_info', arguments: '{}' } }] }
    : { content: JSON.stringify({ decision: 'reply', text: '这是一个 PostgreSQL 买家推送回归测试商品，已确认可以正常回复。' }) };
  assert.equal(body.model, 'auto-reply-buyer-push-postgres-smoke');
  return new Response(JSON.stringify({ model: 'auto-reply-buyer-push-postgres-smoke', choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
});

const config = {
  host: '127.0.0.1',
  port: 0,
  databaseUrl,
  cookieSecure: false,
  allowInMemory: false,
  sessionIdleMs: 1_800_000,
  sessionAbsoluteMs: 28_800_000,
  xianyuQrMode: 'stub',
  modelApiKey: 'auto-reply-buyer-push-postgres-smoke-key',
  modelBaseUrl: 'https://model.example/v1',
  modelName: 'auto-reply-buyer-push-postgres-smoke',
  modelWireApi: 'chat',
  modelTimeoutMs: 5_000,
  autoReplyModelEnabled: true,
  autoReplySendMode: 'simulate',
  autoReplyTestBuyerNames: ['Auto Reply PostgreSQL Buyer'],
  autoReplyRepairMode: 'shadow',
};

class FakeSocket {
  readyState = 0;
  sent = [];
  listeners = new Map();

  send(data) {
    const message = JSON.parse(data);
    this.sent.push(message);
    if (message.lwp === '/reg') queueMicrotask(() => this.emit('message', JSON.stringify({ code: 200, headers: { mid: message.headers.mid }, body: {} })));
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
    const current = this.listeners.get(event) ?? [];
    this.listeners.set(event, current.filter((candidate) => candidate !== listener));
    return this;
  }

  emit(event, ...args) {
    if (event === 'open') this.readyState = 1;
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }
}

let runtime;
let client;
let adminId;
let accountId;
let conversationId;
let inboundMessageId;

try {
  runtime = createApp(config);
  await runtime.listen();
  const admin = await runtime.store.createAdmin({ email, passwordHash: await hashPassword('password-123'), displayName: 'Auto Reply Buyer Push PostgreSQL Smoke' });
  adminId = admin.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef });
  accountId = account.id;
  const product = await runtime.store.createProduct({ adminId, accountId, externalProductRef: `1078553391460-${suffix}`, title: 'Postgres 买家推送资料包', priceMinor: 2_590, status: 'published' });
  const conversation = await runtime.store.createConversation({ adminId, accountId, buyerRef: `pg-push-buyer-${suffix}`, buyerDisplayName: 'Auto Reply PostgreSQL Buyer', itemRef: product.externalProductRef, itemTitle: product.title, externalConversationRef: `pg-push-conv-${suffix}` });
  conversationId = conversation.id;

  const socket = new FakeSocket();
  const results = [];
  client = new XianyuImClient({
    accountId: account.id,
    credential: { cookieHeader: `unb=${sellerRef}`, accessToken: 'auto-reply-pg-access-token', deviceId: `auto-reply-pg-device-${suffix}` },
    heartbeatIntervalMs: 60_000,
    webSocketFactory: () => socket,
    onEvent: async (event) => { results.push(await runtime.xianyuIm.handleExternalEvent(adminId, event)); },
  });

  const connectPromise = client.connect();
  queueMicrotask(() => socket.emit('open'));
  await connectPromise;
  assert.equal(client.connected, true);

  socket.emit('message', pushFrame('pg-push-mid-1', conversation.externalConversationRef, `pg-push-inbound-${suffix}.PNM`, conversation.buyerRef, '请问这个是什么东西？', conversation.buyerDisplayName));
  await waitFor(() => results.length >= 1);

  const result = results[0];
  assert.equal(result.created, true);
  assert.equal(result.autoReply?.run.status, 'persisted');
  assert.equal(result.autoReply?.run.senderOutcome, 'simulated');
  assert.equal(result.autoReply?.context?.product?.id, product.id);
  assert.equal(result.autoReply?.outboundMessage?.source, 'ai');
  assert.equal(result.autoReply?.outboundMessage?.bodyText, '这是一个 PostgreSQL 买家推送回归测试商品，已确认可以正常回复。');
  assert.equal(result.autoReply?.repair?.mode, 'shadow');
  assert.equal(result.autoReply?.repair?.resolutionStatus, 'review_pending');
  assert.ok(result.autoReply?.repair?.policyDecisionId);
  assert.equal(modelCall, 2);
  assert.equal(socket.sent.filter((message) => message.lwp === '/r/MessageSend/sendByReceiverScope').length, 0);
  inboundMessageId = result.autoReply?.inboundMessage.id;

  const storedRun = await runtime.store.getAutoReplyRun(adminId, result.autoReply.run.id);
  assert.equal(storedRun?.outboundMessageId, result.autoReply.outboundMessage?.id);
  const repairReviews = await runtime.autoReplyRepair.listReviews(accountId, conversationId);
  assert.deepEqual(repairReviews.map((review) => review.reviewType), ['PRE_SEND', 'OUTCOME']);
  assert.equal(repairReviews[1]?.resolutionStatus, 'review_pending');
  assert.deepEqual(repairReviews[1]?.evidenceTypes, []);

  socket.emit('message', pushFrame('pg-push-mid-1-replay', conversation.externalConversationRef, `pg-push-inbound-${suffix}.PNM`, conversation.buyerRef, '请问这个是什么东西？', conversation.buyerDisplayName));
  await waitFor(() => results.length >= 2);
  const duplicate = results[1];
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.autoReply?.run.id, result.autoReply.run.id);
  assert.equal((await runtime.autoReplyRepair.listReviews(accountId, conversationId)).length, 2);
  const storedMessages = await runtime.store.listMessages(adminId, conversationId, { limit: 20 });
  assert.equal(storedMessages.items.filter((message) => message.direction === 'inbound').length, 1);
  assert.equal(storedMessages.items.filter((message) => message.direction === 'outbound' && message.source === 'ai').length, 1);

  await client.disconnect();
  await runtime.close();
  client = undefined;
  runtime = createApp(config);
  await runtime.listen();
  const rereadRun = await runtime.store.findAutoReplyRunByInboundMessage(adminId, inboundMessageId);
  assert.equal(rereadRun?.status, 'persisted');
  assert.equal(rereadRun?.senderOutcome, 'simulated');
  const rereadMessages = await runtime.store.listMessages(adminId, conversationId, { limit: 20 });
  assert.equal(rereadMessages.items.some((message) => message.source === 'ai' && message.direction === 'outbound'), true);
  const rereadReviews = await runtime.autoReplyRepair.listReviews(accountId, conversationId);
  assert.equal(rereadReviews.length, 2);
  assert.equal(rereadReviews[1]?.resolutionStatus, 'review_pending');
  console.log(JSON.stringify({ buyerPush: true, modelCalls: modelCall, outboundSimulated: true, outboundPersisted: true, runPersistedAfterRestart: true, aiOutboundCountAfterRestart: rereadMessages.items.filter((message) => message.source === 'ai' && message.direction === 'outbound').length }));
} finally {
  await client?.disconnect();
  const active = runtime;
  if (active?.store?.pool) {
    if (accountId) await active.store.pool.query('delete from auto_reply_review_events where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from auto_reply_review_records where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from auto_reply_conversation_state where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from messages.auto_reply_run_events where account_id=$1', [accountId]);
    if (conversationId) await active.store.pool.query('delete from messages.auto_reply_runs where conversation_id=$1', [conversationId]);
    if (accountId) await active.store.pool.query('delete from messages.messages where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from messages.events where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from messages.conversations where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from products.products where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from observability.audit_events where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from auth.account_credentials where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from auth.account_scopes where account_id=$1', [accountId]);
    if (accountId) await active.store.pool.query('delete from accounts.accounts where id=$1', [accountId]);
    if (adminId) await active.store.pool.query('delete from auth.sessions where admin_id=$1', [adminId]);
    if (adminId) await active.store.pool.query('delete from auth.admins where id=$1', [adminId]);
  }
  if (runtime) await runtime.close();
  globalThis.fetch = originalFetch;
}

function pushFrame(mid, conversationRef, messageRef, senderRef, text, senderName) {
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

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for buyer push auto-reply chain');
}
