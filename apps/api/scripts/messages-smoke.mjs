import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { loadConfig } from '../dist/config.js';
import { WebSocket } from 'ws';

let port = 0;
const config = loadConfig({ ...process.env, PORT: String(port), HOST: '127.0.0.1', ALLOW_IN_MEMORY: 'true', DATABASE_URL: '', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub', WS_ALLOWED_ORIGINS: 'http://localhost:5173' });
const runtime = createApp(config);

function cookiesFrom(response) {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; ');
}

async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}

async function waitForOpen(socket) {
  await Promise.race([
    new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('websocket open timeout')), 3_000)),
  ]);
}

async function expectHandshakeFailure(url, options, expectedStatus) {
  const status = await new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    const timer = setTimeout(() => { socket.terminate(); reject(new Error(`websocket rejection timeout (expected ${expectedStatus})`)); }, 3_000);
    socket.once('open', () => { clearTimeout(timer); socket.close(); reject(new Error(`websocket unexpectedly opened (expected ${expectedStatus})`)); });
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      response.resume();
      resolve(response.statusCode);
    });
    socket.once('error', () => { /* ws emits error after an HTTP rejection on some Node versions */ });
  });
  assert.equal(status, expectedStatus);
}

async function collect(socket, count, timeoutMs = 2_000) {
  const events = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), timeoutMs);
    socket.on('message', (raw) => { events.push(JSON.parse(raw.toString())); if (events.length >= count) { clearTimeout(timer); resolve(); } });
    socket.once('error', reject);
  });
  return events;
}

try {
  console.log('messages smoke: listen');
  await runtime.listen();
  const address = runtime.server.address();
  if (!address || typeof address === 'string') throw new Error('messages smoke: server address unavailable');
  port = address.port;
  console.log('messages smoke: bootstrap');
  const boot = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'messages-bootstrap-1' }, body: JSON.stringify({ email: 'messages@example.com', password: 'password-123', displayName: 'Messages Admin' }) });
  assert.equal(boot.response.status, 200);
  const cookie = cookiesFrom(boot.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const account = await request('/api/v1/accounts', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'messages-account-1' }, body: JSON.stringify({ platform: 'xianyu', sellerRef: 'messages-seller', displayName: '聊天账号' }) });
  assert.equal(account.response.status, 201);
  const accountId = account.body.data.id;
  const adminId = boot.body.data.profile.id;
  const conversation = await runtime.store.createConversation({ adminId, accountId, buyerRef: 'buyer-1', buyerDisplayName: '买家一号', itemTitle: '资料包', externalConversationRef: 'ext-c1' });
  const first = await runtime.store.createMessage({ adminId, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '请问什么时候发货？', source: 'system', traceId: 'seed-1' });
  console.log('messages smoke: http read');
  const secondConversation = await runtime.store.createConversation({ adminId, accountId, buyerRef: 'buyer-2', externalConversationRef: 'ext-c2' });
  const secondAccount = await request('/api/v1/accounts', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'messages-account-2' }, body: JSON.stringify({ platform: 'xianyu', sellerRef: 'messages-seller-2', displayName: '聊天账号二' }) });
  assert.equal(secondAccount.response.status, 201);
  const secondConversationForScope = await runtime.store.createConversation({ adminId, accountId: secondAccount.body.data.id, buyerRef: 'buyer-cross', externalConversationRef: 'ext-cross' });
  await runtime.store.revokeScope(adminId, secondAccount.body.data.id, 'manage');

  // Refresh the external head only on the first page. Later pages must keep
  // using the opaque local cursor without re-upserting every conversation.
  let externalRefreshCalls = 0;
  runtime.xianyuIm.listConversations = async () => { externalRefreshCalls += 1; return { items: [], hasMore: false }; };

  const list = await request(`/api/v1/conversations?accountId=${accountId}`, { headers: { cookie } });
  assert.equal(list.response.status, 200);
  assert.ok(list.body.data.items.some((item) => item.conversationId === conversation.id));
  const firstPage = await request(`/api/v1/conversations?accountId=${accountId}&limit=1`, { headers: { cookie } });
  assert.equal(firstPage.response.status, 200);
  assert.equal(firstPage.body.data.items.length, 1);
  assert.equal(firstPage.body.data.hasMore, true);
  assert.equal(typeof firstPage.body.data.nextCursor, 'string');
  const refreshCallsAfterFirstPage = externalRefreshCalls;
  assert.equal(refreshCallsAfterFirstPage, 2);
  const secondPage = await request(`/api/v1/conversations?accountId=${accountId}&limit=1&cursor=${encodeURIComponent(firstPage.body.data.nextCursor)}`, { headers: { cookie } });
  assert.equal(secondPage.response.status, 200);
  assert.equal(secondPage.body.data.items.length, 1);
  assert.equal(externalRefreshCalls, refreshCallsAfterFirstPage);
  assert.notEqual(secondPage.body.data.items[0].conversationId, firstPage.body.data.items[0].conversationId);
  assert.equal(new Set([firstPage.body.data.items[0].conversationId, secondPage.body.data.items[0].conversationId]).has(secondConversation.id), true);
  const history = await request(`/api/v1/conversations/${conversation.id}/messages`, { headers: { cookie } });
  assert.equal(history.response.status, 200);
  assert.equal(history.body.data.items[0].messageId, first.message.id);
  assert.equal(history.body.data.latestCursor, 1);

  console.log('messages smoke: ws rejection checks');
  await expectHandshakeFailure(`ws://127.0.0.1:${port}/api/v1/conversations/${conversation.id}/events?cursor=0`, { headers: { Origin: 'http://localhost:5173' } }, 401);
  await expectHandshakeFailure(`ws://127.0.0.1:${port}/api/v1/conversations/${conversation.id}/events?cursor=0`, { headers: { Cookie: cookie, Origin: 'http://evil.example' } }, 403);
  await expectHandshakeFailure(`ws://127.0.0.1:${port}/api/v1/conversations/${secondConversationForScope.id}/events?cursor=0`, { headers: { Cookie: cookie, Origin: 'http://localhost:5173' } }, 404);

  const ws1 = new WebSocket(`ws://127.0.0.1:${port}/api/v1/conversations/${conversation.id}/events?cursor=0`, { headers: { Cookie: cookie, Origin: 'http://localhost:5173' } });
  console.log('messages smoke: ws1 open');
  const firstEventsPromise = collect(ws1, 2);
  await waitForOpen(ws1);
  const firstEvents = await firstEventsPromise;
  assert.deepEqual(firstEvents.filter((event) => event.type === 'chat.message.created').map((event) => event.cursor), [1]);
  assert.equal(firstEvents.find((event) => event.type === 'chat.message.created')?.payload?.message?.messageId, first.message.id);
  assert.ok(firstEvents.some((event) => event.type === 'chat.connection.changed'));
  ws1.close();
  await new Promise((resolve) => ws1.once('close', resolve));
  console.log('messages smoke: ws2');

  const second = await runtime.messages.createMessage({ adminId, conversationId: conversation.id, direction: 'outbound', senderRole: 'agent', bodyType: 'text', bodyText: '付款后会自动发送。', source: 'human', requestId: 'req-message-2', traceId: 'trace-message-2' });
  const ws2 = new WebSocket(`ws://127.0.0.1:${port}/api/v1/conversations/${conversation.id}/events?cursor=1`, { headers: { Cookie: cookie, Origin: 'http://localhost:5173' } });
  const secondEventsPromise = collect(ws2, 2);
  await waitForOpen(ws2);
  const secondEvents = await secondEventsPromise;
  assert.deepEqual(secondEvents.filter((event) => event.type === 'chat.message.created').map((event) => event.cursor), [2]);
  assert.equal(secondEvents.find((event) => event.type === 'chat.message.created')?.payload?.message?.messageId, second.message.messageId);
  ws2.close();
  await new Promise((resolve) => ws2.once('close', resolve));

  const forbidden = await request('/api/v1/conversations?accountId=00000000-0000-0000-0000-000000000000', { headers: { cookie } });
  assert.equal(forbidden.response.status, 403);
  const missing = await request('/api/v1/conversations/00000000-0000-0000-0000-000000000000/messages', { headers: { cookie } });
  assert.equal(missing.response.status, 404);
  console.log('messages smoke passed');
} finally {
  runtime.server.closeAllConnections?.();
  runtime.server.closeIdleConnections?.();
  await runtime.close();
}
