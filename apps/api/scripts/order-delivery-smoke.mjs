import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const port = 18800 + (process.pid % 100);
const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
await runtime.listen();

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  return { response, body: await response.json() };
}

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'delivery-bootstrap' }, body: JSON.stringify({ email: 'delivery@example.com', password: 'password-123', displayName: 'Delivery Test' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const adminId = bootstrap.body.data.profile.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'delivery-account', displayName: 'Delivery Account' });
  const product = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: 'item-delivery', title: '免物流商品' });
  const orderNo = 'XY-DELIVERY-001';
  await runtime.store.createOrder({ adminId, order: { accountId: account.id, orderNo, buyerId: 'buyer-delivery', buyerName: '买家', itemId: 'item-delivery', itemTitle: '免物流商品', amountMinor: 990, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'no_logistics', productId: product.id } });
  runtime.xianyu.readOrderDetail = async () => ({ success: true, accountInvalid: false, cookieHeader: '', detail: { orderNo, paymentStatus: 'paid', deliveryStatus: 'pending', itemId: 'item-delivery', itemTitle: '免物流商品' } });
  runtime.xianyu.confirmShipment = async () => ({ status: 'succeeded', externalRef: orderNo, cookieHeader: '' });

  const preview = await request(`/api/v1/orders/${encodeURIComponent(orderNo)}/delivery-preview`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf }, body: JSON.stringify({ accountId: account.id, deliveryType: 'no_logistics' }) });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.data.state, 'ready');

  const delivered = await request(`/api/v1/orders/${encodeURIComponent(orderNo)}/deliver`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'delivery-1' }, body: JSON.stringify({ accountId: account.id, deliveryType: 'no_logistics' }) });
  assert.equal(delivered.response.status, 200);
  assert.equal(delivered.body.data.record.status, 'succeeded');
  assert.equal(delivered.body.data.order.deliveryStatus, 'delivered');
  const deliveryRows = await runtime.store.listDeliveryRecords(adminId, { accountId: account.id, orderNo });
  assert.equal(deliveryRows.length, 1);
  assert.equal(deliveryRows[0].externalOutcome, 'known_success');
  const replayed = await request(`/api/v1/orders/${encodeURIComponent(orderNo)}/deliver`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'delivery-1' }, body: JSON.stringify({ accountId: account.id, deliveryType: 'no_logistics' }) });
  assert.equal(replayed.response.status, 200);
  assert.equal(replayed.body.data.record.id, delivered.body.data.record.id);

  const session = await request('/api/v1/workspace/agent-sessions', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'delivery-session' }, body: JSON.stringify({ accountId: account.id, title: 'Delivery Workspace' }) });
  const rerunOrderNo = 'XY-DELIVERY-002';
  await runtime.store.createOrder({ adminId, order: { accountId: account.id, orderNo: rerunOrderNo, buyerId: 'buyer-delivery-2', buyerName: '买家二', itemId: 'item-delivery', itemTitle: '免物流商品', amountMinor: 990, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'no_logistics', productId: product.id } });
  const run = await request('/api/v1/workspace/runs', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'delivery-workspace-run' }, body: JSON.stringify({ accountId: account.id, sessionId: session.body.data.id, instruction: `给订单 ${rerunOrderNo} 免物流发货`, clientRunRef: 'delivery-workspace-run' }) });
  assert.equal(run.response.status, 201);
  let current;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await request(`/api/v1/workspace/runs/${run.body.data.runId}`, { headers: { cookie } });
    current = response.body.data;
    if (current.status === 'waiting_confirmation') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(current.status, 'waiting_confirmation');
  const confirmation = await request(`/api/v1/workspace/runs/${run.body.data.runId}/confirmation`, { headers: { cookie } });
  const confirmed = await request(`/api/v1/workspace/runs/${run.body.data.runId}/confirm`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'delivery-workspace-confirm' }, body: JSON.stringify({ expectedVersion: confirmation.body.data.version }) });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.body.data.run.status, 'succeeded');
  assert.equal((await runtime.store.getOrder(adminId, rerunOrderNo, account.id)).deliveryStatus, 'delivered');
  console.log('order delivery smoke passed');
} finally {
  await runtime.close();
}
