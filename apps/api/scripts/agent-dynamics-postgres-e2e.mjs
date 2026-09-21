import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const suffix = `${process.pid}-${Date.now()}`;
const email = `agent-dynamics-pg-${suffix}@example.com`;
const sellerRef = `agent-dynamics-pg-${suffix}`;
const originalFetch = globalThis.fetch;
let modelCall = 0;
let runtime;
let adminId;
let accountId;
let conversationId;
let runId;

globalThis.fetch = (async (_input, init) => {
  modelCall += 1;
  const body = JSON.parse(String(init?.body));
  assert.equal(body.model, 'agent-dynamics-postgres');
  const message = modelCall === 1
    ? { content: '', tool_calls: [{ id: 'agent-dynamics-product-1', type: 'function', function: { name: 'get_product_info', arguments: '{}' } }] }
    : { content: '这是一个真实 PostgreSQL Agent 动态验收回复。' };
  return new Response(JSON.stringify({ model: 'agent-dynamics-postgres', choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });
});

try {
  runtime = createApp({
    host: '127.0.0.1', port: 0, databaseUrl, cookieSecure: false, allowInMemory: false,
    sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub',
    modelApiKey: 'agent-dynamics-postgres-key', modelBaseUrl: 'https://model.example/v1', modelName: 'agent-dynamics-postgres', modelWireApi: 'chat', modelTimeoutMs: 5_000,
    autoReplyModelEnabled: true, autoReplySendMode: 'simulate', autoReplyTestBuyerNames: ['Agent Dynamics Buyer'],
  });
  await runtime.listen();
  const admin = await runtime.store.createAdmin({ email, passwordHash: 'hash', displayName: 'Agent Dynamics PG' });
  adminId = admin.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef, displayName: 'Agent 动态测试店铺' });
  accountId = account.id;
  const product = await runtime.store.createProduct({ adminId, accountId, externalProductRef: `agent-dynamics-item-${suffix}`, title: 'Agent 动态资料包', description: '用于真实链路验收的商品', priceMinor: 2_590, status: 'published' });
  const conversation = await runtime.store.createConversation({ adminId, accountId, buyerRef: `agent-dynamics-buyer-${suffix}`, buyerDisplayName: 'Agent Dynamics Buyer', itemRef: product.externalProductRef, itemTitle: product.title, externalConversationRef: `agent-dynamics-conversation-${suffix}` });
  conversationId = conversation.id;

  const result = await runtime.xianyuIm.handleExternalEvent(adminId, {
    accountId,
    externalConversationRef: conversation.externalConversationRef,
    externalMessageRef: `agent-dynamics-message-${suffix}.PNM`,
    senderRef: conversation.buyerRef,
    direction: 'inbound',
    bodyType: 'text',
    bodyText: '请介绍一下这个资料包。',
    occurredAt: new Date().toISOString(),
  });
  assert.equal(result.autoReply?.run.status, 'persisted');
  assert.equal(result.autoReply?.run.senderOutcome, 'simulated');
  runId = result.autoReply?.run.id;
  assert.ok(runId);

  const from = new Date(Date.now() - 60_000).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  const list = await runtime.autoReplyActivity.list({ adminId, query: { accountId, from, to, page: 1, pageSize: 20 } });
  const detail = await runtime.autoReplyActivity.detail({ adminId, runId });
  const summary = await runtime.autoReplyActivity.summary({ adminId, accountId, from, to });
  const runsInDb = await runtime.store.pool.query('select status, sender_outcome from messages.auto_reply_runs where id=$1', [runId]);
  const eventsInDb = await runtime.store.pool.query('select sequence, event_type, stage, status, payload_json from messages.auto_reply_run_events where run_id=$1 order by sequence', [runId]);

  assert.equal(list.total, 1);
  assert.equal(list.items[0]?.status, 'persisted');
  assert.ok(detail.events.length >= 3);
  assert.equal(summary.persistedCount, 1);
  assert.equal(runsInDb.rows[0]?.sender_outcome, 'simulated');
  assert.equal(eventsInDb.rows.length, detail.events.length);
  assert.ok(eventsInDb.rows.some((event) => event.payload_json?.input));
  assert.ok(eventsInDb.rows.some((event) => event.payload_json?.output));
  assert.ok(eventsInDb.rows.some((event) => event.payload_json?.output?.senderOutcome === 'simulated'));
  assert.ok(detail.inboundMessage?.bodyText?.includes('资料包'));
  assert.ok(detail.outboundMessages[0]?.bodyText?.includes('PostgreSQL'));
  assert.doesNotMatch(JSON.stringify(detail.events), /cookie|token|prompt|chain.?of.?thought|api.?key/i);
  assert.doesNotMatch(JSON.stringify(eventsInDb.rows), /请介绍一下这个资料包/);
  await assert.rejects(() => runtime.autoReplyActivity.list({ adminId, query: { accountId: '00000000-0000-0000-0000-000000000000', from, to, page: 1, pageSize: 20 } }), /account scope required/);
  assert.equal(modelCall, 2);
  console.log(JSON.stringify({ runId, listTotal: list.total, detailEvents: detail.events.length, dbEvents: eventsInDb.rows.length, persistedCount: summary.persistedCount }));
} finally {
  if (runtime?.store?.pool) {
    if (accountId) await runtime.store.pool.query('delete from messages.auto_reply_run_events where account_id=$1', [accountId]);
    if (runId) await runtime.store.pool.query('delete from messages.auto_reply_runs where id=$1', [runId]);
    if (accountId) await runtime.store.pool.query('delete from messages.messages where account_id=$1', [accountId]);
    if (accountId) await runtime.store.pool.query('delete from messages.events where account_id=$1', [accountId]);
    if (conversationId) await runtime.store.pool.query('delete from messages.conversations where id=$1', [conversationId]);
    if (accountId) await runtime.store.pool.query('delete from products.products where account_id=$1', [accountId]);
    if (accountId) await runtime.store.pool.query('delete from observability.audit_events where account_id=$1', [accountId]);
    if (accountId) await runtime.store.pool.query('delete from auth.account_scopes where account_id=$1', [accountId]);
    if (accountId) await runtime.store.pool.query('delete from accounts.accounts where id=$1', [accountId]);
    if (adminId) await runtime.store.pool.query('delete from auth.sessions where admin_id=$1', [adminId]);
    if (adminId) await runtime.store.pool.query('delete from auth.admins where id=$1', [adminId]);
  }
  if (runtime) await runtime.close();
  globalThis.fetch = originalFetch;
}
