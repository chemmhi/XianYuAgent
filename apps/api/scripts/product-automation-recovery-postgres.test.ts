import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresStore } from '../src/store-postgres.js';
import { AutomationWorkflowService, PersistentAutomationExecutionLedger, defaultProductAutomationConfig, type AutomationExecutionPort, type AutomationOrderSnapshot } from '../src/product-automation.js';

test('PostgreSQL automation recovery preserves durable deduplication and leases', async (t) => {
  const databaseUrl = process.env.AUTOMATION_RECOVERY_TEST_DATABASE_URL;
  assert.ok(databaseUrl, 'AUTOMATION_RECOVERY_TEST_DATABASE_URL is required');
  const parsed = new URL(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.pathname === '/automation_recovery_test', 'dedicated local test database required');
  const store = new PostgresStore(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });
  const ledger = () => new PersistentAutomationExecutionLedger(store);
  const success = { status: 'succeeded' as const, externalRef: 'test-ack' };
  const makeOrder = (patch: Partial<AutomationOrderSnapshot> = {}): AutomationOrderSnapshot => ({
    id: randomUUID(), orderNo: randomUUID(), accountId: randomUUID(), buyerId: 'buyer', buyerName: 'buyer', itemId: 'item', itemTitle: 'item', amountMinor: 1000,
    paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z', conversationId: 'conversation', configVersion: 1, source: 'local', ...patch,
  });
  const port = (order: AutomationOrderSnapshot, calls: string[]): AutomationExecutionPort => ({
    reserveCoupon: async (input) => { calls.push(`reserve:${input.purpose}`); return { reservationId: 'test-reservation', quantity: input.quantity }; },
    sendCoupon: async (input) => { calls.push(`coupon:${input.purpose}`); return success; },
    commitCoupon: async () => { calls.push('commit'); },
    releaseCoupon: async () => { calls.push('release'); },
    confirmShipment: async () => { calls.push('shipment'); return success; },
    repriceOrder: async () => { calls.push('reprice'); return success; },
    sendText: async () => { calls.push('text'); return success; },
    persistReviewFact: async () => ({ created: true }),
    readOrder: async () => order,
    markManualReview: async () => { calls.push('manual'); },
  });
  const seed = async (key: string, result: { status: string; reason?: string }, fingerprint = 'legacy-fingerprint') => {
    const ownerToken = randomUUID();
    await store.claimAutomationExecution({ executionKey: key, fingerprint, ownerToken, leaseUntil: new Date(Date.now() + 60_000).toISOString() });
    await store.completeAutomationExecution({ executionKey: key, ownerToken, result: { executionKey: key, ...result }, retryable: false });
  };
  try {
    await t.test('all four rules recover old disabled entries after restart, then execute only once', async () => {
      for (const kind of ['paid_auto_delivery', 'unpaid_auto_reprice', 'review_gift', 'review_reminder']) {
        const order = makeOrder(kind === 'unpaid_auto_reprice' ? { paymentStatus: 'unpaid' } : kind === 'review_reminder' ? { deliveryStatus: 'delivered' } : {});
        const key = `${kind}:${order.accountId}:${order.orderNo}${kind === 'review_reminder' ? ':0' : ''}`;
        await seed(key, { status: 'skipped', reason: 'rule_disabled' });
        await pool.query('update automation.execution_ledger set attempt_count=50 where execution_key=$1', [key]);
        const config = defaultProductAutomationConfig();
        config.paidAutoDelivery = { ...config.paidAutoDelivery, enabled: true, couponBatchIds: ['1'], maxAttempts: 1 };
        config.unpaidAutoReprice = { ...config.unpaidAutoReprice, enabled: true, targetPriceMinor: 800, maxAttempts: 1 };
        config.reviewGift = { ...config.reviewGift, enabled: true, couponBatchIds: ['1'], maxAttempts: 1 };
        config.reviewReminder = { ...config.reviewReminder, enabled: true, firstDelayMinutes: 1 };
        const calls: string[] = [];
        const invoke = () => {
          const workflow = new AutomationWorkflowService(port(order, calls), ledger());
          const input = { config, order, eventId: randomUUID() };
          return kind === 'paid_auto_delivery' ? workflow.handlePaymentPaid(input)
            : kind === 'unpaid_auto_reprice' ? workflow.handleUnpaidReprice(input)
              : kind === 'review_gift' ? workflow.handleReviewGift(input)
                : workflow.handleReviewReminder({ ...input, now: '2026-10-25T01:00:00.000Z' });
        };
        assert.equal((await invoke()).status, 'succeeded', kind);
        const callCount = calls.length;
        assert.equal((await invoke()).status, 'succeeded', kind);
        assert.equal(calls.length, callCount, `${kind} must not duplicate writes`);
        const saved = await store.getAutomationExecution(key);
        assert.equal(saved?.attemptCount, 1, 'old skips cannot exhaust the write retry budget');
        assert.equal((saved?.result as { status?: string })?.status, 'succeeded');
      }
    });

    await t.test('legacy not-due entries become due; concurrent workers send only once', async () => {
      const order = makeOrder({ deliveryStatus: 'delivered' });
      const key = `review_reminder:${order.accountId}:${order.orderNo}:0`;
      await seed(key, { status: 'skipped', reason: 'not_due_or_capped' });
      const config = defaultProductAutomationConfig();
      config.reviewReminder = { enabled: true, firstDelayMinutes: 10, repeatIntervalMinutes: 10, maxReminders: 2, message: 'review' };
      const calls: string[] = [];
      const invoke = (now: string) => new AutomationWorkflowService(port(order, calls), ledger()).handleReviewReminder({ config, order, now });
      assert.equal((await invoke('2026-10-25T00:01:00.000Z')).reason, 'not_due_or_capped');
      const results = await Promise.all([invoke('2026-10-25T00:10:00.000Z'), invoke('2026-10-25T00:10:00.000Z')]);
      assert.ok(results.every(result => result.status === 'succeeded'));
      assert.equal((await invoke('2026-10-25T00:11:00.000Z')).status, 'succeeded');
      assert.deepEqual(calls, ['text']);
    });

    await t.test('old successful reminder fingerprints are replayed without another send', async () => {
      const order = makeOrder({ deliveryStatus: 'delivered' });
      const key = `review_reminder:${order.accountId}:${order.orderNo}:0`;
      await seed(key, { status: 'succeeded' });
      const config = defaultProductAutomationConfig();
      config.reviewReminder.enabled = true;
      const calls: string[] = [];
      const result = await new AutomationWorkflowService(port(order, calls), ledger()).handleReviewReminder({ config, order, now: '2026-10-30T00:00:00.000Z' });
      assert.equal(result.status, 'succeeded');
      assert.deepEqual(calls, []);
    });

    await t.test('terminal outcomes and active leases cannot be reopened by changed input', async () => {
      for (const result of [{ status: 'succeeded' }, { status: 'manual_review' }, { status: 'unknown' }, { status: 'skipped', reason: 'review_already_recorded' }]) {
        const key = randomUUID();
        await seed(key, result);
        await assert.rejects(() => store.claimAutomationExecution({ executionKey: key, fingerprint: 'changed', ownerToken: randomUUID(), leaseUntil: new Date(Date.now()+60000).toISOString() }), /FINGERPRINT_CONFLICT/);
      }
      const key = randomUUID();
      const leaseUntil = new Date(Date.now()+60000).toISOString();
      await store.claimAutomationExecution({ executionKey: key, fingerprint: 'fp', ownerToken: 'owner', leaseUntil });
      assert.equal((await store.claimAutomationExecution({ executionKey: key, fingerprint: 'fp', ownerToken: 'other', leaseUntil })).claimed, false);
      await assert.rejects(() => store.completeAutomationExecution({ executionKey: key, ownerToken: 'other', result: success, retryable: false }), /OWNER_CONFLICT/);
    });
  } finally {
    await pool.end();
    await store.close();
  }
});
