import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const port = 18180 + (process.pid % 400);
const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
runtime.xianyu.verifyLogin = async () => ({ success: true, accountInvalid: false, cookieHeader: 'unb=real-seller; _m_h5_tk=token_1' });
runtime.xianyu.fetchProfile = async () => ({ success: true, accountInvalid: false, cookieHeader: 'unb=real-seller; _m_h5_tk=token_1', response: { data: { userNick: '真实闲鱼昵称', userId: 'real-seller', avatarUrl: 'https://img.example/avatar.png', shopName: '真实店铺备注' } } });
await runtime.listen();

function cookiesFrom(response) {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; ');
}

async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'onboarding-bootstrap' }, body: JSON.stringify({ email: 'onboarding@example.com', password: 'password-123', displayName: 'Onboarding Test' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  assert.ok(csrf);

  const login = await request('/api/v1/auth/cookie-login', {
    method: 'POST',
    headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'onboarding-cookie-login' },
    body: JSON.stringify({ cookieHeader: 'unb=real-seller; _m_h5_tk=token_1' }),
  });
  assert.equal(login.response.status, 201);
  assert.equal(login.body.data.account.displayName, '真实闲鱼昵称');
  assert.equal(login.body.data.account.remark, '真实店铺备注');
  assert.equal(login.body.data.account.avatarUrl, 'https://img.example/avatar.png');
  assert.equal(login.body.data.session.status, 'succeeded');

  const listed = await request('/api/v1/accounts', { headers: { cookie } });
  assert.equal(listed.body.data.items.length, 1);
  assert.equal(listed.body.data.items[0].sellerRef, 'real-seller');
  assert.equal(listed.body.data.items[0].status, 'connected');
  console.log('onboarding cookie login smoke passed');
} finally {
  await runtime.close();
}
