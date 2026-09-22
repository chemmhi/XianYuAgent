import assert from 'node:assert/strict';
import test from 'node:test';
import { mapXianyuProductPage } from '../src/xianyu-product-mapper.js';

test('maps the remote Xianyu update time from product cards', () => {
  const page = mapXianyuProductPage({
    data: {
      cardList: [
        { cardData: { detailParams: { itemId: 'ITEM-001' }, title: '商品一', updateTime: '2026-09-20T10:20:30.000Z' } },
        { cardData: { detailParams: { itemId: 'ITEM-002', modifyTime: 1_790_000_000 }, title: '商品二' } },
      ],
    },
  }, 1, 20);

  assert.equal(page.items[0]?.xianyuUpdatedAt, '2026-09-20T10:20:30.000Z');
  assert.equal(page.items[1]?.xianyuUpdatedAt, new Date(1_790_000_000 * 1000).toISOString());
});

test('does not map item creation time as the remote update time', () => {
  const page = mapXianyuProductPage({
    data: { cardList: [{ cardData: { detailParams: { itemId: 'ITEM-CREATED' }, itemDO: { gmtCreate: 1_750_000_000_000 }, title: '商品' } }] },
  }, 1, 20);

  assert.equal(page.items[0]?.xianyuUpdatedAt, undefined);
});
