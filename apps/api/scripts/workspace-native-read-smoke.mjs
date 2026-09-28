import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const runtime = createApp({ host: '127.0.0.1', port: 0, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub', agentRuntime: 'in-process' });
await runtime.listen();
const address = runtime.server.address();
if (!address || typeof address === 'string') throw new Error('runtime did not expose a TCP port');
const base = `http://127.0.0.1:${address.port}`;

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}
async function waitForRun(runId, cookie) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const current = await request(`/api/v1/workspace/runs/${runId}`, { headers: { cookie } });
    if (['succeeded', 'failed', 'cancelled', 'expired'].includes(current.body.data.status)) return current.body.data;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('workspace native read run timed out');
}

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'native-read-bootstrap' }, body: JSON.stringify({ email: 'native-read-route@example.com', password: 'password-123', displayName: 'Native Read Route' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const adminId = bootstrap.body.data.profile.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'native-read-route-seller', displayName: '原生读链路账号' });
  const product = await runtime.store.createProduct({ adminId, accountId: account.id, title: '原生读链路商品', description: 'Workspace product', priceMinor: 2_499, status: 'published' });
  const batch = await runtime.store.createCouponBatch({ adminId, accountId: account.id, label: '原生读链路卡券', purpose: 'text' });
  await runtime.store.importCouponItems({ adminId, batchId: batch.id, contents: ['ROUTE-SECRET-1'] });
  await runtime.store.bindCouponBatch({ adminId, batchId: batch.id, productId: product.id });
  await runtime.store.createOrder({ adminId, order: { orderNo: 'NATIVE-ROUTE-ORDER', accountId: account.id, accountName: account.displayName, buyerId: 'route-buyer', buyerName: '路由买家', itemId: product.id, itemTitle: product.title, amountMinor: 2_499, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), productId: product.id } });
  const conversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'route-buyer', buyerDisplayName: '路由买家', itemTitle: product.title });
  const inbound = await runtime.store.createMessage({ adminId, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '有货吗', source: 'human' });
  const autoReplyRun = await runtime.store.createAutoReplyRun({ adminId, accountId: account.id, conversationId: conversation.id, inboundMessageId: inbound.message.id, intent: 'availability', decision: 'replied', status: 'received', inputDigest: 'sha256:route-input' });
  await runtime.store.updateAutoReplyRun(autoReplyRun.id, { status: 'persisted', senderOutcome: 'known_success' });
  const session = await request('/api/v1/workspace/agent-sessions', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'native-read-session' }, body: JSON.stringify({ accountId: account.id, title: '原生读路由会话' }) });
  assert.equal(session.response.status, 201);
  const sessionId = session.body.data.id;
  const cases = [
    ['查看当前账号的商品', /原生读链路商品/],
    ['有哪些可用卡券', /原生读链路卡券/],
    ['最近的订单', /NATIVE-ROUTE-ORDER/],
    ['查看今天 Agent 运营数据', /收到 1 条消息/],
  ];
  let caseIndex = 0;
  for (const [instruction, expected] of cases) {
    caseIndex += 1;
    const started = await request('/api/v1/workspace/runs', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `native-read-run-${caseIndex}` }, body: JSON.stringify({ accountId: account.id, sessionId, instruction, clientRunRef: `native-read-${caseIndex}` }) });
    assert.equal(started.response.status, 201);
    const completed = await waitForRun(started.body.data.runId, cookie);
    assert.equal(completed.status, 'succeeded');
    assert.match(completed.resultSummary, expected);
  }
  const messages = await request(`/api/v1/workspace/agent-sessions/${encodeURIComponent(sessionId)}/messages?limit=100`, { headers: { cookie } });
  assert.equal(messages.response.status, 200);
  assert.ok(messages.body.data.items.some((item) => /ROUTE-SECRET-1/.test(item.content) === false));
  assert.ok(messages.body.data.items.some((item) => item.type === 'final_answer' && /原生读链路商品/.test(item.content)));
  console.log('workspace native read HTTP smoke passed');
} finally {
  await runtime.close();
}

