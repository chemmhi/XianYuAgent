import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryObjectStorage } from '../src/object-storage.js';
import { MemoryStore } from '../src/store-memory.js';
import { XianyuItemDetailService } from '../src/xianyu-item-detail-service.js';

test('persists detail JSON in product attributes and image bytes in object storage refs', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'detail@example.com', passwordHash: 'hash', displayName: 'Detail Admin' });
  const account = await store.createAccount({ platform: 'xianyu', sellerRef: 'seller-1', adminId: admin.id });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, externalProductRef: '1078553391460', title: '旧标题' });
  const storage = new MemoryObjectStorage();
  let fetchCount = 0;
  const xianyu = {
    fetchItemDetail: async () => {
      fetchCount += 1;
      return {
        success: true,
        accountInvalid: false,
        cookieHeader: '',
        response: { data: { itemDO: { itemId: '1078553391460', title: 'PPT Master pptmaster' } } },
        summary: { itemId: '1078553391460', title: 'PPT Master pptmaster', description: '完整描述', priceMinor: 850, imageUrls: ['https://img.example/one.jpg'] },
      };
    },
  } as never;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  try {
    const service = new XianyuItemDetailService(store, xianyu, storage, async () => 'audit-1');
    const first = await service.get({ adminId: admin.id, productId: product.id, refresh: true, requestId: 'req-1', traceId: 'trace-1' });
    assert.equal(first.cached, false);
    assert.equal(first.summary.priceMinor, 850);
    assert.equal(first.assets.length, 1);
    assert.equal(first.assets[0]?.status, 'active');
    assert.equal(storage.objects.size, 1);
    assert.equal(fetchCount, 1);
    const persisted = await store.getProduct(admin.id, product.id);
    assert.equal(persisted?.title, 'PPT Master pptmaster');
    const xianyuAttributes = persisted?.attributes.xianyu as Record<string, unknown>;
    const detail = xianyuAttributes.detail as Record<string, unknown>;
    assert.deepEqual((detail.rawResponse as Record<string, unknown>).data, { itemDO: { itemId: '1078553391460', title: 'PPT Master pptmaster' } });
    assert.equal(Object.prototype.hasOwnProperty.call(detail, 'body'), false);
    const second = await service.get({ adminId: admin.id, productId: product.id, requestId: 'req-2', traceId: 'trace-2' });
    assert.equal(second.cached, true);
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('records source URL and failed asset metadata without storing binary in attributes', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'failed-detail@example.com', passwordHash: 'hash', displayName: 'Detail Admin' });
  const account = await store.createAccount({ platform: 'xianyu', sellerRef: 'seller-2', adminId: admin.id });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, externalProductRef: 'item-2', title: '商品' });
  const storage = new MemoryObjectStorage();
  const xianyu = { fetchItemDetail: async () => ({ success: true, accountInvalid: false, cookieHeader: '', response: { data: {} }, summary: { itemId: 'item-2', imageUrls: ['https://img.example/missing.jpg'] } }) } as never;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('missing', { status: 404 });
  try {
    const service = new XianyuItemDetailService(store, xianyu, storage, async () => 'audit-2');
    const result = await service.get({ adminId: admin.id, productId: product.id, refresh: true, requestId: 'req-3', traceId: 'trace-3' });
    assert.equal(result.assets[0]?.sourceUrl, 'https://img.example/missing.jpg');
    assert.equal(result.assets[0]?.status, 'failed');
    assert.equal(storage.objects.size, 0);
    assert.equal(result.assetUploadErrors.length, 1);
    const cached = await service.get({ adminId: admin.id, productId: product.id, requestId: 'req-4', traceId: 'trace-4' });
    assert.equal(cached.cached, true);
    assert.equal(cached.assetUploadErrors.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects localhost, private, and metadata image targets before download', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'ssrf-detail@example.com', passwordHash: 'hash', displayName: 'Detail Admin' });
  const account = await store.createAccount({ platform: 'xianyu', sellerRef: 'seller-ssrf', adminId: admin.id });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, externalProductRef: 'item-ssrf', title: '商品' });
  const storage = new MemoryObjectStorage();
  const xianyu = { fetchItemDetail: async () => ({ success: true, accountInvalid: false, cookieHeader: '', response: { data: {} }, summary: { itemId: 'item-ssrf', imageUrls: ['http://127.0.0.1/secret', 'http://169.254.169.254/latest/meta-data', 'http://localhost/private'] } }) } as never;
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => { fetchCount += 1; return new Response(Buffer.from([1]), { status: 200, headers: { 'content-type': 'image/jpeg' } }); };
  try {
    const service = new XianyuItemDetailService(store, xianyu, storage, async () => 'audit-ssrf');
    const result = await service.get({ adminId: admin.id, productId: product.id, refresh: true, requestId: 'req-ssrf', traceId: 'trace-ssrf' });
    assert.equal(fetchCount, 0);
    assert.equal(storage.objects.size, 0);
    assert.equal(result.assetUploadErrors.length, 3);
    assert.ok(result.assetUploadErrors.every((entry) => entry.message === 'IMAGE_URL_HOST_UNSAFE'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('archives stale detail assets after a refresh and exposes only current images', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'archive-detail@example.com', passwordHash: 'hash', displayName: 'Detail Admin' });
  const account = await store.createAccount({ platform: 'xianyu', sellerRef: 'seller-archive', adminId: admin.id });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, externalProductRef: 'item-archive', title: '商品' });
  const storage = new MemoryObjectStorage();
  let fetchCount = 0;
  const xianyu = {
    fetchItemDetail: async () => {
      fetchCount += 1;
      const imageUrl = fetchCount === 1 ? 'https://img.example/old.jpg' : 'https://img.example/new.jpg';
      return { success: true, accountInvalid: false, cookieHeader: '', response: { data: {} }, summary: { itemId: 'item-archive', imageUrls: [imageUrl] } };
    },
  } as never;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  try {
    const service = new XianyuItemDetailService(store, xianyu, storage, async () => 'audit-archive');
    await service.get({ adminId: admin.id, productId: product.id, refresh: true, requestId: 'req-archive-1', traceId: 'trace-archive-1' });
    const refreshed = await service.get({ adminId: admin.id, productId: product.id, refresh: true, requestId: 'req-archive-2', traceId: 'trace-archive-2' });
    const persisted = await store.getProduct(admin.id, product.id);
    assert.equal(persisted?.assets?.filter((asset) => asset.status === 'archived').length, 1);
    assert.equal(persisted?.assets?.filter((asset) => asset.status === 'active').length, 1);
    assert.equal(refreshed.images.length, 1);
    assert.equal(refreshed.product.assets?.length, 1);
    assert.equal(refreshed.images[0]?.sourceUrl, 'https://img.example/new.jpg');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
