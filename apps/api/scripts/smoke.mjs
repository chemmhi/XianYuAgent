import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 18080 + Math.floor(Math.random() * 500);
const child = spawn(process.execPath, ['dist/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false', DATABASE_URL: '', XIANYU_QR_MODE: 'stub' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => { output += chunk.toString(); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); });

async function waitForServer() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${port}/healthz`); if (response.status === 200) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start: ${output}`);
}

function cookiesFrom(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  return values.map((value) => value.split(';', 1)[0]).join('; ');
}

async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}

try {
  await waitForServer();
  const health = await request('/healthz');
  assert.equal(health.body.success, true);
  assert.equal(health.body.data.storage, 'memory');

  const initial = await request('/api/v1/auth/session');
  assert.equal(initial.body.data.bootstrapRequired, true);

  const bootstrapBody = JSON.stringify({ email: 'admin@example.com', password: 'password-123', displayName: 'Admin' });
  const first = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'bootstrap-1' }, body: bootstrapBody });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.data.profile.email, 'admin@example.com');
  const cookie = cookiesFrom(first.response);
  const csrf = cookie.match(/csrf_token=([^;]+)/)?.[1];
  assert.ok(csrf);

  const replay = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'bootstrap-1' }, body: bootstrapBody });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.data.profile.id, first.body.data.profile.id);

  const conflict = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'bootstrap-1' }, body: JSON.stringify({ email: 'other@example.com', password: 'password-123', displayName: 'Other' }) });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');

  const session = await request('/api/v1/auth/session', { headers: { cookie } });
  assert.equal(session.body.data.authenticated, true);

  const csrfFail = await request('/api/v1/accounts', { method: 'POST', headers: { cookie, 'Idempotency-Key': 'account-1' }, body: JSON.stringify({ platform: 'xianyu', sellerRef: 'seller-001', displayName: 'Primary' }) });
  assert.equal(csrfFail.response.status, 403);
  assert.equal(csrfFail.body.error.code, 'CSRF_INVALID');

  const created = await request('/api/v1/accounts', { method: 'POST', headers: { cookie, 'X-CSRF-Token': decodeURIComponent(csrf), 'Idempotency-Key': 'account-1' }, body: JSON.stringify({ platform: 'xianyu', sellerRef: 'seller-001', displayName: 'Primary' }) });
  assert.equal(created.response.status, 201);
  const listed = await request('/api/v1/accounts', { headers: { cookie } });
  assert.equal(listed.body.data.items.length, 1);
  assert.equal(listed.body.data.items[0].sellerRef, 'seller-001');
  const accountId = listed.body.data.items[0].id;

  const missingCredential = await request(`/api/v1/accounts/${accountId}/credential`, { headers: { cookie } });
  assert.equal(missingCredential.response.status, 404);

  const savedCredential = await request(`/api/v1/accounts/${accountId}/credential`, {
    method: 'PUT',
    headers: { cookie, 'X-CSRF-Token': decodeURIComponent(csrf), 'Idempotency-Key': 'credential-save-1' },
    body: JSON.stringify({ cookieHeader: 'unb=seller-001; _m_h5_tk=token-abc_123', accessToken: 'access-token-abc', deviceId: 'device-001', metadata: { source: 'qr' } }),
  });
  assert.equal(savedCredential.response.status, 200);
  assert.equal(savedCredential.body.data.status, 'active');
  assert.equal(savedCredential.body.data.fields.cookieHeader, true);
  assert.equal(savedCredential.body.data.cookieHeader, undefined);

  const accountAfterCredential = await request(`/api/v1/accounts/${accountId}`, { headers: { cookie } });
  assert.equal(accountAfterCredential.body.data.status, 'connected');

  const readCredential = await request(`/api/v1/accounts/${accountId}/credential`, { headers: { cookie } });
  assert.equal(readCredential.response.status, 200);
  assert.equal(readCredential.body.data.accessToken, 'access-token-abc');
  assert.equal(readCredential.body.data.metadata.source, 'qr');

  const verifiedCredential = await request(`/api/v1/accounts/${accountId}/credential/verify`, {
    method: 'POST',
    headers: { cookie, 'X-CSRF-Token': decodeURIComponent(csrf), 'Idempotency-Key': 'credential-verify-1' },
    body: JSON.stringify({ status: 'active' }),
  });
  assert.equal(verifiedCredential.response.status, 200);
  assert.equal(verifiedCredential.body.data.status, 'active');
  assert.ok(verifiedCredential.body.data.lastVerifiedAt);

  const revokedCredential = await request(`/api/v1/accounts/${accountId}/credential/revoke`, {
    method: 'POST',
    headers: { cookie, 'X-CSRF-Token': decodeURIComponent(csrf), 'Idempotency-Key': 'credential-revoke-1' },
    body: JSON.stringify({}),
  });
  assert.equal(revokedCredential.response.status, 200);
  assert.equal(revokedCredential.body.data.status, 'revoked');

  const accountAfterRevoke = await request(`/api/v1/accounts/${accountId}`, { headers: { cookie } });
  assert.equal(accountAfterRevoke.body.data.status, 'disconnected');

  const loginSession = await request(`/api/v1/accounts/${accountId}/login-sessions`, {
    method: 'POST',
    headers: { cookie, 'X-CSRF-Token': decodeURIComponent(csrf), 'Idempotency-Key': 'credential-login-session-1' },
    body: JSON.stringify({ loginMethod: 'qr' }),
  });
  assert.equal(loginSession.response.status, 201);
  const loginSessionId = loginSession.body.data.id ?? loginSession.body.data.qrSessionId;
  assert.ok(loginSessionId);
  const completedLogin = await request(`/api/v1/accounts/${accountId}/login-sessions/${loginSessionId}/complete`, {
    method: 'POST',
    headers: { cookie, 'X-CSRF-Token': decodeURIComponent(csrf), 'Idempotency-Key': 'credential-login-complete-1' },
    body: JSON.stringify({ cookieHeader: 'unb=seller-001; _m_h5_tk=token-def_456', accessToken: 'access-token-def', deviceId: 'device-002', metadata: { source: 'qr-callback' } }),
  });
  assert.equal(completedLogin.response.status, 200);
  assert.equal(completedLogin.body.data.session.status, 'succeeded');
  assert.equal(completedLogin.body.data.credential.status, 'active');
  assert.equal(completedLogin.body.data.credential.cookieHeader, undefined);
  const completedRead = await request(`/api/v1/accounts/${accountId}/login-sessions/${loginSessionId}`, { headers: { cookie } });
  assert.equal(completedRead.body.data.status, 'succeeded');
  const completedQrRead = await request(`/api/v1/auth/qr-sessions/${loginSessionId}`, { headers: { cookie } });
  assert.equal(completedQrRead.body.data.status, 'succeeded');

  const expiredWrite = await request(`/api/v1/accounts/${accountId}/credential`, {
    method: 'PUT',
    headers: { cookie, 'X-CSRF-Token': decodeURIComponent(csrf), 'Idempotency-Key': 'credential-expiry-1' },
    body: JSON.stringify({ expiresAt: new Date(Date.now() - 1_000).toISOString() }),
  });
  assert.equal(expiredWrite.response.status, 200);
  const expiredRead = await request(`/api/v1/accounts/${accountId}/credential`, { headers: { cookie } });
  assert.equal(expiredRead.body.data.status, 'expired');
  const accountAfterExpiry = await request(`/api/v1/accounts/${accountId}`, { headers: { cookie } });
  assert.equal(accountAfterExpiry.body.data.status, 'expired');

  const deleted = await request(`/api/v1/accounts/${accountId}`, {
    method: 'DELETE',
    headers: { cookie, 'X-CSRF-Token': decodeURIComponent(csrf), 'Idempotency-Key': 'account-delete-1' },
    body: JSON.stringify({}),
  });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.body.data.deleted, true);
  assert.equal(deleted.body.data.account.status, 'disabled');
  const afterDeleteList = await request('/api/v1/accounts', { headers: { cookie } });
  assert.equal(afterDeleteList.response.status, 200);
  assert.equal(afterDeleteList.body.data.items.length, 0);
  const afterDeleteGet = await request(`/api/v1/accounts/${accountId}`, { headers: { cookie } });
  assert.equal(afterDeleteGet.response.status, 404);
  const deletedReplay = await request(`/api/v1/accounts/${accountId}`, {
    method: 'DELETE',
    headers: { cookie, 'X-CSRF-Token': decodeURIComponent(csrf), 'Idempotency-Key': 'account-delete-1' },
    body: JSON.stringify({}),
  });
  assert.equal(deletedReplay.response.status, 200);
  assert.deepEqual(deletedReplay.body, deleted.body);

  console.log('env0 smoke passed');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}
