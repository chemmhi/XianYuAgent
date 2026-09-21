import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { hashPassword } from '../dist/security.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const suffix = `${process.pid}-${Date.now()}`;
const email = `auto-reply-pg-${suffix}@example.com`;
const sellerRef = `auto-reply-pg-${suffix}`;
const originalFetch = globalThis.fetch;
let modelCall = 0;
globalThis.fetch = (async (_input, init) => {
  modelCall += 1;
  const body = JSON.parse(String(init?.body));
  const message = modelCall === 1
    ? { content: '', tool_calls: [{ id: 'pg-product-1', type: 'function', function: { name: 'get_product_info', arguments: '{}' } }] }
    : { content: '这是一个 PostgreSQL 回归测试商品，已确认可以正常回复。' };
  assert.equal(body.model, 'auto-reply-postgres-smoke');
  return new Response(JSON.stringify({ model: 'auto-reply-postgres-smoke', choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
});
const config = { host: '127.0.0.1', port: 0, databaseUrl, cookieSecure: false, allowInMemory: false, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub', modelApiKey: 'auto-reply-postgres-smoke-key', modelBaseUrl: 'https://model.example/v1', modelName: 'auto-reply-postgres-smoke', modelTimeoutMs: 5_000, autoReplyModelEnabled: true, autoReplySendMode: 'simulate', autoReplyTestBuyerNames: [`Auto Reply PostgreSQL Buyer`] };
let runtime;
let adminId;
let accountId;
let conversationId;
let inboundMessageId;

try {
  runtime = createApp(config);
  await runtime.listen();
  const admin = await runtime.store.createAdmin({ email, passwordHash: await hashPassword('password-123'), displayName: 'Auto Reply PostgreSQL Smoke' });
  adminId = admin.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef });
  accountId = account.id;
  const product = await runtime.store.createProduct({ adminId, accountId, externalProductRef: `1078553391460-${suffix}`, title: 'Postgres 资料包', priceMinor: 2_590, status: 'published' });
  const conversation = await runtime.store.createConversation({ adminId, accountId, buyerRef: `pg-buyer-${suffix}`, buyerDisplayName: 'Auto Reply PostgreSQL Buyer', itemRef: product.externalProductRef, itemTitle: product.title, externalConversationRef: `pg-conv-${suffix}` });
  conversationId = conversation.id;

  const result = await runtime.xianyuIm.handleExternalEvent(adminId, {
    accountId,
    externalConversationRef: conversation.externalConversationRef,
    externalMessageRef: `pg-inbound-${suffix}.PNM`,
    senderRef: conversation.buyerRef,
    direction: 'inbound',
    bodyType: 'text',
    bodyText: '请问这个是什么东西？',
    occurredAt: new Date().toISOString(),
  });
  assert.equal(result.created, true);
  assert.equal(result.autoReply?.run.status, 'persisted');
  assert.equal(result.autoReply?.run.senderOutcome, 'simulated');
  assert.equal(result.autoReply?.context?.product?.id, product.id);
  assert.equal(result.autoReply?.outboundMessage?.source, 'ai');
  assert.equal(modelCall, 2);
  inboundMessageId = result.autoReply?.inboundMessage.id;

  const storedRun = await runtime.store.getAutoReplyRun(adminId, result.autoReply.run.id);
  assert.equal(storedRun?.outboundMessageId, result.autoReply.outboundMessage?.id);
  const storedMessages = await runtime.store.listMessages(adminId, conversationId, { limit: 20 });
  assert.equal(storedMessages.items.filter((message) => message.direction === 'inbound').length, 1);
  assert.equal(storedMessages.items.filter((message) => message.direction === 'outbound' && message.source === 'ai').length, 1);

  await runtime.close();
  runtime = createApp(config);
  await runtime.listen();
  const rereadRun = await runtime.store.findAutoReplyRunByInboundMessage(adminId, inboundMessageId);
  assert.equal(rereadRun?.status, 'persisted');
  assert.equal(rereadRun?.senderOutcome, 'simulated');
  const rereadMessages = await runtime.store.listMessages(adminId, conversationId, { limit: 20 });
  assert.equal(rereadMessages.items.some((message) => message.source === 'ai' && message.direction === 'outbound'), true);
  console.log('auto reply postgres persistence smoke passed');
} finally {
  const active = runtime;
  if (active?.store?.pool) {
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
