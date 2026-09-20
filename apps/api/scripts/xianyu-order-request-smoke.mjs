import assert from 'node:assert/strict';
import { XianyuMtopClient } from '../dist/xianyu-mtop.js';

const originalFetch = globalThis.fetch;
let captured;
let responseMode = 'success';
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const body = new URLSearchParams(String(init.body ?? ''));
  captured = { url, headers: init.headers, payload: JSON.parse(body.get('data')) };
  if (responseMode === 'permission') return new Response(JSON.stringify({ ret: ['PERMISSION_EXCEPTION::无权限访问'], data: { errCode: 'PERMISSION_EXCEPTION', errMsg: '无权限访问' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify({
    ret: ['SUCCESS::调用成功'],
    data: { module: { nextPage: 'false', totalCount: '1', items: [{
      commonData: { orderId: 'REQ-1', itemId: 'ITEM-1', orderStatus: '待发货', inRefund: 'false' },
      buyerInfoVO: { buyerId: 'BUYER-1', name: '请求校验买家' },
      priceVO: { totalPrice: '12.34', buyNum: '1' },
      rightVO: { btnList: [] },
    }] } },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

try {
  const client = new XianyuMtopClient({
    loadCredential: async () => ({ cookieHeader: 'unb=seller-1; _m_h5_tk=token_1' }),
    saveCookie: async () => {},
  });
  const result = await client.fetchOrdersAll('admin-1', 'account-1', 30, 2);
  assert.equal(result.items.length, 1);
  assert.deepEqual(captured.payload, {
    pageNumber: 1,
    rowsPerPage: 30,
    orderIds: '',
    queryCode: 'ALL',
    orderSearchParam: '{}',
  });
  assert.equal(captured.url.searchParams.get('type'), 'json');
  assert.equal(captured.url.searchParams.get('valueType'), 'string');
  assert.equal(captured.url.searchParams.get('spm_cnt'), 'a21107h.42831410.0.0');
  assert.equal(captured.headers.origin, 'https://seller.goofish.com');
  assert.equal(captured.headers.referer, 'https://seller.goofish.com/?site=COMMONPRO#/seller-trade/order-manage');
  assert.equal(captured.headers.idle_site_biz_code, 'COMMONPRO');
  responseMode = 'success';
  await client.fetchOrdersAll('admin-1', 'account-1', undefined, 1);
  assert.equal(captured.payload.rowsPerPage, 30);
  responseMode = 'permission';
  const denied = await client.fetchOrdersAll('admin-1', 'account-1', 30, 1);
  assert.equal(denied.items.length, 0);
  assert.equal(denied.pages[0].errorCode, 'MTOP_PERMISSION_DENIED');
  console.log('xianyu order request smoke passed');
} finally {
  globalThis.fetch = originalFetch;
}
