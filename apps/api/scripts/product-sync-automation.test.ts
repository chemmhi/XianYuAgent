import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { defaultProductAutomationConfig } from '../src/product-automation.js';
import { mapXianyuProductPage } from '../src/xianyu-product-mapper.js';

test('product sync keeps the product UUID and automation rules when the external id changes shape', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'product-sync-automation@example.com', passwordHash: 'hash', displayName: 'Product Sync' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `product-sync-${Date.now()}` });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, externalProductRef: 'OLD-ID', title: '旧商品', status: 'published' });
  const coupon = await store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: '自动发货', purpose: 'text' });
  const config = {
    ...defaultProductAutomationConfig(),
    paidAutoDelivery: { ...defaultProductAutomationConfig().paidAutoDelivery, enabled: true, couponBatchIds: [coupon.id], autoConfirm: true },
  };
  await store.updateProductAutomation({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config, configDigest: 'before-sync' });

  const result = await store.upsertExternalProduct({
    adminId: admin.id,
    accountId: account.id,
    syncedAt: '2026-09-26T00:00:00.000Z',
    item: { externalProductRef: 'NEW-ID', externalProductRefs: ['NEW-ID', 'OLD-ID'], title: '同步后的商品', priceMinor: 1990, sourcePayloadDigest: 'digest' },
  });

  assert.equal(result.action, 'updated');
  assert.equal(result.product.id, product.id);
  assert.equal(result.product.externalProductRef, 'NEW-ID');
  assert.deepEqual((result.product.attributes.xianyu as Record<string, unknown>).externalProductRefs, ['NEW-ID', 'OLD-ID']);
  const savedAutomation = await store.getProductAutomation(admin.id, product.id);
  assert.ok(savedAutomation);
  assert.equal(savedAutomation.configDigest, 'before-sync');
  assert.equal(savedAutomation.config.paidAutoDelivery.enabled, true);
  assert.deepEqual(savedAutomation.config.paidAutoDelivery.couponBatchIds, [coupon.id]);
  assert.deepEqual((await store.getProduct(admin.id, product.id))?.couponBatches?.map((batch) => batch.id), [coupon.sequenceId]);
});

test('product mapper retains stable ids from all supported card fields', () => {
  const page = mapXianyuProductPage({
    data: {
      cardList: [{
        cardData: {
          id: 'CARD-ID',
          itemId: 'CARD-ITEM-ID',
          detailParams: { itemId: 'DETAIL-ID' },
          itemDO: { itemId: 'ITEMDO-ID', id: 'ITEMDO-LEGACY-ID' },
          title: '商品',
        },
      }],
    },
  }, 1, 20);

  assert.equal(page.items[0]?.externalProductRef, 'DETAIL-ID');
  assert.deepEqual(page.items[0]?.externalProductRefs, ['DETAIL-ID', 'CARD-ID', 'CARD-ITEM-ID', 'ITEMDO-ID', 'ITEMDO-LEGACY-ID']);
});
