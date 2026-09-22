import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const port = 18480 + (process.pid % 400);
const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
await runtime.listen();

function cookiesFrom(response) {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; ');
}

async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'product-sync-bootstrap' }, body: JSON.stringify({ email: 'product-sync@example.com', password: 'password-123', displayName: 'Product Sync Test' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const adminId = bootstrap.body.data.profile.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'sync-seller' });
  const localDraft = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: 'ITEM-LOCAL', title: '本地草稿', status: 'draft' });

  const remoteItems = [
    { externalProductRef: 'ITEM-LOCAL', title: '远端同名商品', priceMinor: 1990, categoryCode: 'digital', imageUrls: ['https://img.example/1.jpg'], attributes: { auctionType: 'fixed' }, sourcePayloadDigest: 'digest-local' },
    { externalProductRef: 'ITEM-REMOTE', title: '远端商品', description: '从闲鱼同步', priceMinor: 2990, categoryCode: 'digital', detailUrl: 'https://www.goofish.com/item?id=ITEM-REMOTE', imageUrls: ['https://img.example/2.jpg'], attributes: { itemStatus: 1 }, sourcePayloadDigest: 'digest-remote' },
  ];
  runtime.xianyu.fetchItemsAll = async () => ({ pages: [{ success: true, accountInvalid: false, cookieHeader: '', items: remoteItems, pageNumber: 1, pageSize: 20, totalCount: 2, totalPages: 1, hasMore: false }], items: remoteItems, hasMore: false });

  const synced = await request('/api/v1/products/sync', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'product-sync-1' }, body: JSON.stringify({ accountId: account.id, pageSize: 20, maxPages: 2 }) });
  assert.equal(synced.response.status, 200);
  assert.equal(synced.body.data.fetchedCount, 2);
  assert.equal(synced.body.data.createdCount, 1);
  assert.equal(synced.body.data.updatedCount, 0);
  assert.equal(synced.body.data.skippedLocalDraftCount, 1);
  const remote = (await runtime.store.listProducts(adminId, { accountId: account.id })).items.find((item) => item.externalProductRef === 'ITEM-REMOTE');
  assert.ok(remote);
  assert.equal(remote.source, 'xianyu');
  assert.equal(remote.priceMinor, 2990);
  await runtime.store.persistXianyuItemDetail({
    adminId,
    productId: remote.id,
    itemId: 'ITEM-REMOTE',
    summary: { itemId: 'ITEM-REMOTE', title: '详情标题', description: '详情正文' },
    rawResponse: { data: { itemDO: { itemId: 'ITEM-REMOTE', title: '详情标题' } } },
    imageUrls: [],
    syncedAt: '2026-09-22T03:00:00.000Z',
    sourcePayloadDigest: 'detail-digest',
    assets: [],
  });
  const localAfter = await runtime.store.getProduct(adminId, localDraft.id);
  assert.equal(localAfter?.title, '本地草稿');
  assert.equal(localAfter?.source, 'local');

  remoteItems[1].title = '远端商品已更新';
  const replayed = await request('/api/v1/products/sync', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'product-sync-2' }, body: JSON.stringify({ accountId: account.id }) });
  assert.equal(replayed.response.status, 200);
  assert.equal(replayed.body.data.updatedCount, 1);
  const remoteAfterReplay = await runtime.store.getProduct(adminId, remote.id);
  assert.equal(remoteAfterReplay?.title, '远端商品已更新');
  assert.equal(remoteAfterReplay?.attributes.xianyu?.detail?.summary?.title, '详情标题');
  assert.equal(remoteAfterReplay?.attributes.xianyu?.detail?.rawResponse?.data?.itemDO?.itemId, 'ITEM-REMOTE');

  const replayedIdempotency = await request('/api/v1/products/sync', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'product-sync-2' }, body: JSON.stringify({ accountId: account.id }) });
  assert.equal(replayedIdempotency.response.status, 200);
  assert.equal(replayedIdempotency.body.data.syncRunId, replayed.body.data.syncRunId);

  console.log('products sync smoke passed');
} finally {
  await runtime.close();
}
