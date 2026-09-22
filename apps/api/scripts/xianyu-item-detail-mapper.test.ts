import test from 'node:test';
import assert from 'node:assert/strict';
import { mapXianyuItemDetail } from '../src/xianyu-item-detail-mapper.js';
import { XianyuMtopClient } from '../src/xianyu-mtop.js';

test('maps the live item detail envelope without reading DOM fields', () => {
  const summary = mapXianyuItemDetail({
    data: {
      itemDO: {
        itemId: '1078553391460',
        categoryId: 50023914,
        title: 'PPT Master pptmaster',
        desc: '安装包，一键安装脚本。',
        richTextDesc: '{"type":"root"}',
        soldPrice: '8.50',
        browseCnt: 315,
        wantCnt: 33,
        collectCnt: 8,
        favorCnt: 0,
        interactFavorCnt: 0,
        soldCnt: 0,
        quantity: 10000,
      },
      sellerDO: {
        sellerId: 1903703477,
        nick: '陈陈cc',
        city: '深圳',
        hasSoldNumInteger: 59,
        itemCount: 37,
        remarkDO: { sellerGoodRemarkCnt: 22, sellerBadRemarkCnt: 0 },
      },
    },
  });

  assert.deepEqual(summary, {
    itemId: '1078553391460',
    categoryId: '50023914',
    title: 'PPT Master pptmaster',
    description: '安装包，一键安装脚本。',
    richTextDescription: '{"type":"root"}',
    priceText: '8.50',
    priceMinor: 850,
    browseCount: 315,
    wantCount: 33,
    collectCount: 8,
    favoriteCount: 0,
    interactFavoriteCount: 0,
    soldCount: 0,
    quantity: 10000,
    seller: {
      sellerId: '1903703477',
      nickname: '陈陈cc',
      city: '深圳',
      soldCount: 59,
      itemCount: 37,
      goodRemarkCount: 22,
      badRemarkCount: 0,
    },
  });
});

test('returns an empty summary when the envelope is absent', () => {
  assert.deepEqual(mapXianyuItemDetail(undefined, '1078553391460'), { itemId: '1078553391460' });
});

test('replays the observed MTOP detail contract with item-page tracking params', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({ api: 'mtop.taobao.idle.pc.detail', ret: ['SUCCESS::调用成功'], data: { itemDO: { itemId: '1078553391460', title: 'PPT Master pptmaster', soldPrice: '8.50' } } }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = new XianyuMtopClient({
      loadCredential: async () => ({ cookieHeader: 'unb=1903703477; _m_h5_tk=token_9999999999999; _m_h5_tk_enc=enc' }),
      saveCookie: async () => undefined,
    });
    const result = await client.fetchItemDetail('admin', 'account', 1078553391460, { categoryId: 50023914, spmPre: 'a21ybx.personal.feeds.1.test', logId: 'test-log' });
    assert.equal(result.success, true);
    assert.equal(result.summary.priceMinor, 850);
    assert.match(capturedUrl, /api=mtop\.taobao\.idle\.pc\.detail/);
    assert.match(capturedUrl, /spm_cnt=a21ybx\.item\.0\.0/);
    assert.match(capturedUrl, /spm_pre=a21ybx\.personal\.feeds\.1\.test/);
    assert.match(capturedUrl, /log_id=test-log/);
    assert.equal(new URL(capturedUrl).searchParams.get('type'), 'originaljson');
    assert.equal(new URL(capturedUrl).searchParams.get('sessionOption'), 'AutoLoginOnly');
    assert.equal(String(capturedInit?.body), 'data=%7B%22itemId%22%3A%221078553391460%22%7D');
    assert.equal(new Headers(capturedInit?.headers).get('referer'), 'https://www.goofish.com/item?id=1078553391460&categoryId=50023914');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
