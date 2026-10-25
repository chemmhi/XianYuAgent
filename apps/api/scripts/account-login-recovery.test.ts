import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountService } from '../src/services.js';
import { MemoryStore } from '../src/store-memory.js';

test('QR login creates a fresh account after permanent deletion', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'qr-recovery@example.com', passwordHash: 'hash', displayName: 'QR Recovery' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-recovery' });
  const deleted = await store.deleteAccount(admin.id, account.id);
  assert.equal(deleted?.status, 'disabled');
  assert.equal(await store.hasAccountScope(admin.id, account.id), false);

  const service = new AccountService(store, async () => 'audit-id');
  await assert.rejects(() => service.createLoginSession({ adminId: admin.id, accountId: account.id, loginMethod: 'qr', requestId: 'old', traceId: 'old' }), { code: 'NOT_FOUND' });
  const restored = await service.resolveForLogin({
    adminId: admin.id,
    platform: 'xianyu',
    sellerRef: account.sellerRef,
    requestId: 'qr-recovery',
    traceId: 'qr-recovery',
  });

  assert.notEqual(restored.id, account.id);
  assert.equal(restored.status, 'pending');
  assert.equal(await store.hasAccountScope(admin.id, restored.id), true);
});
