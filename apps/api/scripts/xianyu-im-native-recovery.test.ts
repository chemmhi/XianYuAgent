import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { XianyuImService } from '../src/xianyu-im-service.js';
import { cookieSnapshotFromMetadata, metadataWithCookieSnapshot } from '../src/xianyu-cookie-jar.js';
import type { AccountRecord, CredentialRecord } from '../src/domain.js';

async function fixture() {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'native-recovery@example.com', passwordHash: 'test', displayName: 'Recovery' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-1' });
  const credential = await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu',
    cookieHeader: 'unb=seller-1; _m_h5_tk=old_suffix', deviceId: 'device-1', metadata: { loginMethod: 'qr_http' } });
  let httpCalls = 0;
  const mtop = { fetchImToken: async () => {
    httpCalls += 1;
    return { success: false, accountInvalid: true, errorCode: 'ACCOUNT_VALIDATION_REQUIRED',
      verificationUrl: 'https://www.goofish.com/punish', cookieHeader: credential.cookieHeader };
  } };
  const snapshot = [
    { name: '_m_h5_tk', value: 'taobao-legacy', domain: '.taobao.com', path: '/' },
    { name: 'crossSiteOnly', value: 'crosssite', domain: '.goofish.com', path: '/',
      partitionKey: 'https://goofish.com', _crHasCrossSiteAncestor: true },
    { name: 'unb', value: 'seller-1', domain: '.goofish.com', path: '/' },
    { name: '_m_h5_tk', value: 'native_suffix', domain: '.goofish.com', path: '/', secure: true,
      sameSite: 'None', partitionKey: 'https://goofish.com', _crHasCrossSiteAncestor: false },
    { name: 'cookie2', value: 'protected', domain: '.goofish.com', path: '/', httpOnly: true, secure: true },
    { name: 'x5sec', value: 'passed', domain: '.goofish.com', path: '/' },
  ];
  const result = { finalUrl: 'https://www.goofish.com/im', cookieSnapshot: snapshot,
    imToken: { accessToken: 'native-access', deviceId: 'device-1', userId: 'seller-1' } };
  const browser = { enabled: true, waitForCompletion: async (input: { imTokenRequest?: { deviceId: string; expectedUserId: string } }) => {
    assert.deepEqual(input.imTokenRequest, { deviceId: 'device-1', expectedUserId: 'seller-1' });
    return result;
  } };
  const service = new XianyuImService(store, mtop as never, {} as never, undefined, undefined, browser as never);
  const refresh = () => (service as unknown as {
    refreshCredential(adminId: string, account: AccountRecord, credential: CredentialRecord): Promise<CredentialRecord>;
  }).refreshCredential(admin.id, account, credential);
  return { store, admin, account, credential, result, refresh, httpCalls: () => httpCalls };
}

test('native browser recovery persists token, device and partitioned cookies through the production store', async () => {
  const f = await fixture();
  const refreshed = await f.refresh();
  const saved = await f.store.getCredential(f.admin.id, f.account.id);
  assert.equal(refreshed.accessToken, 'native-access');
  assert.equal(saved?.accessToken, 'native-access');
  assert.equal(saved?.deviceId, 'device-1');
  assert.equal(saved?.metadata?.loginMethod, 'qr_http');
  assert.deepEqual(cookieSnapshotFromMetadata(saved?.metadata), f.result.cookieSnapshot);
  assert.match(saved?.cookieHeader ?? '', /cookie2=protected/);
  assert.match(saved?.cookieHeader ?? '', /_m_h5_tk=native_suffix/);
  assert.doesNotMatch(saved?.cookieHeader ?? '', /taobao-legacy|crosssite|old_suffix/);
  assert.equal(f.httpCalls(), 1, 'must use the native token without another server HTTP challenge');
});

test('native recovery propagates database write failure and keeps the previous credential', async () => {
  const f = await fixture();
  const writeFailure = new Error('database unavailable');
  f.store.upsertCredential = async () => { throw writeFailure; };
  await assert.rejects(f.refresh, error => error === writeFailure);
  assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.cookieHeader, f.credential.cookieHeader);
});

test('native recovery refuses credentials for a different account or device', async () => {
  for (const patch of [{ userId: 'another-seller' }, { deviceId: 'another-device' }, { accessToken: '' }]) {
    const f = await fixture();
    Object.assign(f.result.imToken, patch);
    await assert.rejects(f.refresh, (error: unknown) => (error as { code?: string }).code === 'XIANYU_BROWSER_IM_IDENTITY_MISMATCH');
    assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.cookieHeader, f.credential.cookieHeader);
  }
});

test('ordinary token refresh retains the cookie snapshot most recently saved by MTOP', async () => {
  const f = await fixture();
  const metadata = metadataWithCookieSnapshot({ loginMethod: 'qr_http' }, f.result.cookieSnapshot);
  const service = new XianyuImService(f.store, { fetchImToken: async () => {
    await f.store.upsertCredential({ adminId: f.admin.id, accountId: f.account.id, platform: 'xianyu',
      cookieHeader: 'unb=seller-1; _m_h5_tk=native_suffix', metadata });
    return { success: true, accessToken: 'http-access', cookieHeader: 'unb=seller-1; _m_h5_tk=native_suffix' };
  } } as never, {} as never);
  await (service as unknown as {
    refreshCredential(adminId: string, account: AccountRecord, credential: CredentialRecord): Promise<CredentialRecord>;
  }).refreshCredential(f.admin.id, f.account, structuredClone(f.credential));
  assert.deepEqual((await f.store.getCredential(f.admin.id, f.account.id))?.metadata, metadata);
});

test('native recovery does not replace stored credentials with an empty browser cookie snapshot', async () => {
  const f = await fixture();
  f.result.cookieSnapshot = [];
  await assert.rejects(f.refresh, (error: unknown) => (error as { code?: string }).code === 'XIANYU_BROWSER_IM_IDENTITY_MISMATCH');
  assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.cookieHeader, f.credential.cookieHeader);
});
