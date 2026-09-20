import assert from 'node:assert/strict';
import { mapXianyuOrderPage } from '../dist/xianyu-order-mapper.js';

const page = mapXianyuOrderPage({ data: { orderList: [{ orderId: 'X-1', buyer: { id: 'buyer-1', nick: '买家1' }, item: { id: 'item-1', title: '测试商品' }, payAmount: '39.90', payStatus: 'PAID', tradeStatus: 'SUCCESS', shipStatus: 'WAIT_SEND', createTime: '2026-09-20T01:00:00Z' }] } }, 1, 20);
assert.equal(page.items.length, 1);
assert.equal(page.items[0].orderNo, 'X-1');
assert.equal(page.items[0].buyerId, 'buyer-1');
assert.equal(page.items[0].buyerName, '买家1');
assert.equal(page.items[0].itemId, 'item-1');
assert.equal(page.items[0].amountMinor, 3990);
assert.equal(page.items[0].paymentStatus, 'paid');
assert.equal(page.items[0].orderStatus, 'completed');
assert.equal(page.items[0].deliveryStatus, 'pending');
assert.equal(page.items[0].afterSalesStatus, 'none');
assert.equal(page.items[0].createdAt, '2026-09-20T01:00:00.000Z');
console.log('xianyu order mapper smoke passed');
