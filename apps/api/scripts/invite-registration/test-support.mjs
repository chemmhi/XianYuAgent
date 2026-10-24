import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.ts';
import { loadConfig } from '../../src/config.ts';

export async function testDatabase() {
  const url = new URL(process.env.INVITE_TEST_DATABASE_URL ?? 'postgres://xianyu:invite_test_only@127.0.0.1:55434/invite_test');
  const owner = new pg.Pool({ connectionString: url.href });
  const name = 'invite_' + randomUUID().replaceAll('-', '');
  await owner.query('CREATE DATABASE ' + name);
  url.pathname = '/' + name;
  const pool = new pg.Pool({ connectionString: url.href });
  try {
    const dir = new URL('../../migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) await pool.query(await readFile(new URL(file, dir), 'utf8'));
    return { pool, url: url.href, async close() { await pool.end(); await owner.query('DROP DATABASE ' + name + ' WITH (FORCE)'); await owner.end(); } };
  } catch (error) { await pool.end(); await owner.query('DROP DATABASE ' + name + ' WITH (FORCE)'); await owner.end(); throw error; }
}
export async function fixture(kind = 'memory') {
  const db = kind === 'postgres' ? await testDatabase() : undefined;
  const config = loadConfig({ HOST: '127.0.0.1', PORT: '0', ALLOW_IN_MEMORY: String(!db), DATABASE_URL: db?.url ?? '', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub', REDIS_URL: '', XIANYU_VERIFICATION_BROWSER_MODE: 'disabled', MODEL_PROVIDER_FAILOVER_V2: 'false', CREDENTIAL_ENCRYPTION_KEY: 'invite-test-encryption-key-32-chars' });
  const runtime = createApp(config);
  await runtime.listen();
  const origin = 'http://127.0.0.1:' + runtime.server.address().port;
  async function request(path, { cookie, csrf, key, method = 'GET', body } = {}) {
    const response = await fetch(origin + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(key ? { 'idempotency-key': key } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json(), cookie: (response.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0]).join('; ') };
  }
  async function actor(email, role = 'admin') {
    const { hashPassword } = await import('../../src/security.ts');
    const record = await runtime.store.createAdmin({ email, passwordHash: await hashPassword('password-123'), displayName: email });
    if (db) await db.pool.query('update auth.admins set role=$1 where id=$2', [role, record.id]);
    else record.role = role;
    const logged = await runtime.auth.login({ email, password: 'password-123' });
    return { id: record.id, cookie: 'session_id=' + logged.session.id + '; csrf_token=' + logged.csrfToken, csrf: logged.csrfToken };
  }
  return { runtime, db, origin, request, actor, async close() { await runtime.close(); await db?.close(); } };
}
