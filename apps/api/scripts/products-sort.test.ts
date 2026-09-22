import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';

test('defaults to the remote Xianyu list order and keeps explicit time sorting', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'products-sort@example.com', passwordHash: 'hash', displayName: 'Products Sort Test' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'products-sort-seller' });

  await store.upsertExternalProduct({
    adminId: admin.id,
    accountId: account.id,
    syncedAt: '2026-09-22T12:00:00.000Z',
    item: { externalProductRef: 'ITEM-NEW', title: '远端新商品', xianyuUpdatedAt: '2026-09-22T10:00:00.000Z', xianyuListRank: 2, imageUrls: [], attributes: {}, sourcePayloadDigest: 'new' },
  });
  await store.upsertExternalProduct({
    adminId: admin.id,
    accountId: account.id,
    syncedAt: '2026-09-22T12:01:00.000Z',
    item: { externalProductRef: 'ITEM-OLD', title: '远端旧商品', xianyuUpdatedAt: '2026-09-20T10:00:00.000Z', xianyuListRank: 1, imageUrls: [], attributes: {}, sourcePayloadDigest: 'old' },
  });
  await store.createProduct({ adminId: admin.id, accountId: account.id, externalProductRef: 'ITEM-NO-REMOTE-TIME', title: '缺少闲鱼时间', status: 'published' });

  const result = await store.listProducts(admin.id, { accountId: account.id });
  assert.deepEqual(result.items.map((item) => item.externalProductRef), ['ITEM-OLD', 'ITEM-NEW', 'ITEM-NO-REMOTE-TIME']);

  const byRemoteTime = await store.listProducts(admin.id, { accountId: account.id, sortBy: 'updatedAt', sortOrder: 'desc' });
  assert.deepEqual(byRemoteTime.items.map((item) => item.externalProductRef), ['ITEM-NEW', 'ITEM-OLD', 'ITEM-NO-REMOTE-TIME']);
});

test('clears stale Xianyu list ranks before a fresh sync', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'products-rank-reset@example.com', passwordHash: 'hash', displayName: 'Products Rank Reset Test' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'products-rank-reset-seller' });
  await store.upsertExternalProduct({ adminId: admin.id, accountId: account.id, syncedAt: '2026-09-22T12:00:00.000Z', item: { externalProductRef: 'ITEM-STALE', title: '旧商品', xianyuListRank: 1, imageUrls: [], attributes: {}, sourcePayloadDigest: 'stale' } });
  await store.resetXianyuListRanks(admin.id, account.id);
  const result = await store.listProducts(admin.id, { accountId: account.id });
  assert.equal(result.items[0]?.externalProductRef, 'ITEM-STALE');
  assert.equal(result.items[0]?.xianyuListRank, undefined);
});
