import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';

test('sorts synced products by Xianyu update time instead of local write time', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'products-sort@example.com', passwordHash: 'hash', displayName: 'Products Sort Test' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'products-sort-seller' });

  await store.upsertExternalProduct({
    adminId: admin.id,
    accountId: account.id,
    syncedAt: '2026-09-22T12:00:00.000Z',
    item: { externalProductRef: 'ITEM-NEW', title: '远端新商品', xianyuUpdatedAt: '2026-09-22T10:00:00.000Z', imageUrls: [], attributes: {}, sourcePayloadDigest: 'new' },
  });
  await store.upsertExternalProduct({
    adminId: admin.id,
    accountId: account.id,
    syncedAt: '2026-09-22T12:01:00.000Z',
    item: { externalProductRef: 'ITEM-OLD', title: '远端旧商品', xianyuUpdatedAt: '2026-09-20T10:00:00.000Z', imageUrls: [], attributes: {}, sourcePayloadDigest: 'old' },
  });
  await store.createProduct({ adminId: admin.id, accountId: account.id, externalProductRef: 'ITEM-NO-REMOTE-TIME', title: '缺少闲鱼时间', status: 'published' });

  const result = await store.listProducts(admin.id, { accountId: account.id });
  assert.deepEqual(result.items.map((item) => item.externalProductRef), ['ITEM-NEW', 'ITEM-OLD', 'ITEM-NO-REMOTE-TIME']);
});
