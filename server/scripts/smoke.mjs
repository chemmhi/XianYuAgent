import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 18080 + Math.floor(Math.random() * 500);
const child = spawn(process.execPath, ['dist/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false', DATABASE_URL: '' },
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

  console.log('env0 smoke passed');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}
