import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { XianyuProductAutomationExecutionAdapter } from '../src/product-automation-xianyu.js';
import type { XianyuMtopClient } from '../src/xianyu-mtop.js';
import type { XianyuImService } from '../src/xianyu-im-service.js';

async function setup() {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: `live-${Math.random()}@example.com`, passwordHash: 'hash', displayName: 'Live' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `seller-${Math.random()}` });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, externalProductRef: 'item-live', title: '2026年奥维高清地图骗局', status: 'published' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-live', buyerDisplayName: '测试买家', externalConversationRef: 'cid-live@goofish' });
  const order = await store.createOrder({ adminId: admin.id, order: {
    orderNo: 'ORDER-LIVE-1', accountId: account.id, buyerId: 'buyer-live', buyerName: '测试买家', itemId: 'item-live', itemTitle: product.title,
    amountMinor: 1000, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only',
    createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z', conversationId: conversation.id, productId: product.id,
  }});
  const batch = await store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: 'Live Coupon', purpose: 'text' });
  await store.importCouponItems({ adminId: admin.id, batchId: batch.id, contents: ['LIVE-CODE-001'] });
  return { store, admin, account, product, conversation, order, batch };
}

test('live adapter reserves and sends the persisted coupon content through IM', async () => {
  const { store, admin, account, order, batch } = await setup();
  const sent: string[] = [];
  const fakeIm = { sendText: async (_adminId: string, _accountId: string, _conversationId: string, text: string) => { sent.push(text); return { externalMessageRef: 'im-live-1' }; } } as unknown as XianyuImService;
  const fakeMtop = {} as XianyuMtopClient;
  const adapter = new XianyuProductAutomationExecutionAdapter(store, () => fakeMtop, () => fakeIm);
  const reservation = await adapter.reserveCoupon({ adminId: admin.id, accountId: account.id, batchIds: [batch.id], quantity: 1, executionKey: 'live-send-1', purpose: 'delivery' });
  const result = await adapter.sendCoupon({ adminId: admin.id, accountId: account.id, productId: order.productId, itemId: order.itemId, itemTitle: order.itemTitle, orderNo: order.orderNo, reservationId: reservation.reservationId, executionKey: 'live-send-1', purpose: 'delivery' });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(sent, ['LIVE-CODE-001']);
  await adapter.commitCoupon({ adminId: admin.id, reservationId: reservation.reservationId, executionKey: 'live-send-1' });
  assert.equal((await store.getCouponReservation({ adminId: admin.id, reservationId: reservation.reservationId }))?.status, 'committed');
});

test('uncertain IM send keeps the reservation held for manual review', async () => {
  const { store, admin, account, order, batch } = await setup();
  const fakeIm = { sendText: async () => { throw Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' }); } } as unknown as XianyuImService;
  const adapter = new XianyuProductAutomationExecutionAdapter(store, () => ({} as XianyuMtopClient), () => fakeIm);
  const reservation = await adapter.reserveCoupon({ adminId: admin.id, accountId: account.id, batchIds: [batch.id], quantity: 1, executionKey: 'live-unknown-1', purpose: 'delivery' });
  const result = await adapter.sendCoupon({ adminId: admin.id, accountId: account.id, productId: order.productId, itemId: order.itemId, itemTitle: order.itemTitle, orderNo: order.orderNo, reservationId: reservation.reservationId, executionKey: 'live-unknown-1', purpose: 'delivery' });
  assert.equal(result.status, 'unknown');
  assert.equal((await store.getCouponReservation({ adminId: admin.id, reservationId: reservation.reservationId }))?.status, 'reserved');
});

test('live adapter refuses mutation when authoritative order detail is unavailable', async () => {
  const { store, admin, account, order } = await setup();
  let confirmed = false;
  const fakeMtop = {
    readOrderDetail: async () => ({ success: false, accountInvalid: false, errorCode: 'MTOP_RETRY_EXHAUSTED', message: 'timeout', cookieHeader: '' }),
    confirmShipment: async () => { confirmed = true; return { status: 'succeeded', externalRef: order.orderNo }; },
  } as unknown as XianyuMtopClient;
  const adapter = new XianyuProductAutomationExecutionAdapter(store, () => fakeMtop, () => undefined);
  const result = await adapter.confirmShipment({ adminId: admin.id, accountId: account.id, productId: order.productId, itemId: order.itemId, itemTitle: order.itemTitle, orderNo: order.orderNo, executionKey: 'live-confirm-1' });
  assert.equal(result.status, 'unknown');
  assert.equal(confirmed, false);
});

test('live adapter infers unpaid payment from orderStatus when detail omits paymentStatus', async () => {
  const { store, admin, account, order } = await setup();
  let repriced = false;
  const fakeMtop = {
    readOrderDetail: async () => ({ success: true, accountInvalid: false, detail: { orderNo: order.orderNo, orderStatus: '待付款' }, cookieHeader: '' }),
    repriceOrder: async () => { repriced = true; return { status: 'succeeded', externalRef: order.orderNo }; },
  } as unknown as XianyuMtopClient;
  const adapter = new XianyuProductAutomationExecutionAdapter(store, () => fakeMtop, () => undefined);
  const result = await adapter.repriceOrder({ adminId: admin.id, accountId: account.id, productId: order.productId, itemId: order.itemId, itemTitle: order.itemTitle, orderNo: order.orderNo, targetPriceMinor: 777, executionKey: 'live-reprice-order-status' });
  assert.equal(result.status, 'succeeded');
  assert.equal(repriced, true);
});

test('live adapter treats numeric orderStatus 1 as unpaid', async () => {
  const { store, admin, account, order } = await setup();
  let repriced = false;
  const fakeMtop = {
    readOrderDetail: async () => ({ success: true, accountInvalid: false, detail: { orderNo: order.orderNo, orderStatus: '1', deliveryStatus: '1' }, cookieHeader: '' }),
    repriceOrder: async () => { repriced = true; return { status: 'succeeded', externalRef: order.orderNo }; },
  } as unknown as XianyuMtopClient;
  const adapter = new XianyuProductAutomationExecutionAdapter(store, () => fakeMtop, () => undefined);
  const result = await adapter.repriceOrder({ adminId: admin.id, accountId: account.id, productId: order.productId, itemId: order.itemId, itemTitle: order.itemTitle, orderNo: order.orderNo, targetPriceMinor: 777, executionKey: 'live-reprice-numeric-1' });
  assert.equal(result.status, 'succeeded');
  assert.equal(repriced, true);
});

test('live adapter skips reprice when authoritative amount already matches target', async () => {
  const { store, admin, account, order } = await setup();
  let repriced = false;
  const fakeMtop = {
    readOrderDetail: async () => ({ success: true, accountInvalid: false, detail: { orderNo: order.orderNo, orderStatus: '待付款', paymentStatus: 'unpaid', deliveryStatus: '1', amountMinor: 3000 }, cookieHeader: '' }),
    repriceOrder: async () => { repriced = true; return { status: 'succeeded', externalRef: order.orderNo }; },
  } as unknown as XianyuMtopClient;
  const adapter = new XianyuProductAutomationExecutionAdapter(store, () => fakeMtop, () => undefined);
  const result = await adapter.repriceOrder({ adminId: admin.id, accountId: account.id, productId: order.productId, itemId: order.itemId, itemTitle: order.itemTitle, orderNo: order.orderNo, targetPriceMinor: 3000, executionKey: 'live-reprice-idempotent' });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.externalRef, order.orderNo);
  assert.equal(repriced, false);
});

test('live adapter does not reserve coupon while IM is unavailable', async () => {
  const { store, admin, account, order, batch } = await setup();
  const fakeIm = { isReady: async () => false } as unknown as XianyuImService;
  const adapter = new XianyuProductAutomationExecutionAdapter(store, () => ({} as XianyuMtopClient), () => fakeIm);
  await assert.rejects(() => adapter.reserveCoupon({ adminId: admin.id, accountId: account.id, batchIds: [batch.id], quantity: 1, executionKey: 'live-reserve-not-ready', purpose: 'delivery' }), /XIANYU_IM_NOT_READY/);
  assert.equal((await store.getCouponReservation({ adminId: admin.id, reservationId: 'missing' }))?.status, undefined);
});

test('live adapter maps numeric status 1 to unpaid and pending in readOrder', async () => {
  const { store, admin, account, order } = await setup();
  const fakeMtop = {
    readOrderDetail: async () => ({ success: true, accountInvalid: false, detail: { orderNo: order.orderNo, orderStatus: '1', deliveryStatus: '1' }, cookieHeader: '' }),
  } as unknown as XianyuMtopClient;
  const adapter = new XianyuProductAutomationExecutionAdapter(store, () => fakeMtop, () => undefined);
  const result = await adapter.readOrder({ adminId: admin.id, accountId: account.id, productId: order.productId, itemId: order.itemId, itemTitle: order.itemTitle, orderNo: order.orderNo });
  assert.equal(result?.paymentStatus, 'unpaid');
  assert.equal(result?.deliveryStatus, 'pending');
});

test('treats numeric order status 4 as already delivered', async () => {
  const { store, admin, account, order } = await setup();
  let confirmed = false;
  const fakeMtop = {
    readOrderDetail: async () => ({ success: true, accountInvalid: false, detail: { orderNo: order.orderNo, deliveryStatus: '4' }, cookieHeader: '' }),
    confirmShipment: async () => { confirmed = true; return { status: 'succeeded', externalRef: order.orderNo }; },
  } as unknown as XianyuMtopClient;
  const adapter = new XianyuProductAutomationExecutionAdapter(store, () => fakeMtop, () => undefined);
  const result = await adapter.confirmShipment({ adminId: admin.id, accountId: account.id, productId: order.productId, itemId: order.itemId, itemTitle: order.itemTitle, orderNo: order.orderNo, executionKey: 'live-confirm-numeric-4' });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.externalRef, order.orderNo);
  assert.equal(confirmed, false);
});

test('treats numeric order status 2 as pending and confirms shipment', async () => {
  const { store, admin, account, order } = await setup();
  let confirmed = false;
  const fakeMtop = {
    readOrderDetail: async () => ({ success: true, accountInvalid: false, detail: { orderNo: order.orderNo, deliveryStatus: '2' }, cookieHeader: '' }),
    confirmShipment: async () => { confirmed = true; return { status: 'succeeded', externalRef: order.orderNo }; },
  } as unknown as XianyuMtopClient;
  const adapter = new XianyuProductAutomationExecutionAdapter(store, () => fakeMtop, () => undefined);
  const result = await adapter.confirmShipment({ adminId: admin.id, accountId: account.id, productId: order.productId, itemId: order.itemId, itemTitle: order.itemTitle, orderNo: order.orderNo, executionKey: 'live-confirm-numeric-2' });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.externalRef, order.orderNo);
  assert.equal(confirmed, true);
});

test('treats numeric order status 3 as already shipped', async () => {
  const { store, admin, account, order } = await setup();
  let confirmed = false;
  const fakeMtop = {
    readOrderDetail: async () => ({ success: true, accountInvalid: false, detail: { orderNo: order.orderNo, deliveryStatus: '3' }, cookieHeader: '' }),
    confirmShipment: async () => { confirmed = true; return { status: 'succeeded', externalRef: order.orderNo }; },
  } as unknown as XianyuMtopClient;
  const adapter = new XianyuProductAutomationExecutionAdapter(store, () => fakeMtop, () => undefined);
  const result = await adapter.confirmShipment({ adminId: admin.id, accountId: account.id, productId: order.productId, itemId: order.itemId, itemTitle: order.itemTitle, orderNo: order.orderNo, executionKey: 'live-confirm-numeric-3' });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.externalRef, order.orderNo);
  assert.equal(confirmed, false);
});
