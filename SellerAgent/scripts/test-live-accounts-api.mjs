import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const { createAccountsApi } = await import('../src/features/accounts/api.ts');
const port = 18500 + Math.floor(Math.random() * 300);
const child = spawn(process.execPath, ['dist/index.js'], {
  cwd: new URL('../../server', import.meta.url),
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false', DATABASE_URL: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => { output += chunk.toString(); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); });

async function waitForServer() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start: ${output}`);
}

function cookiesFrom(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  return values.map((value) => value.split(';', 1)[0]).join('; ');
}

async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  return { response, body: await response.json() };
}

try {
  await waitForServer();
  const bootstrap = await request('/api/v1/auth/bootstrap', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'live-accounts-bootstrap-1' },
    body: JSON.stringify({ email: 'live@example.com', password: 'password-123', displayName: 'Live Admin' }),
  });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  assert.ok(csrf);

  const created = await request('/api/v1/accounts', {
    method: 'POST',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'live-accounts-create-1' },
    body: JSON.stringify({ platform: 'xianyu', sellerRef: 'live-seller-001', displayName: 'Live Account' }),
  });
  assert.equal(created.response.status, 201);

  const accountsApi = createAccountsApi({
    async get(path) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { cookie } });
      return response.json();
    },
  });
  const page = await accountsApi.list();
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.sellerRef, 'live-seller-001');
  assert.equal(page.items[0]?.displayName, 'Live Account');
  const detail = await accountsApi.getDetail(page.items[0].id);
  assert.equal(detail.sellerRef, 'live-seller-001');
  const connection = await accountsApi.getConnection(page.items[0].id);
  assert.equal(connection.status, 'connecting');
  console.log('live accounts API integration passed');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}
