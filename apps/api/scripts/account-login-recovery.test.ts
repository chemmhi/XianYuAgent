import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountService } from '../src/services.js';
import { MemoryStore } from '../src/store-memory.js';

test('QR login reuses and restores a previously disabled account owned by the same admin', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'qr-recovery@example.com', passwordHash: 'hash', displayName: 'QR Recovery' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-recovery' });
  const deleted = await store.deleteAccount(admin.id, account.id);
  assert.equal(deleted?.status, 'disabled');
  assert.equal(await store.hasAccountScope(admin.id, account.id), false);

  const service = new AccountService(store, async () => 'audit-id');
  const session = await service.createLoginSession({ adminId: admin.id, accountId: account.id, loginMethod: 'qr', requestId: 'qr-session', traceId: 'qr-session' });
  assert.equal(session.accountId, account.id);
  assert.equal(session.status, 'waiting');
  const restored = await service.resolveForLogin({
    adminId: admin.id,
    platform: 'xianyu',
    sellerRef: account.sellerRef,
    requestId: 'qr-recovery',
    traceId: 'qr-recovery',
  });

  assert.equal(restored.id, account.id);
  assert.equal(restored.status, 'pending');
  assert.equal(await store.hasAccountScope(admin.id, account.id), true);
});
