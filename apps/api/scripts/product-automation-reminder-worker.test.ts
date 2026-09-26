import assert from 'node:assert/strict';
import test from 'node:test';
import type { Store } from '../src/domain.js';
import { ProductAutomationReminderWorker } from '../src/product-automation-reminder-worker.js';

test('reminder worker polls recoverable accounts and skips only unusable accounts', async () => {
  const calls: Array<{ adminId: string; accountId: string; now: string }> = [];
  const store = {
    listAdminIds: async () => ['active-admin', 'disabled-admin'],
    findAdminById: async (adminId: string) => ({ id: adminId, status: adminId === 'active-admin' ? 'active' : 'disabled' }),
    listAccounts: async (adminId: string) => ({ items: adminId === 'active-admin' ? [
      { id: 'connected-account', status: 'connected' },
      { id: 'disconnected-account', status: 'disconnected' },
      { id: 'degraded-account', status: 'degraded' },
      { id: 'pending-account', status: 'pending' },
    ] : [], page: 1, pageSize: 100, total: 2, totalPages: 1 }),
  } as unknown as Store;
  const automation = { pollReviewReminders: async (input: { adminId: string; accountId: string; now: string }) => { calls.push(input); return { processed: 1, results: [] }; } } as any;
  const worker = new ProductAutomationReminderWorker(store, automation, { pollMs: 5_000 });
  const result = await worker.pollOnce('2026-09-25T02:00:00.000Z');
  assert.equal(result.processed, 0);
  assert.deepEqual(calls, [
    { adminId: 'active-admin', accountId: 'connected-account', now: '2026-09-25T02:00:00.000Z' },
    { adminId: 'active-admin', accountId: 'disconnected-account', now: '2026-09-25T02:00:00.000Z' },
    { adminId: 'active-admin', accountId: 'degraded-account', now: '2026-09-25T02:00:00.000Z' },
  ]);
});

test('disabled reminder worker performs no polling', async () => {
  let called = false;
  const store = { listAdminIds: async () => { called = true; return []; } } as unknown as Store;
  const worker = new ProductAutomationReminderWorker(store, {} as any, { enabled: false });
  assert.deepEqual(await worker.pollOnce(), { processed: 0, results: [] });
  assert.equal(called, false);
});
