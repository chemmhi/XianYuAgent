import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../dist/app.js';

const modelServer = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const parsed = JSON.parse(body || '{}');
  const prompt = JSON.stringify(parsed.messages ?? []);
  const content = prompt.includes('已有知识库')
    ? JSON.stringify({ knowledgeBase: '交付方式：付款后发送。\n适用范围：仅限本商品。' })
    : JSON.stringify({ knowledgeBase: '高频问题：多久发货？\n答案：付款后马上发送。' });
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ model: 'smoke-model', choices: [{ message: { content } }] }));
});
await new Promise((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
const modelPort = modelServer.address().port;
const port = 18480 + (process.pid % 300);
const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub', modelApiKey: 'test-key', modelBaseUrl: `http://127.0.0.1:${modelPort}`, modelName: 'smoke-model', modelWireApi: 'chat' });
await runtime.listen();

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'kb-api-bootstrap' }, body: JSON.stringify({ email: 'kb-api@example.com', password: 'password-123', displayName: 'KB API' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const adminId = bootstrap.body.data.profile.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'kb-api-seller' });
  const product = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: 'item-kb-api', title: '接口商品', status: 'ready', knowledgeBase: '已有交付说明。' });
  const conversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-api', itemRef: product.externalProductRef, itemTitle: product.title });
  await runtime.store.createMessage({ adminId, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '多久发货？', source: 'system' });
  await runtime.store.createMessage({ adminId, conversationId: conversation.id, direction: 'outbound', senderRole: 'agent', bodyType: 'text', bodyText: 'AI 回复不能进入知识库', source: 'ai' });
  await runtime.store.createMessage({ adminId, conversationId: conversation.id, direction: 'outbound', senderRole: 'agent', bodyType: 'text', bodyText: '付款后马上发送。', source: 'human' });

  const generated = await request(`/api/v1/products/${product.id}/knowledge-base/generate-from-conversations`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'kb-generate-api', 'If-Match-Version': String(product.configVersion) }, body: JSON.stringify({ accountId: account.id }) });
  assert.equal(generated.response.status, 200);
  assert.equal(generated.body.data.humanReplyCount, 1);
  assert.match(generated.body.data.product.knowledgeBase, /多久发货/);
  assert.doesNotMatch(generated.body.data.product.knowledgeBase, /AI 回复不能进入/);

  const generatedVersion = generated.body.data.product.configVersion;
  const optimized = await request(`/api/v1/products/${product.id}/knowledge-base/optimize`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'kb-optimize-api', 'If-Match-Version': String(generatedVersion) }, body: JSON.stringify({ accountId: account.id }) });
  assert.equal(optimized.response.status, 200);
  assert.equal(optimized.body.data.product.knowledgeBase, '交付方式：付款后发送。\n适用范围：仅限本商品。');

  const replay = await request(`/api/v1/products/${product.id}/knowledge-base/optimize`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'kb-optimize-api', 'If-Match-Version': String(generatedVersion) }, body: JSON.stringify({ accountId: account.id }) });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.data.product.knowledgeBase, optimized.body.data.product.knowledgeBase);
  console.log('product knowledge base API smoke passed');
} finally {
  await runtime.close();
  await new Promise((resolve) => modelServer.close(resolve));
}
