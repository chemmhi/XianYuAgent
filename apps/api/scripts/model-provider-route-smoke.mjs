import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const port = 18920 + (process.pid % 300);
const originalFetch = globalThis.fetch;
let providerMode = 'success';
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('https://provider.example/')) {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer sk-models-route-secret');
    if (providerMode === 'error') return new Response('', { status: 503 });
    return new Response(JSON.stringify({ data: [{ id: 'provider-live-model' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(input, init);
};
const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub', credentialEncryptionKey: 'models-route-smoke-key' });
await runtime.listen();

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await originalFetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  return { response, body: await response.json() };
}

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'models-route-bootstrap' }, body: JSON.stringify({ email: 'models-route@example.com', password: 'password-123', displayName: 'Models Route' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const account = await request('/api/v1/accounts', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'models-route-account' }, body: JSON.stringify({ platform: 'xianyu', sellerRef: 'models-route-seller' }) });
  const accountId = account.body.data.id;
  const credential = await request('/api/v1/credentials', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'models-route-credential' }, body: JSON.stringify({ accountId, provider: 'openai-compatible', alias: 'primary', apiKey: 'sk-models-route-secret', metadata: { baseUrl: 'https://provider.example/v1' } }) });
  const configId = credential.body.data.id;

  const listed = await request(`/api/v1/settings/openai/models?accountId=${accountId}&configId=${configId}`, { headers: { cookie } });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.data.accountId, accountId);
  assert.equal(listed.body.data.configId, configId);
  assert.equal(listed.body.data.provider, 'openai-compatible');
  assert.deepEqual(listed.body.data.models, [{ id: 'provider-live-model' }]);
  assert.equal(JSON.stringify(listed.body).includes('sk-models-route-secret'), false);

  providerMode = 'error';
  const failed = await request(`/api/v1/settings/openai/models?accountId=${accountId}&configId=${configId}`, { headers: { cookie } });
  assert.equal(failed.response.status, 502);
  assert.equal(failed.body.error.code, 'MODEL_PROVIDER_HTTP_ERROR');
  assert.equal(JSON.stringify(failed.body).includes('sk-models-route-secret'), false);
  console.log('model provider route smoke passed');
} finally {
  globalThis.fetch = originalFetch;
  await runtime.close();
}
