import assert from 'node:assert/strict';
import pg from 'pg';
import net from 'node:net';
import { createApp } from '../dist/app.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const picked = typeof address === 'object' && address ? address.port : 0;
    server.close((error) => error ? reject(error) : resolve(picked));
  });
});
const runtime = createApp({ host: '127.0.0.1', port, databaseUrl, cookieSecure: false, allowInMemory: false, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub', credentialEncryptionKey: 'postgres-smoke-encryption-key' });
await runtime.listen();
const pool = new pg.Pool({ connectionString: databaseUrl });

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': `credential-pg-bootstrap-${process.pid}` }, body: JSON.stringify({ email: `credential-pg-${process.pid}@example.com`, password: 'password-123', displayName: 'Credential PG Test' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const account = await request('/api/v1/accounts', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `credential-pg-account-${process.pid}` }, body: JSON.stringify({ platform: 'xianyu', sellerRef: `credential-pg-${process.pid}`, displayName: 'Credential PG Account' }) });
  assert.equal(account.response.status, 201);
  const accountId = account.body.data.id;
  const apiKey = 'sk-postgres-secret-123456';
  const created = await request('/api/v1/credentials', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `credential-pg-create-${process.pid}` }, body: JSON.stringify({ accountId, provider: 'openai-compatible', alias: 'primary', apiKey }) });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.data.canReveal, false);
  const stored = await pool.query('select r.id, r.version, v.ciphertext, v.checksum from accounts.credential_refs r join accounts.credential_values v on v.credential_ref_id=r.id where r.id=$1', [created.body.data.id]);
  assert.equal(stored.rowCount, 1);
  const row = stored.rows[0];
  const ciphertext = Buffer.isBuffer(row.ciphertext) ? row.ciphertext.toString('utf8') : String(row.ciphertext);
  assert.notEqual(ciphertext, apiKey);
  assert.ok(ciphertext.startsWith('v1.'));
  assert.equal(row.version, 1);
  assert.equal(row.checksum, created.body.data.fingerprint);
  const listed = await request(`/api/v1/credentials?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  assert.equal(JSON.stringify(listed.body).includes(apiKey), false);
  console.log(JSON.stringify({ database: 'postgres', accountId, credentialId: created.body.data.id, ciphertextStored: true, plaintextAbsent: true, fingerprint: created.body.data.fingerprint }, null, 2));
} finally {
  await pool.end();
  await runtime.close();
}
