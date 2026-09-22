import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { XianyuItemDetailService } from '../dist/xianyu-item-detail-service.js';

const port = 18480 + (process.pid % 300);
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

const originalFetch = globalThis.fetch;
let liveCalls = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('https://img.example/')) return new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  return originalFetch(input, init);
};

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'detail-route-bootstrap' }, body: JSON.stringify({ email: 'detail-route@example.com', password: 'password-123', displayName: 'Detail Route' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const adminId = bootstrap.body.data.profile.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'detail-route-seller' });
  const product = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: '1078553391460', title: '占位标题', status: 'published' });

  const detailService = new XianyuItemDetailService(runtime.store, {
    async fetchItemDetail() {
      liveCalls += 1;
      return {
        success: true,
        accountInvalid: false,
        cookieHeader: '',
        response: { data: { itemDO: { itemId: '1078553391460', title: 'PPT Master pptmaster', browseCnt: 315 } } },
        summary: { itemId: '1078553391460', title: 'PPT Master pptmaster', description: '详情正文', priceText: '8.50', priceMinor: 850, browseCount: 315, wantCount: 33, imageUrls: ['https://img.example/hero.jpg'] },
      };
    },
  }, runtime.objectStorage, async () => 'detail-route-audit');
  runtime.xianyuItemDetail = detailService;

  const first = await request(`/api/v1/products/${product.id}/xianyu-detail`, { headers: { cookie } });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.data.cached, false);
  assert.equal(first.body.data.summary.title, 'PPT Master pptmaster');
  assert.equal(first.body.data.assets.length, 1);
  assert.equal(liveCalls, 1);

  const cached = await request(`/api/v1/products/${product.id}/xianyu-detail`, { headers: { cookie } });
  assert.equal(cached.response.status, 200);
  assert.equal(cached.body.data.cached, true);
  assert.equal(cached.body.data.summary.browseCount, 315);
  assert.equal(liveCalls, 1);

  const refreshed = await request(`/api/v1/products/${product.id}/xianyu-detail`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'detail-route-refresh-1' } });
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.body.data.cached, false);
  assert.equal(liveCalls, 2);

  const persisted = await runtime.store.getProduct(adminId, product.id);
  assert.equal(persisted?.title, 'PPT Master pptmaster');
  assert.equal(persisted?.assets?.length, 1);
  const xianyu = persisted?.attributes.xianyu;
  assert.ok(xianyu && typeof xianyu === 'object');
  assert.ok((xianyu.detail ?? xianyu) && typeof (xianyu.detail ?? xianyu) === 'object');
  console.log('xianyu item detail route smoke passed');
} finally {
  globalThis.fetch = originalFetch;
  await runtime.close();
}
