import assert from 'node:assert/strict';
import test from 'node:test';
import { XianyuMtopClient } from '../src/xianyu-mtop.js';

const credential = { cookieHeader: 'unb=seller-1; _m_h5_tk=token_1_suffix' };

function createClient() {
  return new XianyuMtopClient({
    timeoutMs: 2_000,
    loadCredential: async () => credential,
    saveCookie: async () => undefined,
  });
}

function captureRequest(init?: RequestInit) {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const body = new URLSearchParams(String(init?.body ?? ''));
  const raw = body.get('data');
  return { headers, payload: raw ? JSON.parse(raw) as Record<string, unknown> : undefined };
}

test('confirmShipment sends the virtual-consignment payload with seller workbench headers', async () => {
  const originalFetch = globalThis.fetch;
  let captured: ReturnType<typeof captureRequest> | undefined;
  globalThis.fetch = async (_input, init) => {
    captured = captureRequest(init);
    return new Response(JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { success: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await createClient().confirmShipment('admin-1', 'account-1', 'ORDER-001');
    assert.equal(result.status, 'succeeded');
    assert.equal(result.externalRef, 'ORDER-001');
    assert.deepEqual(captured?.payload, { orderId: 'ORDER-001', tradeText: '', picList: [], newUnconsign: true });
    assert.equal(captured?.headers.origin, 'https://seller.goofish.com');
    assert.equal(captured?.headers.referer, 'https://seller.goofish.com/?site=COMMONPRO#/seller-trade/order-manage');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('repriceOrder uses integer fen and classifies data.success=false as a known failure', async () => {
  const originalFetch = globalThis.fetch;
  let captured: ReturnType<typeof captureRequest> | undefined;
  globalThis.fetch = async (_input, init) => {
    captured = captureRequest(init);
    return new Response(JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { success: false } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await createClient().repriceOrder('admin-1', 'account-1', 'ORDER-002', 1299);
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'MTOP_BUSINESS_ERROR');
    assert.deepEqual(captured?.payload, { modifyFee: 1299, newTransportFee: '0', orderId: 'ORDER-002' });
    assert.equal(captured?.headers.origin, 'https://seller.goofish.com');
    assert.equal(captured?.headers.referer, 'https://seller.goofish.com/?site=COMMONPRO#/seller-trade/order-manage');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('readOrderDetail parses orderInfoVO snapshot and preserves seller role referer', async () => {
  const originalFetch = globalThis.fetch;
  let captured: ReturnType<typeof captureRequest> | undefined;
  globalThis.fetch = async (_input, init) => {
    captured = captureRequest(init);
    return new Response(JSON.stringify({
      ret: ['SUCCESS::调用成功'],
      data: {
        utArgs: { orderStatus: '待发货' },
        components: [{
          render: 'orderInfoVO',
          data: {
            itemInfo: { buyAmount: '3', specName: '颜色', specValue: '红色', itemId: 'ITEM-1', title: '测试商品' },
            priceInfo: { amount: { value: '88.00' } },
          },
        }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await createClient().readOrderDetail('admin-1', 'account-1', 'ORDER-003');
    assert.equal(result.success, true);
    assert.deepEqual(result.detail, {
      orderNo: 'ORDER-003',
      quantity: 3,
      skuSpec: '颜色:红色',
      amountMinor: 8800,
      orderStatus: '待发货',
      paymentStatus: undefined,
      deliveryStatus: '待发货',
      buyerId: undefined,
      conversationId: undefined,
      itemId: 'ITEM-1',
      itemTitle: '测试商品',
      reviewedAt: undefined,
    });
    assert.deepEqual(captured?.payload, { tid: 'ORDER-003' });
    assert.equal(captured?.headers.origin, 'https://www.goofish.com');
    assert.equal(captured?.headers.referer, 'https://www.goofish.com/order-detail?orderId=ORDER-003&role=seller');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('mutation transport exhaustion is classified as unknown, never failed', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    throw new Error('socket hang up');
  };
  try {
    const result = await createClient().confirmShipment('admin-1', 'account-1', 'ORDER-004');
    assert.equal(result.status, 'unknown');
    assert.equal(result.errorCode, 'MTOP_RETRY_EXHAUSTED');
    assert.equal(attempts, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('known MTOP permission rejection is classified as failed', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ret: ['PERMISSION_EXCEPTION::无权限访问'] }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await createClient().confirmShipment('admin-1', 'account-1', 'ORDER-006');
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'MTOP_PERMISSION_DENIED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('readOrderDetail rejects a structurally empty successful envelope', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { components: [{ render: 'otherVO', data: {} }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await createClient().readOrderDetail('admin-1', 'account-1', 'ORDER-007');
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'ORDER_DETAIL_EMPTY');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('invalid mutation inputs fail locally without touching the network', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('must not call network'); };
  try {
    const client = createClient();
    const missingOrder = await client.confirmShipment('admin-1', 'account-1', '   ');
    const badPrice = await client.repriceOrder('admin-1', 'account-1', 'ORDER-005', -1);
    assert.equal(missingOrder.status, 'failed');
    assert.equal(missingOrder.errorCode, 'ORDER_NO_MISSING');
    assert.equal(badPrice.status, 'failed');
    assert.equal(badPrice.errorCode, 'TARGET_PRICE_INVALID');
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
