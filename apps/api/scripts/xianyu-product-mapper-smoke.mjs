import assert from 'node:assert/strict';
import { mapXianyuProductPage } from '../dist/xianyu-product-mapper.js';

const fixture = {
  data: {
    totalCount: 2,
    pageCount: 1,
    cardList: [
      { cardType: 1, cardData: { id: 'auto_banner', title: '广告位' } },
      { cardType: 1, cardData: { title: '数字商品', detailParams: { itemId: 'ITEM-001' }, priceInfo: { price: '39.90' }, categoryId: 'digital', picInfo: { picUrl: 'https://img.example/item-001.jpg' }, detailUrl: 'https://www.goofish.com/item?id=ITEM-001', itemStatus: 1 } },
      { cardType: 1, cardData: { title: '不完整卡片', detailParams: {} } },
    ],
  },
};
const page = mapXianyuProductPage(fixture, 1, 20);
assert.equal(page.items.length, 1);
assert.equal(page.items[0].externalProductRef, 'ITEM-001');
assert.equal(page.items[0].priceMinor, 3990);
assert.deepEqual(page.items[0].imageUrls, ['https://img.example/item-001.jpg']);
assert.equal(page.items[0].categoryCode, 'digital');
assert.equal(page.items[0].sourcePayloadDigest.length, 64);
assert.equal(page.hasMore, false);
console.log('xianyu product mapper smoke passed');
