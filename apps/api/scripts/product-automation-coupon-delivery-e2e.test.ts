import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import { AutomationWorkflowService } from '../src/product-automation.js';
import { XianyuProductAutomationExecutionAdapter } from '../src/product-automation-xianyu.js';
import type { ProductAutomationConfig } from '../src/domain.js';
import { MemoryStore } from '../src/store-memory.js';
import type { XianyuImService } from '../src/xianyu-im-service.js';
import type { XianyuMtopClient } from '../src/xianyu-mtop.js';

type Harness = Awaited<ReturnType<typeof createHarness>>;

async function createHarness(options: { metadata?: Record<string, unknown>; purpose?: 'text' | 'data' | 'api' | 'image'; skuSpec?: string } = {}) {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: `coupon-e2e-${Math.random()}@example.com`, passwordHash: 'hash', displayName: 'Coupon E2E' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `seller-${Math.random()}`, displayName: '卖家昵称' });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, externalProductRef: `item-${Math.random()}`, title: '测试商品', description: '商品详情文本', status: 'published' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-e2e', buyerDisplayName: '买家小明', externalConversationRef: 'conversation-e2e' });
  const order = await store.createOrder({ adminId: admin.id, order: {
    orderNo: `ORDER-${Math.random()}`, accountId: account.id, buyerId: 'buyer-e2e', buyerName: '买家小明', itemId: product.externalProductRef!, itemTitle: product.title,
    skuSpec: options.skuSpec, amountMinor: 1299, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only',
    createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z', conversationId: conversation.id, productId: product.id,
  }});
  const batch = await store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: 'E2E 卡券', purpose: options.purpose ?? 'text', deliveryScope: 'buyer_deliverable', metadata: options.metadata });
  const sentText: string[] = [];
  const sentImages: Array<{ filename: string; contentType: string; data: Buffer }> = [];
  const shipmentCalls: string[] = [];
  const fakeIm = {
    sendText: async (_adminId: string, _accountId: string, _conversationId: string, text: string) => { sentText.push(text); return { externalMessageRef: `text-${sentText.length}` }; },
    sendImage: async (_adminId: string, _accountId: string, _conversationId: string, file: { filename: string; contentType: string; data: Buffer }) => { sentImages.push(file); return { externalMessageRef: `image-${sentImages.length}` }; },
  } as unknown as XianyuImService;
  const fakeMtop = {
    readOrderDetail: async () => ({ success: true, accountInvalid: false, cookieHeader: '', detail: { orderNo: order.orderNo, itemId: order.itemId, itemTitle: order.itemTitle, buyerId: order.buyerId, conversationId: order.conversationId, paymentStatus: 'paid', deliveryStatus: 'pending', skuSpec: order.skuSpec } }),
    confirmShipment: async (_adminId: string, _accountId: string, _orderNo: string, tradeText = '') => { shipmentCalls.push(tradeText); return { status: 'succeeded', externalRef: `shipment-${shipmentCalls.length}`, cookieHeader: '' }; },
  } as unknown as XianyuMtopClient;
  const adapter = new XianyuProductAutomationExecutionAdapter(store, () => fakeMtop, () => fakeIm);
  const workflow = new AutomationWorkflowService(adapter);
  return { store, admin, account, product, conversation, order: { ...order, skuSpec: options.skuSpec }, batch, workflow, sentText, sentImages, shipmentCalls };
}

function paidConfig(batchIds: string[], patch: Partial<ProductAutomationConfig['paidAutoDelivery']> = {}): ProductAutomationConfig {
  return {
    paidAutoDelivery: { enabled: true, couponBatchIds: batchIds, autoConfirm: false, maxAttempts: 1, retryBackoffSeconds: 0, ...patch },
    unpaidAutoReprice: { enabled: false, mode: 'fixed', targetPriceMinor: 0, maxAttempts: 1, retryBackoffSeconds: 0 },
    reviewGift: { enabled: false, couponBatchIds: [], maxAttempts: 1, retryBackoffSeconds: 0 },
    reviewReminder: { enabled: false, firstDelayHours: 1, repeatIntervalHours: 1, maxReminders: 1, message: '请评价' },
  };
}

test('固定文字配置消费备注常量并执行延迟', async () => {
  const harness = await createHarness({ metadata: { textContent: '固定卡密', description: '订单={order_id};商品编号={item_id};商品详情={item_detail};商品={item_title};买家={buyer_name};买家ID={buyer_id};账号={cookie_id};卖家={seller_name};规格名={spec_name};规格值={spec_value};金额={order_amount};数量={order_quantity};内容={DELIVERY_CONTENT}', delaySeconds: 0.01 }, skuSpec: '颜色:红色' });
  const startedAt = Date.now();
  const result = await harness.workflow.handlePaymentPaid({ adminId: harness.admin.id, config: paidConfig([harness.batch.id]), order: harness.order, eventId: 'fixed-text-event' });
  assert.equal(result.status, 'succeeded');
  assert.ok(Date.now() - startedAt >= 8);
  assert.deepEqual(harness.sentText, ['订单=' + harness.order.orderNo + ';商品编号=' + harness.order.itemId + ';商品详情=商品详情文本;商品=测试商品;买家=买家小明;买家ID=buyer-e2e;账号=' + harness.account.id + ';卖家=卖家昵称;规格名=颜色;规格值=红色;金额=12.99;数量=1;内容=固定卡密']);
  assert.deepEqual(harness.shipmentCalls, []);
});

test('备注无变量时会保留备注并按分隔符拆成多条消息', async () => {
  const harness = await createHarness({ metadata: { textContent: '固定卡密', description: '第一条######第二条' } });
  const result = await harness.workflow.handlePaymentPaid({ adminId: harness.admin.id, config: paidConfig([harness.batch.id]), order: harness.order, eventId: 'text-split-event' });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(harness.sentText, ['第一条', '第二条\n\n固定卡密']);
});

test('批量数据配置按行消费且无需预先导入条目', async () => {
  const harness = await createHarness({ purpose: 'data', metadata: { dataContent: 'DATA-1\nDATA-2' } });
  const first = await harness.workflow.handlePaymentPaid({ adminId: harness.admin.id, config: paidConfig([harness.batch.id]), order: harness.order, eventId: 'data-event-1' });
  const secondOrder = { ...harness.order, orderNo: `${harness.order.orderNo}-2` };
  await harness.store.createOrder({ adminId: harness.admin.id, order: secondOrder });
  const second = await harness.workflow.handlePaymentPaid({ adminId: harness.admin.id, config: paidConfig([harness.batch.id]), order: secondOrder, eventId: 'data-event-2' });
  assert.equal(first.status, 'succeeded');
  assert.equal(second.status, 'succeeded');
  assert.deepEqual(harness.sentText, ['DATA-1', 'DATA-2']);
});

test('批量数据配置消费备注变量、延迟和多规格匹配', async () => {
  const harness = await createHarness({ purpose: 'data', metadata: { dataContent: 'DATA-REMARK', description: '订单={order_id};内容={DELIVERY_CONTENT};买家={buyer_name}', delaySeconds: 0.01, multiSpec: true, specName: '颜色', specValue: '红色' }, skuSpec: '颜色:红色' });
  const startedAt = Date.now();
  const result = await harness.workflow.handlePaymentPaid({ adminId: harness.admin.id, config: paidConfig([harness.batch.id]), order: harness.order, eventId: 'data-remark-event' });
  assert.equal(result.status, 'succeeded');
  assert.ok(Date.now() - startedAt >= 8);
  assert.deepEqual(harness.sentText, [`订单=${harness.order.orderNo};内容=DATA-REMARK;买家=买家小明`]);
});

test('API GET 配置消费响应字段、查询参数和多规格匹配', async () => {
  let requestUrl = '';
  let requestHeaders: Headers | undefined;
  const server = createServer((request, response) => { requestUrl = request.url ?? ''; requestHeaders = new Headers(request.headers as HeadersInit); response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ data: { card: `GET-${new URL(request.url ?? '/', 'http://localhost').searchParams.get('order_id')}` } })); });
  await listen(server);
  try {
    const harness = await createHarness({ purpose: 'api', metadata: { multiSpec: true, specName: '颜色', specValue: '红色', apiConfig: { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/card`, method: 'GET', headers: '{"X-Test-Header":"coupon-e2e"}', params: '{"order_id":"{order_id}","item_detail":"{item_detail}","cookie_id":"{cookie_id}","timestamp":"{timestamp}"}', responseField: 'data.card' } }, skuSpec: '颜色:红色' });
    const result = await harness.workflow.handlePaymentPaid({ adminId: harness.admin.id, config: paidConfig([harness.batch.id]), order: harness.order, eventId: 'api-get-event' });
    assert.equal(result.status, 'succeeded');
    assert.match(requestUrl, new RegExp(`order_id=${encodeURIComponent(harness.order.orderNo)}`));
    assert.match(requestUrl, /item_detail=%E5%95%86%E5%93%81%E8%AF%A6%E6%83%85%E6%96%87%E6%9C%AC/u);
    assert.match(requestUrl, new RegExp(`cookie_id=${encodeURIComponent(harness.account.id)}`));
    const timestamp = new URL(requestUrl, 'http://localhost').searchParams.get('timestamp');
    assert.match(timestamp ?? '', /^\d+$/u);
    assert.equal(requestHeaders?.get('x-test-header'), 'coupon-e2e');
    assert.deepEqual(harness.sentText, [`GET-${harness.order.orderNo}`]);
  } finally { await close(server); }
});

test('API POST 配置消费动态参数和响应字段', async () => {
  let body = '';
  const server = createServer((request, response) => { request.on('data', (chunk) => { body += String(chunk); }); request.on('end', () => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ result: { card: 'POST-CARD' } })); }); });
  await listen(server);
  try {
    const harness = await createHarness({ purpose: 'api', metadata: { description: '接口备注={DELIVERY_CONTENT};商品={item_title}', delaySeconds: 0.01, apiConfig: { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/card`, method: 'POST', params: '{"buyer":"{buyer_id}","item":"{item_id}","spec":"{spec_value}","detail":"{item_detail}","cookie":"{cookie_id}","timestamp":"{timestamp}"}', responseField: 'result.card' } }, skuSpec: '颜色:红色' });
    const result = await harness.workflow.handlePaymentPaid({ adminId: harness.admin.id, config: paidConfig([harness.batch.id]), order: harness.order, eventId: 'api-post-event' });
    assert.equal(result.status, 'succeeded');
    const postPayload = JSON.parse(body) as Record<string, string>;
    assert.deepEqual(postPayload, { buyer: 'buyer-e2e', item: harness.order.itemId, spec: '红色', detail: '商品详情文本', cookie: harness.account.id, timestamp: postPayload.timestamp });
    assert.match(postPayload.timestamp, /^\d+$/u);
    assert.deepEqual(harness.sentText, [`接口备注=POST-CARD;商品=${harness.order.itemTitle}`]);
  } finally { await close(server); }
});

test('图片配置发送多张图片、备注文本并匹配多规格', async () => {
  const image1 = 'data:image/png;base64,aGVsbG8=';
  const image2 = 'data:image/jpeg;base64,d29ybGQ=';
  const harness = await createHarness({ purpose: 'image', metadata: { imageUrls: [image1, image2], description: '图片备注：{item_id} / {item_detail} / {buyer_name} / {cookie_id}', delaySeconds: 0.01, multiSpec: true, specName: '颜色', specValue: '红色' }, skuSpec: '颜色:红色' });
  const result = await harness.workflow.handlePaymentPaid({ adminId: harness.admin.id, config: paidConfig([harness.batch.id]), order: harness.order, eventId: 'image-event' });
  assert.equal(result.status, 'succeeded');
  assert.equal(harness.sentImages.length, 2);
  assert.deepEqual(harness.sentImages.map((file) => file.contentType), ['image/png', 'image/jpeg']);
  assert.deepEqual(harness.sentText, [`图片备注：${harness.order.itemId} / 商品详情文本 / 买家小明 / ${harness.account.id}`]);
});

test('API 5xx 与 408 会按配置重试，最终成功后才发货', async () => {
  let attempts = 0;
  const server = createServer((_request, response) => {
    attempts += 1;
    if (attempts === 1) { response.statusCode = 500; response.end('temporary-500'); return; }
    if (attempts === 2) { response.statusCode = 408; response.end('temporary-408'); return; }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ content: 'RETRIED-CARD' }));
  });
  await listen(server);
  try {
    const harness = await createHarness({ purpose: 'api', metadata: { apiConfig: { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/retry`, method: 'GET', timeout: 1 } } });
    const result = await harness.workflow.handlePaymentPaid({ adminId: harness.admin.id, config: paidConfig([harness.batch.id]), order: harness.order, eventId: 'api-retry-event' });
    assert.equal(result.status, 'succeeded');
    assert.equal(attempts, 3);
    assert.deepEqual(harness.sentText, ['RETRIED-CARD']);
  } finally { await close(server); }
});

test('API 超时返回失败且不会发送空卡券', async () => {
  const server = createServer((_request, response) => { setTimeout(() => { response.end(JSON.stringify({ content: 'TOO-LATE' })); }, 1_500); });
  await listen(server);
  try {
    const harness = await createHarness({ purpose: 'api', metadata: { apiConfig: { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/timeout`, method: 'GET', timeout: 1 } } });
    const result = await harness.workflow.handlePaymentPaid({ adminId: harness.admin.id, config: paidConfig([harness.batch.id]), order: harness.order, eventId: 'api-timeout-event' });
    assert.equal(result.status, 'manual_review');
    assert.match(result.reason ?? '', /ABORT|TIMEOUT|FETCH|REMOTE_20|unknown/u);
    assert.deepEqual(harness.sentText, []);
  } finally { await close(server); }
});

test('多规格卡券精确匹配，不匹配时拒绝发货', async () => {
  const harness = await createHarness({ purpose: 'text', metadata: { multiSpec: true, specName: '颜色', specValue: '红色', textContent: '红色卡券' }, skuSpec: '颜色:红色' });
  const blue = await harness.store.createCouponBatch({ adminId: harness.admin.id, accountId: harness.account.id, label: '蓝色卡券', purpose: 'text', deliveryScope: 'buyer_deliverable', metadata: { multiSpec: true, specName: '颜色', specValue: '蓝色', textContent: '蓝色卡券' } });
  const matched = await harness.workflow.handlePaymentPaid({ adminId: harness.admin.id, config: paidConfig([harness.batch.id, blue.id]), order: harness.order, eventId: 'spec-red-event' });
  assert.equal(matched.status, 'succeeded');
  assert.deepEqual(harness.sentText, ['红色卡券']);
  const mismatched = await harness.workflow.handlePaymentPaid({ adminId: harness.admin.id, config: paidConfig([harness.batch.id, blue.id]), order: { ...harness.order, orderNo: `${harness.order.orderNo}-blue`, skuSpec: '颜色:绿色' }, eventId: 'spec-green-event' });
  assert.equal(mismatched.status, 'failed');
  assert.equal(mismatched.reason, 'COUPON_SPEC_MISMATCH');
});

test('无需邮寄凭证只对真实发货生效，评价赠品强制忽略该配置', async () => {
  const delivery = await createHarness({ metadata: { textContent: '免邮凭证', useNoLogisticsForm: true } });
  const deliveryResult = await delivery.workflow.handlePaymentPaid({ adminId: delivery.admin.id, config: paidConfig([delivery.batch.id], { autoConfirm: true }), order: delivery.order, eventId: 'no-logistics-delivery' });
  assert.equal(deliveryResult.status, 'succeeded');
  assert.deepEqual(delivery.sentText, []);
  assert.deepEqual(delivery.shipmentCalls, ['免邮凭证']);

  const gift = await createHarness({ metadata: { textContent: '赠品内容', useNoLogisticsForm: true } });
  const giftConfig = paidConfig([], { autoConfirm: false });
  giftConfig.paidAutoDelivery.enabled = false;
  giftConfig.reviewGift = { enabled: true, couponBatchIds: [gift.batch.id], maxAttempts: 1, retryBackoffSeconds: 0 };
  const giftResult = await gift.workflow.handleReviewGift({ adminId: gift.admin.id, config: giftConfig, order: gift.order, eventId: 'gift-event' });
  assert.equal(giftResult.status, 'succeeded');
  assert.deepEqual(gift.sentText, ['赠品内容']);
  assert.deepEqual(gift.shipmentCalls, []);
});

test('非固定文字卡券开启无需邮寄凭证时拒绝真实发货', async () => {
  const harness = await createHarness({ purpose: 'image', metadata: { imageUrls: ['data:image/png;base64,aGVsbG8='], useNoLogisticsForm: true } });
  const result = await harness.workflow.handlePaymentPaid({ adminId: harness.admin.id, config: paidConfig([harness.batch.id], { autoConfirm: true }), order: harness.order, eventId: 'invalid-no-logistics-event' });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'NO_LOGISTICS_FORM_INVALID');
  assert.deepEqual(harness.sentText, []);
  assert.deepEqual(harness.sentImages, []);
  assert.deepEqual(harness.shipmentCalls, []);
});

async function listen(server: Server): Promise<void> { await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); }
async function close(server: Server): Promise<void> { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
