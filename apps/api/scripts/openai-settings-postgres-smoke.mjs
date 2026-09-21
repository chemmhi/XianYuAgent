import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import pg from 'pg';
import { createApp } from '../dist/app.js';
import { hashPassword } from '../dist/security.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const provider = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'pg-provider-model' }] }));
    return;
  }
  response.writeHead(404);
  response.end();
});
await new Promise((resolve, reject) => provider.listen(0, '127.0.0.1', () => resolve(undefined)).once('error', reject));
const providerAddress = provider.address();
const providerBaseUrl = `http://127.0.0.1:${typeof providerAddress === 'object' && providerAddress ? providerAddress.port : 0}/v1`;

const apiPort = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const picked = typeof address === 'object' && address ? address.port : 0;
    server.close((error) => error ? reject(error) : resolve(picked));
  });
});

const runtime = createApp({ host: '127.0.0.1', port: apiPort, databaseUrl, cookieSecure: false, allowInMemory: false, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub', credentialEncryptionKey: 'postgres-openai-smoke-key' });
await runtime.listen();
const pool = new pg.Pool({ connectionString: databaseUrl });

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${apiPort}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}

try {
  const runRef = `${process.pid}-${Date.now()}`;
  const email = `openai-pg-${runRef}@example.com`;
  const password = 'password-123';
  const displayName = 'OpenAI PG Test';
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': `openai-pg-bootstrap-${runRef}` }, body: JSON.stringify({ email, password, displayName }) });
  let cookie = cookiesFrom(bootstrap.response);
  let csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  if (bootstrap.response.status === 409) {
    const admin = await runtime.store.createAdmin({ email, passwordHash: await hashPassword(password), displayName });
    assert.ok(admin.id);
    const loggedIn = await runtime.auth.login({ email, password });
    cookie = `session_id=${loggedIn.session.id}; csrf_token=${encodeURIComponent(loggedIn.csrfToken)}`;
    csrf = loggedIn.csrfToken;
  } else {
    assert.equal(bootstrap.response.status, 200);
  }
  const account = await request('/api/v1/accounts', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `openai-pg-account-${runRef}` }, body: JSON.stringify({ platform: 'xianyu', sellerRef: `openai-pg-${runRef}`, displayName: 'OpenAI PG Account' }) });
  assert.equal(account.response.status, 201);
  const accountId = account.body.data.id;

  const create = async (role, apiKey, model) => request('/api/v1/settings/openai', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `openai-pg-${role}-${runRef}` }, body: JSON.stringify({ accountId, role, provider: `${role}-provider`, alias: role, baseUrl: providerBaseUrl, model, wireApi: 'responses', timeoutMs: 5000, apiKey }) });
  const primary = await create('primary', 'sk-pg-primary-secret-123456', 'pg-provider-model');
  const backup = await create('backup', 'sk-pg-backup-secret-123456', 'pg-provider-model');
  assert.equal(primary.response.status, 201);
  assert.equal(backup.response.status, 201);
  assert.notEqual(primary.body.data.id, backup.body.data.id);

  const models = await request(`/api/v1/settings/openai/models?accountId=${encodeURIComponent(accountId)}&configId=${encodeURIComponent(primary.body.data.id)}`, { headers: { cookie } });
  assert.equal(models.response.status, 200);
  assert.deepEqual(models.body.data.models, ['pg-provider-model']);

  const rows = await pool.query(`select r.id, r.role, r.version, r.provider, r.alias, v.metadata_json, v.ciphertext
    from (select id, account_id, version, provider, alias, coalesce(metadata_json->>'role', 'primary') as role
      from accounts.credential_refs r join accounts.credential_values v on v.credential_ref_id=r.id
      where r.account_id=$1) r
    join accounts.credential_values v on v.credential_ref_id=r.id
    order by r.role`, [accountId]);
  assert.equal(rows.rowCount, 2);
  assert.deepEqual(rows.rows.map((row) => row.role), ['backup', 'primary']);
  assert.ok(rows.rows.every((row) => String(row.ciphertext).startsWith('v1.')));
  assert.ok(rows.rows.every((row) => !String(row.ciphertext).includes('sk-pg-')));
  assert.equal(rows.rows.find((row) => row.role === 'primary')?.metadata_json.model, 'pg-provider-model');

  const listed = await request(`/api/v1/settings/openai?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.data.items.length, 2);
  assert.equal(JSON.stringify(listed.body).includes('sk-pg-'), false);
  for (const item of listed.body.data.items) {
    assert.equal(item.apiKeyHint.length, item.role === 'primary' ? 'sk-pg-primary-secret-123456'.length : 'sk-pg-backup-secret-123456'.length);
    assert.match(item.apiKeyHint, /^.{4}\*+.{4}$/);
  }

  console.log(JSON.stringify({ database: 'postgres', accountId, configIds: listed.body.data.items.map((item) => item.id), roles: listed.body.data.items.map((item) => item.role).sort(), providerModels: models.body.data.models, ciphertextStored: true, plaintextAbsent: true, apiKeyHintShapeValid: true }, null, 2));
} finally {
  await pool.end();
  await runtime.close();
  await new Promise((resolve) => provider.close(() => resolve(undefined)));
}
