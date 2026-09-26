import assert from 'node:assert/strict';
import test from 'node:test';
import type { Store } from '../src/domain.js';
import { ProductAutomationOrderRefreshWorker } from '../src/product-automation-order-worker.js';

test('order refresh worker refreshes degraded accounts and cleans expired reservations', async () => {
  const calls: Array<{ adminId: string; accountId: string; pageSize?: number; maxPages?: number; requestId: string }> = [];
  let cleaned = 0;
  const store = {
    cleanupExpiredCouponReservations: async () => 3,
    listAdminIds: async () => ['active-admin', 'disabled-admin'],
    findAdminById: async (adminId: string) => ({ id: adminId, status: adminId === 'active-admin' ? 'active' : 'disabled' }),
    listAccounts: async (adminId: string) => ({ items: adminId === 'active-admin' ? [
      { id: 'connected-account', status: 'connected' },
      { id: 'degraded-account', status: 'degraded' },
      { id: 'disconnected-account', status: 'disconnected' },
      { id: 'expired-account', status: 'expired' },
    ] : [], page: 1, pageSize: 100, total: 4, totalPages: 1 }),
  } as unknown as Store;
  const worker = new ProductAutomationOrderRefreshWorker(store, async (input) => { calls.push(input); cleaned += 1; }, { pollMs: 5_000, pageSize: 50, maxPages: 4 });
  const result = await worker.pollOnce('2026-09-25T02:00:00.000Z');
  assert.equal(result.refreshedAccounts, 3);
  assert.equal(result.expiredReservations, 3);
  assert.equal(cleaned, 3);
  assert.equal(calls.every((call) => call.pageSize === 50 && call.maxPages === 4), true);
  assert.deepEqual(calls.map((call) => call.accountId), ['connected-account', 'degraded-account', 'disconnected-account']);
});

test('disabled order refresh worker performs no cleanup or refresh', async () => {
  let called = false;
  const store = { cleanupExpiredCouponReservations: async () => { called = true; return 1; }, listAdminIds: async () => { called = true; return []; } } as unknown as Store;
  const worker = new ProductAutomationOrderRefreshWorker(store, async () => { called = true; }, { enabled: false });
  assert.deepEqual(await worker.pollOnce(), { refreshedAccounts: 0, expiredReservations: 0 });
  assert.equal(called, false);
});
