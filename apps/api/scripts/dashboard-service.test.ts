import assert from 'node:assert/strict';
import test from 'node:test';
import { DashboardService } from '../src/dashboard.ts';
import { ServiceError } from '../src/services.ts';
import { MemoryStore } from '../src/store-memory.ts';

test('DashboardService aggregates scoped accounts, orders, products, coupons and conversations', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'dashboard@example.com', passwordHash: 'hash', displayName: 'Dashboard Test' });
  const otherAdmin = await store.createAdmin({ email: 'other-dashboard@example.com', passwordHash: 'hash', displayName: 'Other Dashboard Test' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-dashboard', displayName: '测试闲鱼账号' });
  await store.updateAccount(admin.id, account.id, { status: 'connected' });
  const secondAccount = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-dashboard-2', displayName: '第二个授权账号' });
  await store.updateAccount(admin.id, secondAccount.id, { status: 'expired' });
  const otherAccount = await store.createAccount({ adminId: otherAdmin.id, platform: 'xianyu', sellerRef: 'seller-other', displayName: '隔离账号' });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, title: '资料包', status: 'published' });
  await store.createProduct({ adminId: admin.id, accountId: secondAccount.id, title: '第二账号商品', status: 'published' });
  const coupon = await store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: '资料包交付配置', purpose: 'data' });
  await store.importCouponItems({ adminId: admin.id, batchId: coupon.id, contents: ['A-001', 'A-002', 'A-003'] });
  await store.bindCouponBatch({ adminId: admin.id, batchId: coupon.id, productId: product.id });
  const secondCoupon = await store.createCouponBatch({ adminId: admin.id, accountId: secondAccount.id, label: '第二账号交付配置', purpose: 'data' });
  await store.importCouponItems({ adminId: admin.id, batchId: secondCoupon.id, contents: ['B-001', 'B-002', 'B-003', 'B-004'] });

  const now = '2026-09-20T12:00:00.000Z';
  await store.createOrder({ adminId: admin.id, order: {
    orderNo: 'DASH-PAID', accountId: account.id, buyerId: 'buyer-1', buyerName: '买家一', itemId: 'item-1', itemTitle: product.title,
    productId: product.id, amountMinor: 12_900, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'delivered', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: now, updatedAt: now,
  } });
  await store.createOrder({ adminId: admin.id, order: {
    orderNo: 'DASH-PENDING', accountId: account.id, buyerId: 'buyer-2', buyerName: '买家二', itemId: 'item-1', itemTitle: product.title,
    productId: product.id, amountMinor: 5_000, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: now, updatedAt: now,
  } });
  await store.createOrder({ adminId: admin.id, order: {
    orderNo: 'DASH-UNPAID-TODAY', accountId: account.id, buyerId: 'buyer-unpaid-today', buyerName: '未付款买家', itemId: 'item-1', itemTitle: product.title,
    productId: product.id, amountMinor: 7_000, paymentStatus: 'unpaid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: now, updatedAt: now,
  } });
  await store.createOrder({ adminId: admin.id, order: {
    orderNo: 'DASH-OLD', accountId: account.id, buyerId: 'buyer-old', buyerName: '旧买家', itemId: 'item-old', itemTitle: '历史资料包',
    amountMinor: 8_000, paymentStatus: 'paid', orderStatus: 'completed', deliveryStatus: 'delivered', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z',
  } });
  await store.createOrder({ adminId: admin.id, order: {
    orderNo: 'DASH-UNPAID', accountId: account.id, buyerId: 'buyer-unpaid', buyerName: '未付款买家', itemId: 'item-unpaid', itemTitle: '未付款资料包',
    amountMinor: 7_000, paymentStatus: 'unpaid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: '2026-08-20T12:00:00.000Z', updatedAt: '2026-08-20T12:00:00.000Z',
  } });
  await store.createOrder({ adminId: admin.id, order: {
    orderNo: 'DASH-SAME-ADMIN-OTHER', accountId: secondAccount.id, buyerId: 'buyer-other-admin', buyerName: '第二账号买家', itemId: 'other-item', itemTitle: '不应跨账号出现',
    amountMinor: 88_800, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'delivered', afterSalesStatus: 'none', deliveryType: 'manual', createdAt: now, updatedAt: now,
  } });
  await store.createOrder({ adminId: otherAdmin.id, order: {
    orderNo: 'DASH-OTHER', accountId: otherAccount.id, buyerId: 'buyer-other', buyerName: '其他买家', itemId: 'other-item', itemTitle: '不应出现',
    amountMinor: 99_900, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'delivered', afterSalesStatus: 'none', deliveryType: 'manual', createdAt: now, updatedAt: now,
  } });
  await store.upsertExternalConversation({ adminId: admin.id, accountId: account.id, externalConversationRef: 'dashboard-conversation', buyerRef: 'buyer-2', buyerDisplayName: '买家二', unreadCount: 2, lastMessagePreview: '请尽快发货', lastMessageAt: now });
  await store.upsertExternalConversation({ adminId: admin.id, accountId: secondAccount.id, externalConversationRef: 'dashboard-conversation-other', buyerRef: 'buyer-other-admin', buyerDisplayName: '第二账号买家', unreadCount: 4, lastMessagePreview: '不应跨账号出现', lastMessageAt: now });

  const service = new DashboardService(store);
  await assert.rejects(() => service.getSnapshot(admin.id, new Date(now)), (error: unknown) => error instanceof ServiceError && error.statusCode === 422 && error.code === 'VALIDATION_FAILED');
  await assert.rejects(() => service.getSnapshot(admin.id, new Date(now), { accountId: 'not-authorized' }), (error: unknown) => error instanceof ServiceError && error.statusCode === 403 && error.code === 'FORBIDDEN');
  const snapshot = await service.getSnapshot(admin.id, new Date(now), { accountId: account.id });
  assert.equal(snapshot.totalSales, 259);
  assert.equal(snapshot.todayOrderAmount, 179);
  assert.equal(snapshot.selectedRangeSales, 179);
  assert.equal(snapshot.autoProcessRate, 50);
  assert.equal(snapshot.pendingManualCount, 2);
  assert.equal('availableCouponCount' in snapshot, false);
  assert.equal(snapshot.trend.at(-1)?.orderAmount, 249);
  assert.equal(snapshot.trend.at(-1)?.salesAmount, 179);
  assert.equal(snapshot.productRank[0]?.title, '资料包');
  assert.equal(snapshot.productRank[0]?.orders, '3');
  assert.equal(snapshot.productRank[0]?.status, '可交付');
  assert.equal(snapshot.productRank[0]?.subtitle, '虚拟资源 · 交付配置已就绪');
  assert.ok(snapshot.recentActivity.some((item) => item.text.includes('DASH-PENDING')));
  assert.ok(snapshot.riskTodos.some((item) => item.id.startsWith('order-')));
  assert.ok(snapshot.riskTodos.some((item) => item.id.startsWith('conversation-')));
  assert.ok(!JSON.stringify(snapshot).includes('DASH-SAME-ADMIN-OTHER'));
  assert.ok(!JSON.stringify(snapshot).includes('第二账号商品'));
  assert.ok(!JSON.stringify(snapshot).includes('第二账号买家'));
  assert.ok(!JSON.stringify(snapshot).includes(`account-${secondAccount.id}`));
  assert.ok(!JSON.stringify(snapshot).includes('DASH-OTHER'));

  const today = await service.getSnapshot(admin.id, new Date(now), { accountId: account.id, range: 'today' });
  assert.equal(today.selectedRangeSales, 179);
  assert.equal(today.trend.length, 24);
  assert.equal(today.trend[12]?.orderAmount, 249);
  assert.equal(today.trend[12]?.salesAmount, 179);

  const custom = await service.getSnapshot(admin.id, new Date(now), { accountId: account.id, range: 'custom', from: '2026-09-01', to: '2026-09-01' });
  assert.equal(custom.selectedRangeSales, 80);
  assert.equal(custom.trend.length, 24);
  assert.equal(custom.trend[12]?.orderAmount, 80);

  const threeDays = await service.getSnapshot(admin.id, new Date(now), { accountId: account.id, range: '3d' });
  assert.equal(threeDays.selectedRangeSales, 179);
  assert.equal(threeDays.trend.length, 3);
  assert.equal(threeDays.trend.at(-1)?.orderAmount, 249);
  assert.equal(threeDays.trend.at(-1)?.salesAmount, 179);
});
