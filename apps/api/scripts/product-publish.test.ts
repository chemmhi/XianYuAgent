import assert from 'node:assert/strict';
import test from 'node:test';
import { ProductPublishService } from '../src/product-publish.js';
import type { MtopResult, XianyuMtopClient } from '../src/xianyu-mtop.js';

const ok = (response: Record<string, unknown>): MtopResult => ({ success: true, accountInvalid: false, cookieHeader: 'redacted', response });

test('publishes in official replay order and maps fixed postage', async () => {
  const calls: Array<{ api: string; data: Record<string, unknown> }> = [];
  const xianyu = {
    async uploadChatImage() { return { success: true, accountInvalid: false, cookieHeader: 'redacted', url: 'https://img.example/dress.png', width: 900, height: 1200 }; },
    async callApi(_adminId: string, _accountId: string, api: string, _version: string, data: Record<string, unknown>) {
      calls.push({ api, data });
      if (api === 'mtop.taobao.idle.kgraph.property.recommend') return ok({ data: { categoryPredictResult: { catId: 'cat-1', catName: '女装', channelCatId: 'channel-1' }, cardList: [] } });
      return ok({ data: { itemId: '1085806034681' } });
    },
  } as unknown as XianyuMtopClient;
  const created: Array<Record<string, unknown>> = [];
  const products = { async create(input: Record<string, unknown>) { created.push(input); return { id: 'local-product-1', accountId: 'account-1', externalProductRef: '1085806034681', title: String(input.title), description: String(input.description), categoryCode: String(input.categoryCode), attributesJson: input.attributesJson as Record<string, unknown>, configVersion: 1, priceMinor: 20000, status: 'published', createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' }; } };
  const service = new ProductPublishService(xianyu, products as never, async () => undefined, async () => 'audit-1');
  const result = await service.publish({ adminId: 'admin-1', accountId: 'account-1', title: '女士连衣裙', description: '九成新，尺码M', priceMinor: 20000, postageMode: 'fixed', postageMinor: 800, location: { province: '广东省', city: '深圳市', poiName: '深圳湾公园' }, images: [{ filename: 'dress.png', contentType: 'image/png', data: Buffer.from('image') }], requestId: 'request-1', traceId: 'trace-1' });
  assert.equal(result.itemId, '1085806034681');
  assert.deepEqual(calls.map((item) => item.api), ['mtop.taobao.idle.kgraph.property.recommend', 'mtop.idle.pc.idleitem.publish']);
  assert.equal(calls[0]!.data.title, '女士连衣裙\n九成新，尺码M');
  assert.equal(calls[0]!.data.description, '女士连衣裙\n九成新，尺码M');
  assert.deepEqual((calls[1]!.data.itemPostFeeDTO as Record<string, unknown>), { canFreeShipping: false, supportFreight: true, onlyTakeSelf: false, postPriceInCent: '800', templateId: '0' });
  assert.deepEqual(calls[1]!.data.itemTextDTO, { desc: '九成新，尺码M', title: '女士连衣裙', titleDescSeparate: true });
  assert.deepEqual(calls[1]!.data.itemAddrDTO, { city: '深圳市', poiName: '深圳湾公园', prov: '广东省' });
  assert.equal(created[0]!.status, 'published');
});

test('does not add inventory configuration and forwards structured official location fields', async () => {
  const calls: Array<{ api: string; data: Record<string, unknown> }> = [];
  const xianyu = {
    async uploadChatImage() { return { success: true, accountInvalid: false, cookieHeader: 'redacted', url: 'https://img.example/1.jpg' }; },
    async callApi(_adminId: string, _accountId: string, api: string, _version: string, data: Record<string, unknown>) {
      calls.push({ api, data });
      return api === 'mtop.taobao.idle.kgraph.property.recommend'
        ? ok({ data: { categoryPredictResult: { catId: 'cat-1', catName: '其他闲置', channelCatId: 'channel-1' } } })
        : ok({ data: { itemId: 'item-without-quantity' } });
    },
  } as unknown as XianyuMtopClient;
  const products = { async create(input: Record<string, unknown>) { return { id: 'local-product-1', accountId: 'account-1', externalProductRef: 'item-without-quantity', title: String(input.title), description: String(input.description), categoryCode: String(input.categoryCode), attributesJson: input.attributesJson as Record<string, unknown>, configVersion: 1, priceMinor: 19900, status: 'published', createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' }; } };
  const service = new ProductPublishService(xianyu, products as never, async () => undefined, async () => 'audit-1');

  await service.publish({
    adminId: 'admin-1', accountId: 'account-1', title: '店铺管家', description: '闲鱼超级助手', priceMinor: 19900,
    postageMode: 'free', location: { province: '广东省', city: '深圳市', area: '南山区', poiName: '深圳湾公园', poiId: 'B0FFFRDS71', aoiId: 'B0FFFRDS71', aoiName: '深圳湾公园', addressType: 5, cainiaoDivision: '440305' },
    images: [{ filename: 'one.png', contentType: 'image/png', data: Buffer.from('image') }], requestId: 'request-1', traceId: 'trace-1',
  });

  const publishData = calls.find((call) => call.api === 'mtop.idle.pc.idleitem.publish')!.data;
  assert.equal('quantity' in publishData, false);
  assert.deepEqual(publishData.itemAddrDTO, { addressType: 5, aoiId: 'B0FFFRDS71', aoiName: '深圳湾公园', area: '南山区', cainiaoDivision: '440305', city: '深圳市', poiId: 'B0FFFRDS71', poiName: '深圳湾公园', prov: '广东省' });
});

test('does not publish with a local UI category when recommendation fails', async () => {
  let publishCalled = false;
  const xianyu = {
    async uploadChatImage() { return { success: true, accountInvalid: false, cookieHeader: 'redacted', url: 'https://img.example/1.jpg' }; },
    async callApi(_adminId: string, _accountId: string, api: string) {
      if (api === 'mtop.taobao.idle.kgraph.property.recommend') {
        return { success: false, accountInvalid: false, errorCode: 'MTOP_BUSINESS_ERROR', message: '类目推荐暂不可用', cookieHeader: 'redacted' };
      }
      publishCalled = true;
      return ok({ data: { itemId: 'should-not-publish' } });
    },
  } as unknown as XianyuMtopClient;
  const service = new ProductPublishService(xianyu, {} as never, async () => undefined, async () => 'audit-1');

  await assert.rejects(
    () => service.publish({
      adminId: 'admin-1', accountId: 'account-1', title: '蓝牙耳机', description: '全新', categoryCode: 'digital.audio',
      priceMinor: 19900, postageMode: 'free', images: [{ filename: 'one.png', contentType: 'image/png', data: Buffer.from('image') }],
      requestId: 'request-1', traceId: 'trace-1',
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'XIANYU_PUBLISH_FAILED');
      assert.match(String((error as { message?: string }).message), /类目推荐暂不可用/);
      return true;
    },
  );
  assert.equal(publishCalled, false);
});

test('sends a complete electronic-materials fallback category when recommendation returns no category', async () => {
  let publishData: Record<string, unknown> | undefined;
  const xianyu = {
    async uploadChatImage() { return { success: true, accountInvalid: false, cookieHeader: 'redacted', url: 'https://img.example/1.jpg' }; },
    async callApi(_adminId: string, _accountId: string, api: string, _version: string, data: Record<string, unknown>) {
      if (api === 'mtop.taobao.idle.kgraph.property.recommend') return ok({ data: {} });
      publishData = data;
      return ok({ data: { itemId: 'fallback-item' } });
    },
  } as unknown as XianyuMtopClient;
  const products = { async create(input: Record<string, unknown>) { return { id: 'local-product-1', accountId: 'account-1', externalProductRef: 'fallback-item', title: String(input.title), description: String(input.description), categoryCode: String(input.categoryCode), attributesJson: input.attributesJson as Record<string, unknown>, configVersion: 1, priceMinor: 19900, status: 'published', createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' }; } };
  const service = new ProductPublishService(xianyu, products as never, async () => undefined, async () => 'audit-1');

  await service.publish({
    adminId: 'admin-1', accountId: 'account-1', title: '电子资料', description: '数字商品', categoryCode: 'digital',
    priceMinor: 19900, postageMode: 'none', images: [{ filename: 'one.png', contentType: 'image/png', data: Buffer.from('image') }],
    requestId: 'request-1', traceId: 'trace-1',
  });

  assert.deepEqual(publishData?.itemCatDTO, { catId: '50023914', catName: '电子资料', channelCatId: '202036301', tbCatId: '' });
  assert.deepEqual(publishData?.itemLabelExtList, [{
    channelCateName: '电子资料', valueId: null, channelCateId: '202036301', valueName: null, tbCatId: null,
    subPropertyId: null, labelType: 'common', subValueId: null, labelId: null, propertyName: '分类', isUserClick: '1',
    isUserCancel: null, from: 'newPublishChoice', propertyId: '-10000', labelFrom: 'newPublish', text: '电子资料',
    properties: '-10000##分类:202036301##电子资料',
  }]);
});

test('rejects fixed-price publish without postage before external calls', async () => {
  let called = false;
  const xianyu = { async uploadChatImage() { called = true; return { success: true, accountInvalid: false, cookieHeader: 'redacted', url: 'https://img.example/1.jpg' }; }, async callApi() { called = true; return ok({}); } } as unknown as XianyuMtopClient;
  const service = new ProductPublishService(xianyu, {} as never, async () => undefined, async () => 'audit-1');
  await assert.rejects(() => service.publish({ adminId: 'admin-1', accountId: 'account-1', title: '商品', description: '描述', priceMinor: 20000, postageMode: 'fixed', images: [{ filename: 'one.png', contentType: 'image/png', data: Buffer.from('image') }], requestId: 'request-1', traceId: 'trace-1' }), /一口价模式必须填写合法邮费/);
  assert.equal(called, false);
});

test('uses the configured model provider for description optimization', async () => {
  const service = new ProductPublishService({} as never, {} as never, async () => ({ model: 'model-x', async complete() { return { content: '优化后的闲鱼文案', model: 'model-x' }; } }), async () => 'audit-1');
  const result = await service.optimizeDescription({ adminId: 'admin-1', accountId: 'account-1', title: '裙子', description: '九成新', requestId: 'request-1', traceId: 'trace-1' });
  assert.deepEqual(result, { description: '优化后的闲鱼文案', provider: 'configured', model: 'model-x' });
});
