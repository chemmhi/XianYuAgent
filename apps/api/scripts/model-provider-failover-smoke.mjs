import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const port = 19120 + (process.pid % 200);
const originalFetch = globalThis.fetch;
let primaryCompletionCalls = 0;
let backupCompletionCalls = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const auth = new Headers(init?.headers).get('authorization');
  if (url.startsWith('https://primary.example/')) {
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'primary-model' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    primaryCompletionCalls += 1;
    return new Response('', { status: 503 });
  }
  if (url.startsWith('https://backup.example/')) {
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'backup-model' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    backupCompletionCalls += 1;
    return new Response(JSON.stringify({ model: 'backup-model', output_text: 'backup-ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(input, init);
};

const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub', credentialEncryptionKey: 'failover-smoke-key' });
await runtime.listen();

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await originalFetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  return { response, body: await response.json() };
}

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'failover-bootstrap' }, body: JSON.stringify({ email: 'failover@example.com', password: 'password-123', displayName: 'Failover' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const account = await request('/api/v1/accounts', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'failover-account' }, body: JSON.stringify({ platform: 'xianyu', sellerRef: 'failover-seller' }) });
  const accountId = account.body.data.id;
  const save = async (role, baseUrl, model, apiKey) => request('/api/v1/settings/openai', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `failover-${role}` }, body: JSON.stringify({ accountId, role, provider: `${role}-provider`, alias: role, baseUrl, model, wireApi: 'responses', timeoutMs: 3_000, apiKey, probeStrategy: 'models' }) });
  assert.equal((await save('primary', 'https://primary.example/v1', 'primary-model', 'primary-secret')).response.status, 201);
  assert.equal((await save('backup', 'https://backup.example/v1', 'backup-model', 'backup-secret')).response.status, 201);

  const listed = await request(`/api/v1/settings/openai?accountId=${accountId}`, { headers: { cookie } });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.data.runtime.mode, 'auto');
  assert.equal(listed.body.data.runtime.effective_provider.role, 'primary');

  const primaryConfig = await runtime.openaiSettings.resolveById((await runtime.store.listAdminIds())[0], listed.body.data.items.find((item) => item.role === 'primary').id, accountId);
  const backupConfig = await runtime.openaiSettings.resolveById((await runtime.store.listAdminIds())[0], listed.body.data.items.find((item) => item.role === 'backup').id, accountId);
  const adminId = (await runtime.store.listAdminIds())[0];
  const service = await runtime.modelProviderRuntime.resolve({ adminId, accountId, configs: [primaryConfig, backupConfig], mode: 'auto', routingVersion: 0 });
  await service.complete({ messages: [{ role: 'user', content: 'first' }] });
  await service.complete({ messages: [{ role: 'user', content: 'second' }] });
  assert.equal(primaryCompletionCalls, 1);
  assert.equal(backupCompletionCalls, 2);

  const switched = await request('/api/v1/settings/openai/routing', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'failover-route-backup' }, body: JSON.stringify({ accountId, mode: 'manual_backup', preferredRole: 'backup', expectedVersion: 0 }) });
  assert.equal(switched.response.status, 200);
  assert.equal(switched.body.data.mode, 'manual_backup');
  const conflict = await request('/api/v1/settings/openai/routing', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'failover-route-conflict' }, body: JSON.stringify({ accountId, mode: 'auto', preferredRole: null, expectedVersion: 0 }) });
  assert.equal(conflict.response.status, 409);
  console.log('model provider failover smoke passed');
} finally {
  globalThis.fetch = originalFetch;
  await runtime.close();
}
