import assert from 'node:assert/strict';
import test from 'node:test';
import { CredentialService } from '../src/services.js';
import { MemoryStore } from '../src/store-memory.js';

async function setup(sellerRef: string) {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'credential-test@example.com', passwordHash: 'hash', displayName: 'Credential test' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef });
  await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=old-seller; _m_h5_tk=old', accessToken: 'old-im-token', deviceId: 'device-1' });
  return { store, admin, account, service: new CredentialService(store, async () => 'audit-1') };
}

test('clears a stale IM access token when a fresh browser cookie replaces credentials', async () => {
  const { store, admin, account, service } = await setup('new-seller');
  const saved = await service.save({
    adminId: admin.id, accountId: account.id, cookieHeader: 'unb=new-seller; _m_h5_tk=fresh',
    clearAccessToken: true, metadata: { loginMethod: 'qr_http' }, requestId: 'req-1', traceId: 'trace-1',
  });
  const credential = await store.getCredential(admin.id, account.id);
  assert.equal(saved.accessToken, undefined);
  assert.equal(credential?.accessToken, undefined);
  assert.equal(credential?.cookieHeader, 'unb=new-seller; _m_h5_tk=fresh');
});

test('preserves the IM access token for MTOP cookie refresh persistence', async () => {
  const { store, admin, account, service } = await setup('old-seller');
  const saved = await service.save({
    adminId: admin.id, accountId: account.id, cookieHeader: 'unb=old-seller; _m_h5_tk=rotated',
    requestId: 'req-1', traceId: 'trace-1',
  });
  const credential = await store.getCredential(admin.id, account.id);
  assert.equal(saved.accessToken, 'old-im-token');
  assert.equal(credential?.accessToken, 'old-im-token');
});
