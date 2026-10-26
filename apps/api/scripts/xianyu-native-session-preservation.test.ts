import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createBrowserMtopTransport } from '../src/xianyu-browser-mtop.js';
import { fetchXianyuBrowserImToken } from '../src/xianyu-browser-im-token.js';
import { XianyuImService } from '../src/xianyu-im-service.js';
import { MemoryStore } from '../src/store-memory.js';
import { cookieSnapshotFromMetadata, metadataWithCookieSnapshot } from '../src/xianyu-cookie-jar.js';
import type { XianyuVerificationContext, XianyuVerificationPage } from '../src/xianyu-browser-port.js';
import type { AccountRecord, CredentialRecord } from '../src/domain.js';

test('native retry preserves the issued context tag and re-signs the same request after x5sec arrives', async () => {
  let jar = [{ name: '_m_h5_tk', value: 'stable_suffix', domain: '.goofish.com', path: '/' },
    { name: 'x5sectag', value: 'issued-context', domain: 'h5api.m.goofish.com', path: '/' }];
  const requests: Array<{ data: string; cookie: string; sign: string; time: string }> = [];
  const context = { cookies: async () => structuredClone(jar), addCookies: async (updates: typeof jar) => {
    for (const update of updates) jar = jar.filter(c => c.name !== update.name || c.domain !== update.domain).concat(update);
  } } as unknown as XianyuVerificationContext;
  const page = { url: () => 'https://www.goofish.com/robots.txt', evaluate: async (fn: Function, arg?: any) => {
    if (!arg) return fn.toString().includes('readyState') ? true : jar.filter(c => c.value).map(c => `${c.name}=${c.value}`).join('; ');
    const u = new URL(arg.url); const data = new URLSearchParams(arg.body).get('data')!;
    const cookie = jar.filter(c => c.value).map(c => `${c.name}=${c.value}`).join('; ');
    requests.push({ data, cookie, sign: u.searchParams.get('sign')!, time: u.searchParams.get('t')! });
    return { status: 200, payload: cookie.includes('x5sec=passed') && cookie.includes('x5sectag=issued-context')
      ? { ret: ['SUCCESS::ok'], data: { restored: true } }
      : { ret: ['FAIL_SYS_USER_VALIDATE::verify', 'RGV587_ERROR::verify'], data: { url: 'https://h5api.m.goofish.com/h5/mtop.test.read/1.0/_____tmd_____/punish' } } };
  } } as unknown as XianyuVerificationPage;
  const call = createBrowserMtopTransport(context, page, async () => {
    jar.push({ name: 'x5sec', value: 'passed', domain: 'h5api.m.goofish.com', path: '/' });
  });
  assert.deepEqual(await call({ api: 'mtop.test.read', version: '1.0', data: { deviceId: 'original-device' }, referer: 'https://www.goofish.com/im' }), { restored: true });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].data, requests[1].data);
  assert.notEqual(requests[0].time, requests[1].time);
  for (const request of requests) assert.equal(request.sign, createHash('md5').update(`stable&${request.time}&34839810&${request.data}`).digest('hex'));
});

test('native Token payload identity cannot replace a missing successful loginuser identity', async () => {
  const context = { cookies: async () => [] } as unknown as XianyuVerificationContext;
  const page = { url: () => 'https://www.goofish.com/robots.txt', evaluate: async (_fn: Function, arg?: any) => arg
    ? { status: 200, payload: { ret: ['SUCCESS::ok'], data: arg.url.includes('login.token') ? { accessToken: 'native-token', userId: 'seller' } : {} } }
    : '_m_h5_tk=stable_suffix' } as unknown as XianyuVerificationPage;
  await assert.rejects(fetchXianyuBrowserImToken(context, page, { deviceId: 'original-device', expectedUserId: 'seller' }), /IDENTITY_MISMATCH/);
});

test('IM recovery passes the request-local scoped snapshot intact and retains final native context cookies', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'native-scope@example.com', passwordHash: 'test', displayName: 'Scope' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller' });
  const expected = [{ name: 'unb', value: 'seller', domain: '.goofish.com', path: '/' },
    { name: 'x5sectag', value: 'new-context', domain: 'h5api.m.goofish.com', path: '/h5', secure: true, sameSite: 'None', partitionKey: 'https://goofish.com', _crHasCrossSiteAncestor: false },
    { name: 'cookie2', value: 'http-only', domain: 'h5api.m.goofish.com', path: '/', httpOnly: true, secure: true }];
  const credential = await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=seller', deviceId: 'device', metadata: {} });
  const final = [...expected, { name: 'x5sec', value: 'passed', domain: 'h5api.m.goofish.com', path: '/', secure: true }];
  const buffered = { ...structuredClone(credential), metadata: metadataWithCookieSnapshot({}, expected) };
  const mtop = { createCredentialSession: () => ({ getCredential: () => buffered, client: { fetchImToken: async () => ({ success: false,
    errorCode: 'ACCOUNT_VALIDATION_REQUIRED', verificationUrl: 'https://h5api.m.goofish.com/h5/mtop.test.read/1.0/_____tmd_____/punish', cookieHeader: 'unb=seller; x5sectag=new-context; cookie2=http-only' }) } }) };
  let passedSnapshot: unknown;
  const browser = { enabled: true, waitForCompletion: async (input: any) => {
    passedSnapshot = input.initialCookieSnapshot;
    return { finalUrl: 'https://www.goofish.com/im', cookieSnapshot: final, imToken: { accessToken: 'native-token', deviceId: 'device', userId: 'seller' } };
  } };
  const service = new XianyuImService(store, mtop as never, {} as never, undefined, undefined, browser as never);
  try {
    await (service as unknown as { refreshCredential(a: string, b: AccountRecord, c: CredentialRecord): Promise<CredentialRecord> }).refreshCredential(admin.id, account, credential);
    assert.deepEqual(passedSnapshot, expected);
    assert.deepEqual(cookieSnapshotFromMetadata((await store.getCredential(admin.id, account.id))?.metadata), final);
  } finally { await service.close(); }
});
