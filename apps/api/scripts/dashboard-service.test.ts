import assert from 'node:assert/strict';
import test from 'node:test';
import { DashboardService } from '../src/dashboard.ts';
import { MemoryStore } from '../src/store-memory.ts';

test('DashboardService aggregates scoped accounts, orders, products, coupons and conversations', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'dashboard@example.com', passwordHash: 'hash', displayName: 'Dashboard Test' });
  const otherAdmin = await store.createAdmin({ email: 'other-dashboard@example.com', passwordHash: 'hash', displayName: 'Other Dashboard Test' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-dashboard', displayName: '测试闲鱼账号' });
  await store.updateAccount(admin.id, account.id, { status: 'connected' });
  const otherAccount = await store.createAccount({ adminId: otherAdmin.id, platform: 'xianyu', sellerRef: 'seller-other', displayName: '隔离账号' });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, title: '资料包', status: 'published' });
  const coupon = await store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: '资料包库存', purpose: 'data', deliveryScope: 'buyer_deliverable' });
  await store.importCouponItems({ adminId: admin.id, batchId: coupon.id, contents: ['A-001', 'A-002', 'A-003'] });

  const now = '2026-09-20T12:00:00.000Z';
  await store.createOrder({ adminId: admin.id, order: {
    orderNo: 'DASH-PAID', accountId: account.id, buyerId: 'buyer-1', buyerName: '买家一', itemId: 'item-1', itemTitle: product.title,
    productId: product.id, amountMinor: 12_900, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'delivered', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: now, updatedAt: now,
  } });
  await store.createOrder({ adminId: admin.id, order: {
    orderNo: 'DASH-PENDING', accountId: account.id, buyerId: 'buyer-2', buyerName: '买家二', itemId: 'item-1', itemTitle: product.title,
    productId: product.id, amountMinor: 5_000, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: now, updatedAt: now,
  } });
  await store.createOrder({ adminId: otherAdmin.id, order: {
    orderNo: 'DASH-OTHER', accountId: otherAccount.id, buyerId: 'buyer-other', buyerName: '其他买家', itemId: 'other-item', itemTitle: '不应出现',
    amountMinor: 99_900, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'delivered', afterSalesStatus: 'none', deliveryType: 'manual', createdAt: now, updatedAt: now,
  } });
  await store.upsertExternalConversation({ adminId: admin.id, accountId: account.id, externalConversationRef: 'dashboard-conversation', buyerRef: 'buyer-2', buyerDisplayName: '买家二', unreadCount: 2, lastMessagePreview: '请尽快发货', lastMessageAt: now });

  const snapshot = await new DashboardService(store).getSnapshot(admin.id, new Date(now));
  assert.equal(snapshot.todayOrderAmount, 179);
  assert.equal(snapshot.autoProcessRate, 50);
  assert.equal(snapshot.pendingManualCount, 2);
  assert.equal(snapshot.availableCouponCount, 3);
  assert.equal(snapshot.trend.at(-1)?.orderAmount, 179);
  assert.equal(snapshot.productRank[0]?.title, '资料包');
  assert.equal(snapshot.productRank[0]?.orders, '2');
  assert.equal(snapshot.productRank[0]?.stock, '3');
  assert.ok(snapshot.recentActivity.some((item) => item.text.includes('DASH-PENDING')));
  assert.ok(snapshot.riskTodos.some((item) => item.id.startsWith('order-')));
  assert.ok(snapshot.riskTodos.some((item) => item.id.startsWith('conversation-')));
  assert.ok(!JSON.stringify(snapshot).includes('DASH-OTHER'));
});
