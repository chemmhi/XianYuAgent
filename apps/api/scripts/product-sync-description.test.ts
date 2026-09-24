import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store-memory.js';

test('preserves cached Xianyu detail description when list sync omits description', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'description-regression@example.com', passwordHash: 'hash', displayName: 'Description Regression' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'description-regression-seller' });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, externalProductRef: 'ITEM-DESCRIPTION', title: '详情描述商品', status: 'published' });
  const description = '闲鱼详情接口返回的完整商品描述。';

  await store.persistXianyuItemDetail({
    adminId: admin.id,
    productId: product.id,
    itemId: 'ITEM-DESCRIPTION',
    summary: { itemId: 'ITEM-DESCRIPTION', title: product.title, description },
    rawResponse: { data: { itemDO: { itemId: 'ITEM-DESCRIPTION', desc: description } } },
    imageUrls: [],
    syncedAt: '2026-09-24T02:00:00.000Z',
    sourcePayloadDigest: 'detail-digest',
    assets: [],
  });

  await store.upsertExternalProduct({
    adminId: admin.id,
    accountId: account.id,
    item: { externalProductRef: 'ITEM-DESCRIPTION', title: product.title, imageUrls: [], attributes: {}, sourcePayloadDigest: 'list-digest' },
    syncedAt: '2026-09-24T03:00:00.000Z',
  });

  const reread = await store.getProduct(admin.id, product.id);
  assert.equal(reread?.description, description);
  const projected = await store.listAutoReplyProducts(admin.id, { accountId: account.id, productId: product.id, limit: 1 });
  assert.equal(projected.items[0]?.description, description);
});
