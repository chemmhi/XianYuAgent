import assert from 'node:assert/strict';
import { mapXianyuOrderPage } from '../dist/xianyu-order-mapper.js';

const page = mapXianyuOrderPage({
  ret: ['SUCCESS::调用成功'],
  data: {
    module: {
      nextPage: 'false',
      totalCount: '1',
      items: [{
        commonData: { orderId: 'X-1', itemId: 'item-1', itemInfo: { itemName: '测试商品' }, orderStatus: '待发货', inRefund: 'false' },
        buyerInfoVO: { buyerId: 'buyer-1', nick: '买家昵称1', name: '买家姓名1', avatar: 'https://img.example/buyer-1.png' },
        priceVO: { totalPrice: '39.90', buyNum: '2' },
        rightVO: { btnList: [{ tradeAction: 'SKIP_PIN' }] },
      }],
    },
  },
}, 1, 20);
assert.equal(page.items.length, 1);
assert.equal(page.items[0].orderNo, 'X-1');
assert.equal(page.items[0].buyerId, 'buyer-1');
assert.equal(page.items[0].buyerNickname, '买家昵称1');
assert.equal(page.items[0].buyerName, '买家姓名1');
assert.equal(page.items[0].itemId, 'item-1');
assert.equal(page.items[0].buyerAvatarUrl, 'https://img.example/buyer-1.png');
assert.equal(page.items[0].itemTitle, '测试商品');
assert.equal(page.items[0].amountMinor, 3990);
assert.equal(page.items[0].paymentStatus, 'paid');
assert.equal(page.items[0].orderStatus, 'open');
assert.equal(page.items[0].deliveryStatus, 'pending');
assert.equal(page.items[0].afterSalesStatus, 'none');
assert.equal(page.hasMore, false);
const refundPage = mapXianyuOrderPage({
  data: {
    module: {
      nextPage: 'false',
      items: [{
        commonData: { orderId: 'X-REFUND', itemId: 'item-refund', orderStatus: '退款中', inRefund: 'false' },
        buyerInfoVO: { buyerId: 'buyer-refund', name: '退款买家' },
        priceVO: { totalPrice: '1.00', buyNum: '1' },
        rightVO: { btnList: [] },
      }],
    },
  },
}, 1, 30);
assert.equal(refundPage.items[0].afterSalesStatus, 'refunding');
assert.equal(refundPage.items[0].paymentStatus, 'paid');
const refundedPage = mapXianyuOrderPage({
  data: {
    module: {
      items: [{
        commonData: { orderId: 'X-REFUNDED', itemId: 'item-refunded', orderStatus: '退款成功', inRefund: 'false' },
        buyerInfoVO: { buyerId: 'buyer-refunded', name: '已退款买家' },
        priceVO: { totalPrice: '1.00', buyNum: '1' },
        rightVO: { btnList: [] },
      }],
    },
  },
}, 1, 30);
assert.equal(refundedPage.items[0].afterSalesStatus, 'refunded');
assert.equal(refundedPage.items[0].orderStatus, 'cancelled');
console.log('xianyu order mapper smoke passed');
