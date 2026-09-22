import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { XianyuItemDetailService } from '../dist/xianyu-item-detail-service.js';
import { hashPassword } from '../dist/security.js';

const port = 18580 + (process.pid % 300);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const runtime = createApp({
  host: '127.0.0.1', port, databaseUrl, redisUrl: undefined, cookieSecure: false, allowInMemory: false,
  sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub',
  objectStorageEndpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? 'http://127.0.0.1:19002',
  objectStoragePublicEndpoint: process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT ?? 'http://127.0.0.1:19002',
  objectStorageAccessKey: process.env.OBJECT_STORAGE_ACCESS_KEY ?? 'xianyu',
  objectStorageSecretKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? 'xianyu_dev_only',
  objectStorageBucket: process.env.OBJECT_STORAGE_BUCKET ?? `xianyu-assets-${runId}`,
  objectStorageRegion: 'us-east-1',
});
await runtime.listen();

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}

const originalFetch = globalThis.fetch;
let liveCalls = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('https://img.example/')) return new Response(Buffer.from([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  return originalFetch(input, init);
};

try {
  const admin = await runtime.store.createAdmin({ email: `detail-pg-${runId}@example.com`, passwordHash: await hashPassword('password-123'), displayName: 'Detail PG' });
  const login = await runtime.auth.login({ email: admin.email, password: 'password-123' });
  const adminId = admin.id;
  const cookie = `session_id=${login.session.id}; csrf_token=${encodeURIComponent(login.csrfToken)}`;
  const csrf = login.csrfToken;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `detail-pg-${runId}` });
  const product = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: '1078553391460', title: '占位标题', status: 'published' });
  runtime.xianyuItemDetail = new XianyuItemDetailService(runtime.store, {
    async fetchItemDetail() {
      liveCalls += 1;
      const imageUrl = liveCalls === 1 ? 'https://img.example/pg.jpg' : 'https://img.example/pg-new.jpg';
      return { success: true, accountInvalid: false, cookieHeader: '', response: { data: { itemDO: { itemId: '1078553391460' } } }, summary: { itemId: '1078553391460', title: 'PPT Master pptmaster', description: 'PG 详情', priceMinor: 850, browseCount: 321, wantCount: 33, imageUrls: [imageUrl] } };
    },
  }, runtime.objectStorage, async () => 'pg-detail-audit');

  const first = await request(`/api/v1/products/${product.id}/detail`, { headers: { cookie } });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.data.cached, false);
  assert.equal(first.body.data.assets.length, 1);
  assert.equal(liveCalls, 1);
  const second = await request(`/api/v1/products/${product.id}/detail`, { headers: { cookie } });
  assert.equal(second.response.status, 200);
  assert.equal(second.body.data.cached, true);
  assert.equal(liveCalls, 1);
  const persisted = await runtime.store.getProduct(adminId, product.id);
  assert.equal(persisted?.title, 'PPT Master pptmaster');
  assert.equal(persisted?.assets?.length, 1);
  assert.equal(persisted?.assets?.[0]?.sourceUrl, 'https://img.example/pg.jpg');
  assert.equal(persisted?.attributes.xianyu?.detail?.rawResponse?.data?.itemDO?.itemId, '1078553391460');
  await runtime.store.upsertExternalProduct({
    adminId,
    accountId: account.id,
    item: { externalProductRef: '1078553391460', title: '同步后标题', description: '同步描述', priceMinor: 999, imageUrls: ['https://img.example/pg-sync.jpg'], attributes: { externalStatus: 'onsale' }, sourcePayloadDigest: 'sync-digest' },
    syncedAt: new Date().toISOString(),
  });
  const preserved = await runtime.store.getProduct(adminId, product.id);
  assert.equal(preserved?.title, '同步后标题');
  assert.equal(preserved?.attributes.xianyu?.detail?.rawResponse?.data?.itemDO?.itemId, '1078553391460');
  const refreshed = await request(`/api/v1/products/${product.id}/detail/refresh`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `detail-pg-refresh-${runId}` } });
  assert.equal(refreshed.response.status, 200);
  assert.equal(liveCalls, 2);
  assert.equal(refreshed.body.data.images.length, 1);
  const afterRefresh = await runtime.store.getProduct(adminId, product.id);
  assert.equal(afterRefresh?.assets?.filter((asset) => asset.status === 'archived').length, 1);
  assert.equal(afterRefresh?.assets?.filter((asset) => asset.status === 'active').length, 1);
  console.log('xianyu item detail postgres/object-storage smoke passed');
} finally {
  globalThis.fetch = originalFetch;
  await runtime.close();
}
