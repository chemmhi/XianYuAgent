import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { decryptCredentialValue, encryptCredentialValue } from '../dist/credential-crypto.js';

const port = 18680 + (process.pid % 300);
const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub', credentialEncryptionKey: 'smoke-encryption-key' });
await runtime.listen();

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}

try {
  const encrypted = encryptCredentialValue('sk-test-secret-123456', 'smoke-encryption-key');
  assert.notEqual(encrypted, 'sk-test-secret-123456');
  assert.equal(decryptCredentialValue(encrypted, 'smoke-encryption-key'), 'sk-test-secret-123456');

  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'credential-bootstrap' }, body: JSON.stringify({ email: 'credential@example.com', password: 'password-123', displayName: 'Credential Test' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');

  const account = await request('/api/v1/accounts', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'credential-account' }, body: JSON.stringify({ platform: 'xianyu', sellerRef: 'credential-seller', displayName: 'Credential Account' }) });
  assert.equal(account.response.status, 201);
  const accountId = account.body.data.id;

  const empty = await request(`/api/v1/credentials?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  assert.equal(empty.response.status, 200);
  assert.deepEqual(empty.body.data.items, []);

  const created = await request('/api/v1/credentials', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'credential-create' }, body: JSON.stringify({ accountId, provider: 'openai-compatible', alias: 'primary', label: '主模型', apiKey: 'sk-test-secret-123456' }) });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.data.provider, 'openai-compatible');
  assert.equal(created.body.data.canReveal, false);
  assert.equal(created.body.data.apiKey, undefined);
  assert.equal(JSON.stringify(created.body).includes('sk-test-secret-123456'), false);
  const credentialId = created.body.data.id;

  const listed = await request(`/api/v1/credentials?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  assert.equal(listed.body.data.items.length, 1);
  assert.equal(listed.body.data.items[0].version, 1);

  const rotated = await request(`/api/v1/credentials/${credentialId}/rotate`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'credential-rotate' }, body: JSON.stringify({ expectedVersion: 1, apiKey: 'sk-rotated-secret-987654' }) });
  assert.equal(rotated.response.status, 200);
  assert.equal(rotated.body.data.version, 2);
  assert.equal(rotated.body.data.apiKey, undefined);

  const stale = await request(`/api/v1/credentials/${credentialId}/disable`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'credential-disable-stale' }, body: JSON.stringify({ expectedVersion: 1 }) });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, 'VERSION_CONFLICT');

  const disabled = await request(`/api/v1/credentials/${credentialId}/disable`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'credential-disable' }, body: JSON.stringify({ expectedVersion: 2 }) });
  assert.equal(disabled.response.status, 200);
  assert.equal(disabled.body.data.status, 'disabled');

  const revoked = await request(`/api/v1/credentials/${credentialId}/revoke`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'credential-revoke' }, body: JSON.stringify({ expectedVersion: 3 }) });
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.body.data.status, 'revoked');

  const enableRevoked = await request(`/api/v1/credentials/${credentialId}/enable`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'credential-enable-revoked' }, body: JSON.stringify({ expectedVersion: 4 }) });
  assert.equal(enableRevoked.response.status, 409);

  console.log('credential store smoke passed');
} finally {
  await runtime.close();
}
