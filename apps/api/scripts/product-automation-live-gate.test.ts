import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import type { AutomationExecutionPort, AutomationExternalResult, AutomationOrderSnapshot } from '../src/product-automation.js';
import { AutomationWorkflowService, ProductAutomationService, defaultProductAutomationConfig } from '../src/product-automation.js';
import { MemoryStore } from '../src/store-memory.js';
import { ProductAutomationTrigger } from '../src/product-automation-trigger.js';
import {
  normalizeAutomationBuyerName,
  parseProductAutomationBuyerAllowlist,
  type ProductAutomationLiveConfig,
} from '../src/product-automation-live-gate.js';

class CountingPort implements AutomationExecutionPort {
  readonly calls: string[] = [];
  async reserveCoupon(): Promise<{ reservationId: string; quantity: number }> { this.calls.push('reserve'); return { reservationId: 'reservation-1', quantity: 1 }; }
  async sendCoupon(): Promise<AutomationExternalResult> { this.calls.push('send'); return { status: 'succeeded', externalRef: 'external-1' }; }
  async commitCoupon(): Promise<void> { this.calls.push('commit'); }
  async releaseCoupon(): Promise<void> { this.calls.push('release'); }
  async confirmShipment(): Promise<AutomationExternalResult> { this.calls.push('confirm'); return { status: 'succeeded', externalRef: 'shipment-1' }; }
  async repriceOrder(): Promise<AutomationExternalResult> { this.calls.push('reprice'); return { status: 'succeeded', externalRef: 'reprice-1' }; }
  async sendText(): Promise<AutomationExternalResult> { this.calls.push('text'); return { status: 'succeeded', externalRef: 'message-1' }; }
  async persistReviewFact(): Promise<{ created: boolean }> { this.calls.push('review-fact'); return { created: true }; }
  async readOrder(): Promise<AutomationOrderSnapshot | undefined> { this.calls.push('read-order'); return undefined; }
  async markManualReview(): Promise<void> { this.calls.push('manual-review'); }
}

function liveGate(overrides: Partial<ProductAutomationLiveConfig> = {}): ProductAutomationLiveConfig {
  return {
    executionMode: 'live',
    liveConfirmed: true,
    buyerAllowlist: ['买家'],
    ...overrides,
  };
}

function order(overrides: Partial<AutomationOrderSnapshot> = {}): AutomationOrderSnapshot {
  return {
    id: 'order-1', orderNo: 'ORDER-1', accountId: 'account-1', buyerId: 'buyer-1', buyerName: '买家', itemId: 'item-1', itemTitle: '未授权商品', amountMinor: 1000,
    paymentStatus: 'unpaid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', configVersion: 1, source: 'local', productId: 'product-1', conversationId: 'conversation-1', ...overrides,
  };
}

test('product automation live config defaults to blocked with an empty buyer allowlist', () => {
  const config = loadConfig({});
  assert.equal(config.productAutomationExecutionMode, 'simulate');
  assert.equal(config.productAutomationLiveConfirmed, false);
  assert.deepEqual(config.buyerAllowlist, []);
});

test('product automation reuses the buyer allowlist and normalizes presentation whitespace', () => {
  const config = loadConfig({
    PRODUCT_AUTOMATION_EXECUTION_MODE: 'live',
    PRODUCT_AUTOMATION_LIVE_CONFIRMED: 'true',
    AUTOMATION_BUYER_ALLOWLIST: '[" 买家\\nA ", "买家 A"]',
  });
  assert.equal(config.productAutomationExecutionMode, 'live');
  assert.equal(config.productAutomationLiveConfirmed, true);
  assert.deepEqual(config.buyerAllowlist, ['买家 A']);
  assert.equal(normalizeAutomationBuyerName(' 买家\nA '), '买家 A');
  assert.deepEqual(parseProductAutomationBuyerAllowlist('[" 买家 ", "买家"]'), ['买家']);
});

test('live product automation opens to every buyer when the allowlist is empty', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'live-gate-open@example.com', passwordHash: 'hash', displayName: 'Live Gate Open' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'live-gate-open-account' });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, title: '任意商品标题', status: 'published' });
  const configs = new ProductAutomationService(store, async () => 'audit');
  const automationConfig = defaultProductAutomationConfig();
  automationConfig.unpaidAutoReprice = { ...automationConfig.unpaidAutoReprice, enabled: true, targetPriceMinor: 880 };
  await configs.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config: automationConfig, requestId: 'config', traceId: 'config' });

  const port = new CountingPort();
  port.readOrder = async () => { port.calls.push('read-order'); return order({ accountId: account.id, productId: product.id, buyerName: '任意买家' }); };
  const adapter = Object.assign(port, { readiness: 'ready' as const });
  const trigger = new ProductAutomationTrigger(store, configs, new AutomationWorkflowService(port), adapter, undefined, liveGate({ buyerAllowlist: [] }));
  const result = await trigger.onOrderRefresh({ adminId: admin.id, accountId: account.id, items: [order({ accountId: account.id, productId: product.id, buyerName: '任意买家', paymentStatus: 'unpaid' })], requestId: 'refresh', traceId: 'refresh' });

  assert.equal(result.results[0]?.status, 'succeeded');
  assert.deepEqual(port.calls, ['read-order', 'reprice']);
});

test('invalid buyer allowlist fails closed', () => {
  assert.throws(
    () => parseProductAutomationBuyerAllowlist('["valid", 123]'),
    /PRODUCT_AUTOMATION_BUYER_ALLOWLIST_INVALID/,
  );
});

test('non-whitelist buyer is blocked before any external side effect', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'live-gate@example.com', passwordHash: 'hash', displayName: 'Live Gate' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'live-gate-account' });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, title: '任意商品标题！！', status: 'published' });
  const configs = new ProductAutomationService(store, async () => 'audit');
  const automationConfig = defaultProductAutomationConfig();
  automationConfig.unpaidAutoReprice = { ...automationConfig.unpaidAutoReprice, enabled: true, targetPriceMinor: 880 };
  await configs.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config: automationConfig, requestId: 'config', traceId: 'config' });

  const port = new CountingPort();
  const adapter = Object.assign(port, { readiness: 'ready' as const });
  const trigger = new ProductAutomationTrigger(store, configs, new AutomationWorkflowService(port), adapter, undefined, liveGate());
  const result = await trigger.onOrderRefresh({ adminId: admin.id, accountId: account.id, items: [order({ accountId: account.id, productId: product.id, buyerName: '其他买家', itemTitle: '任意商品标题！！' })], requestId: 'refresh', traceId: 'refresh' });

  assert.equal(result.results[0]?.status, 'blocked');
  assert.equal(result.results[0]?.reason, 'PRODUCT_AUTOMATION_BUYER_NOT_ALLOWLISTED');
  assert.deepEqual(port.calls, []);
});

test('allowlisted buyer is not blocked by product title', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'live-gate-buyer@example.com', passwordHash: 'hash', displayName: 'Live Gate Buyer' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'live-gate-buyer-account' });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, title: '2026年奥维高清地图骗局！！', status: 'published' });
  const configs = new ProductAutomationService(store, async () => 'audit');
  const automationConfig = defaultProductAutomationConfig();
  automationConfig.unpaidAutoReprice = { ...automationConfig.unpaidAutoReprice, enabled: true, targetPriceMinor: 880 };
  await configs.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config: automationConfig, requestId: 'config', traceId: 'config' });

  const port = new CountingPort();
  const before = order({ accountId: account.id, productId: product.id, buyerName: '买家', itemTitle: '2026年奥维高清地图骗局！！', paymentStatus: 'unpaid' });
  port.readOrder = async () => { port.calls.push('read-order'); return before; };
  const adapter = Object.assign(port, { readiness: 'ready' as const });
  const trigger = new ProductAutomationTrigger(store, configs, new AutomationWorkflowService(port), adapter, undefined, liveGate());
  const result = await trigger.onOrderRefresh({ adminId: admin.id, accountId: account.id, items: [order({ accountId: account.id, productId: product.id, buyerName: '买家', itemTitle: '2026年奥维高清地图骗局！！', paymentStatus: 'unpaid' })], requestId: 'refresh', traceId: 'refresh' });

  assert.equal(result.results[0]?.status, 'succeeded');
  assert.deepEqual(port.calls, ['read-order', 'reprice']);
});

test('live mode without explicit confirmation is blocked before allowlist evaluation', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'live-gate-confirm@example.com', passwordHash: 'hash', displayName: 'Live Gate Confirm' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'live-gate-confirm-account' });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, title: '任意商品标题', status: 'published' });
  const configs = new ProductAutomationService(store, async () => 'audit');
  const automationConfig = defaultProductAutomationConfig();
  automationConfig.unpaidAutoReprice = { ...automationConfig.unpaidAutoReprice, enabled: true, targetPriceMinor: 880 };
  await configs.update({ adminId: admin.id, productId: product.id, expectedConfigVersion: 1, config: automationConfig, requestId: 'config', traceId: 'config' });

  const port = new CountingPort();
  const adapter = Object.assign(port, { readiness: 'ready' as const });
  const trigger = new ProductAutomationTrigger(store, configs, new AutomationWorkflowService(port), adapter, undefined, liveGate({ liveConfirmed: false }));
  const result = await trigger.onOrderRefresh({ adminId: admin.id, accountId: account.id, items: [order({ accountId: account.id, productId: product.id, itemTitle: '任意商品标题' })], requestId: 'refresh', traceId: 'refresh' });

  assert.equal(result.results[0]?.status, 'blocked');
  assert.equal(result.results[0]?.reason, 'PRODUCT_AUTOMATION_LIVE_CONFIRMATION_REQUIRED');
  assert.deepEqual(port.calls, []);
});
