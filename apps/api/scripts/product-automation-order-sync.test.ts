import assert from 'node:assert/strict';
import test from 'node:test';
import { orderFingerprint, reviewTransitioned, shouldProcessObservedOrder } from '../src/product-automation-order-sync.js';

const order = (overrides: Record<string, unknown> = {}) => ({
  createdAt: '2026-09-25T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
  paymentStatus: 'unpaid',
  orderStatus: 'open',
  deliveryStatus: 'pending',
  afterSalesStatus: 'none',
  itemId: 'item-1',
  buyerId: 'buyer-1',
  buyerName: '买家',
  buyerNickname: '买家',
  productId: 'product-1',
  quantity: 1,
  skuSpec: undefined,
  reviewedAt: undefined,
  ...overrides,
});

test('new unpaid order is processed on the monitor first poll when created after startup', () => {
  const observed = order({ createdAt: '2026-09-25T00:00:30.000Z', updatedAt: '2026-09-25T00:00:30.000Z' });
  assert.equal(shouldProcessObservedOrder({ order: observed, accountInitialized: false, monitorStartedAt: Date.parse('2026-09-25T00:00:00.000Z') }), true);
});

test('historical order is seeded without replaying its automation on monitor startup', () => {
  const observed = order({ createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z' });
  assert.equal(shouldProcessObservedOrder({ order: observed, accountInitialized: false, monitorStartedAt: Date.parse('2026-09-25T00:00:00.000Z') }), false);
});

test('reviewedAt participates in the fingerprint and review transition', () => {
  const before = order();
  const after = order({ reviewedAt: '2026-09-25T01:00:00.000Z' });
  assert.notEqual(orderFingerprint(before), orderFingerprint(after));
  assert.equal(reviewTransitioned(before, after), true);
  assert.equal(reviewTransitioned(after, order({ reviewedAt: '2026-09-25T01:00:00.000Z' })), false);
});
