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
  const result = await service.publish({ adminId: 'admin-1', accountId: 'account-1', title: '女士连衣裙', description: '九成新，尺码M', priceMinor: 20000, quantity: 1, postageMode: 'fixed', postageMinor: 800, images: [{ filename: 'dress.png', contentType: 'image/png', data: Buffer.from('image') }], requestId: 'request-1', traceId: 'trace-1' });
  assert.equal(result.itemId, '1085806034681');
  assert.deepEqual(calls.map((item) => item.api), ['mtop.taobao.idle.kgraph.property.recommend', 'mtop.idle.pc.idleitem.publish']);
  assert.deepEqual((calls[1]!.data.itemPostFeeDTO as Record<string, unknown>), { canFreeShipping: false, supportFreight: true, onlyTakeSelf: false, postPriceInCent: '800', templateId: '0' });
  assert.equal(created[0]!.status, 'published');
});

test('rejects fixed-price publish without postage before external calls', async () => {
  let called = false;
  const xianyu = { async uploadChatImage() { called = true; return { success: true, accountInvalid: false, cookieHeader: 'redacted', url: 'https://img.example/1.jpg' }; }, async callApi() { called = true; return ok({}); } } as unknown as XianyuMtopClient;
  const service = new ProductPublishService(xianyu, {} as never, async () => undefined, async () => 'audit-1');
  await assert.rejects(() => service.publish({ adminId: 'admin-1', accountId: 'account-1', title: '商品', description: '描述', priceMinor: 20000, quantity: 1, postageMode: 'fixed', images: [{ filename: 'one.png', contentType: 'image/png', data: Buffer.from('image') }], requestId: 'request-1', traceId: 'trace-1' }), /一口价模式必须填写合法邮费/);
  assert.equal(called, false);
});

test('uses the configured model provider for description optimization', async () => {
  const service = new ProductPublishService({} as never, {} as never, async () => ({ model: 'model-x', async complete() { return { content: '优化后的闲鱼文案', model: 'model-x' }; } }), async () => 'audit-1');
  const result = await service.optimizeDescription({ adminId: 'admin-1', accountId: 'account-1', title: '裙子', description: '九成新', requestId: 'request-1', traceId: 'trace-1' });
  assert.deepEqual(result, { description: '优化后的闲鱼文案', provider: 'configured', model: 'model-x' });
});
