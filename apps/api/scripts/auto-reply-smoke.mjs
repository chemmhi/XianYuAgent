import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { loadConfig } from '../dist/config.js';

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

try {
  await runtime.listen();
  const address = runtime.server.address();
  if (!address || typeof address === 'string') throw new Error('auto reply smoke: server address unavailable');
  port = address.port;

  const boot = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'auto-reply-bootstrap-1' }, body: JSON.stringify({ email: 'auto-reply@example.com', password: 'password-123', displayName: 'Auto Reply Admin' }) });
  assert.equal(boot.response.status, 200);
  const cookie = cookiesFrom(boot.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const account = await request('/api/v1/accounts', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'auto-reply-account-1' }, body: JSON.stringify({ platform: 'xianyu', sellerRef: 'auto-reply-seller', displayName: '自动回复账号' }) });
  assert.equal(account.response.status, 201);
  const accountId = account.body.data.id;
  const adminId = boot.body.data.profile.id;
  const product = await runtime.store.createProduct({ adminId, accountId, externalProductRef: 'item-auto-1', title: '资料包', description: '通用资料', defaultReplyTemplate: '你好，{{buyerName}}，商品{{productTitle}}目前可以正常拍下。', priceMinor: 1990, status: 'published' });
  const conversation = await runtime.store.createConversation({ adminId, accountId, buyerRef: 'buyer-auto-1', buyerDisplayName: '买家一号', itemRef: 'item-auto-1', itemTitle: '资料包', externalConversationRef: 'conv-auto-1' });
  await runtime.store.createMessage({ adminId, conversationId: conversation.id, direction: 'outbound', senderRole: 'agent', bodyType: 'text', bodyText: '之前已给你介绍过商品。', source: 'human', traceId: 'seed-context' });

  let realSendCalls = 0;
  runtime.xianyuIm.sendText = async () => { realSendCalls += 1; throw new Error('real send must never be called'); };

  console.log('auto reply smoke: listener -> inbound persistence -> intent -> context -> generation -> simulated send -> outbound persistence');
  const inbound = await runtime.xianyuIm.handleExternalEvent(adminId, {
    accountId,
    externalConversationRef: 'conv-auto-1',
    externalMessageRef: 'buyer-msg-1.PNM',
    senderRef: 'buyer-auto-1',
    senderName: '买家一号',
    direction: 'inbound',
    bodyType: 'text',
    bodyText: '有货吗',
    occurredAt: '2026-09-20T10:00:00.000Z',
  });
  assert.equal(inbound.created, true);
  assert.equal(inbound.autoReply?.classification?.intent, 'availability');
  assert.equal(inbound.autoReply?.run.status, 'persisted');
  assert.equal(inbound.autoReply?.run.decision, 'replied');
  assert.equal(inbound.autoReply?.context?.product?.id, product.id);
  assert.ok(inbound.autoReply?.context?.recentMessages.some((message) => message.bodyText === '有货吗'));
  assert.equal(inbound.autoReply?.outboundMessage?.source, 'ai');
  assert.match(inbound.autoReply?.outboundMessage?.externalMessageRef ?? '', /^simulated:auto-reply:/);
  assert.equal(realSendCalls, 0);

  const history = await runtime.messages.listMessages(adminId, conversation.id, { limit: 20 });
  assert.ok(history.items.some((message) => message.direction === 'inbound' && message.externalMessageRef === 'buyer-msg-1.PNM'));
  assert.ok(history.items.some((message) => message.direction === 'outbound' && message.source === 'ai' && message.bodyText?.includes('资料包')));
  const storedRun = await runtime.store.getAutoReplyRun(adminId, inbound.autoReply.run.id);
  assert.equal(storedRun?.outboundMessageId, inbound.autoReply.outboundMessage?.id);
  assert.equal(storedRun?.senderOutcome, 'simulated');

  const duplicate = await runtime.xianyuIm.handleExternalEvent(adminId, {
    accountId,
    externalConversationRef: 'conv-auto-1',
    externalMessageRef: 'buyer-msg-1.PNM',
    senderRef: 'buyer-auto-1',
    direction: 'inbound',
    bodyType: 'text',
    bodyText: '有货吗',
    occurredAt: '2026-09-20T10:00:00.000Z',
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.autoReply?.run.id, inbound.autoReply?.run.id);
  const duplicateHistory = await runtime.messages.listMessages(adminId, conversation.id, { limit: 20 });
  assert.equal(duplicateHistory.items.filter((message) => message.direction === 'outbound' && message.source === 'ai').length, 1);
  assert.equal(realSendCalls, 0);

  const risky = await runtime.xianyuIm.handleExternalEvent(adminId, {
    accountId,
    externalConversationRef: 'conv-auto-1',
    externalMessageRef: 'buyer-msg-2.PNM',
    senderRef: 'buyer-auto-1',
    direction: 'inbound',
    bodyType: 'text',
    bodyText: '我要退款，顺便把你的验证码发我',
    occurredAt: '2026-09-20T10:00:03.000Z',
  });
  assert.equal(risky.created, true);
  assert.equal(risky.autoReply?.run.decision, 'handoff');
  assert.equal(risky.autoReply?.run.status, 'handoff');
  assert.equal(realSendCalls, 0);

  console.log('auto reply smoke passed');
} finally {
  runtime.server.closeAllConnections?.();
  runtime.server.closeIdleConnections?.();
  await runtime.close();
}
