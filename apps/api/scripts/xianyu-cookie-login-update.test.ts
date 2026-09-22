import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';

test('Cookie reauthorization updates the explicitly selected account', async () => {
  const runtime = createApp(loadConfig({
    HOST: '127.0.0.1',
    PORT: '0',
    DATABASE_URL: '',
    REDIS_URL: '',
    ALLOW_IN_MEMORY: 'true',
    COOKIE_SECURE: 'false',
    XIANYU_QR_MODE: 'stub',
    AGENT_RUNTIME: 'in-process',
  }));
  await runtime.listen();
  try {
    const address = runtime.server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const bootstrap = await requestJson(`${base}/api/v1/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Idempotency-Key': 'cookie-update-bootstrap' },
      body: JSON.stringify({ email: 'cookie-update@example.com', password: 'password-123', displayName: 'Cookie Update' }),
    });
    assert.equal(bootstrap.status, 200);
    const sessionCookie = cookiesFrom(bootstrap.headers);
    const csrfToken = decodeURIComponent(sessionCookie.match(/(?:^|; )csrf_token=([^;]+)/)?.[1] ?? '');
    const adminId = String(bootstrap.body.data.profile.id);
    const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'old-seller', displayName: '旧账号' });
    await runtime.store.upsertCredential({ adminId, accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=old-seller; _m_h5_tk=old_token', accessToken: 'old-im-token', deviceId: 'device-old', metadata: {} });

    runtime.xianyu.verifyLogin = async () => ({ success: true, accountInvalid: false, cookieHeader: 'unb=new-seller; _m_h5_tk=fresh_token' });
    runtime.xianyu.fetchProfile = async () => ({ success: true, accountInvalid: false, cookieHeader: 'unb=new-seller; _m_h5_tk=fresh_token', response: { data: { userNick: '更新后的账号', userId: 'new-seller' } } });

    const updated = await requestJson(`${base}/api/v1/auth/cookie-login`, {
      method: 'POST',
      headers: {
        cookie: sessionCookie,
        'X-CSRF-Token': csrfToken,
        'Idempotency-Key': 'cookie-update-existing-account',
      },
      body: JSON.stringify({ accountId: account.id, cookieHeader: 'unb=new-seller; _m_h5_tk=fresh_token' }),
    });
    assert.equal(updated.status, 201);
    assert.equal(updated.body.data.account.id, account.id);

    const accounts = await runtime.store.listAccounts(adminId, { page: 1, pageSize: 100 });
    assert.equal(accounts.total, 1);
    assert.equal(accounts.items[0]?.id, account.id);
    assert.equal(accounts.items[0]?.sellerRef, 'new-seller');
    const credential = await runtime.store.getCredential(adminId, account.id);
    assert.equal(credential?.cookieHeader, 'unb=new-seller; _m_h5_tk=fresh_token');
    assert.equal(credential?.accessToken, undefined);
  } finally {
    await runtime.close();
  }
});

function cookiesFrom(headers: Headers): string {
  const values = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  return values.map((value) => value.split(';', 1)[0]).join('; ');
}

async function requestJson(url: string, options: RequestInit): Promise<{ status: number; headers: Headers; body: any }> {
  const response = await fetch(url, options);
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : undefined };
}
