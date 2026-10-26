import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PostgresStore } from '../src/store-postgres.js';
import { testDatabase } from './invite-registration/test-support.mjs';

let database: Awaited<ReturnType<typeof testDatabase>>;
let DATABASE_URL: string;
test.before(async () => { database = await testDatabase(); DATABASE_URL = database.url; });
test.after(async () => { await database?.close(); });

test('Postgres risk episode, durable payment lease and delivery guard remain atomic', async () => {
  const first = new PostgresStore(DATABASE_URL);
  const second = new PostgresStore(DATABASE_URL);
  const admin = await first.createAdmin({ email: `payment-risk-${crypto.randomUUID()}@example.com`, passwordHash: 'hash', displayName: 'Integration' });
  const account = await first.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `seller-${crypto.randomUUID()}` });
  try {
    const risk = await first.recordAccountRisk({ adminId: admin.id, accountId: account.id, code: 'RGV587', source: 'sold.orders' });
    assert.equal(risk?.status, 'verification_required');
    await second.updateAccount(admin.id, account.id, { status: 'connected' });
    assert.equal((await first.getAccount(admin.id, account.id))?.status, 'verification_required');
    const episode = risk?.riskEpisode ?? '';
    await first.clearAccountRisk({ adminId: admin.id, accountId: account.id, episode, source: 'login', startedAt: new Date(Date.now() + 1000).toISOString() });
    await first.clearAccountRisk({ adminId: admin.id, accountId: account.id, episode, source: 'sold.orders', startedAt: '2026-01-01T00:00:00.000Z' });
    assert.equal((await second.getAccount(admin.id, account.id))?.status, 'verification_required');
    await first.clearAccountRisk({ adminId: admin.id, accountId: account.id, episode, source: 'sold.orders', startedAt: new Date(Date.now() + 1000).toISOString() });
    assert.equal((await second.getAccount(admin.id, account.id))?.status, 'disconnected', 'MTOP success does not prove IM transport is online');
    await first.setAccountTransport({ adminId: admin.id, accountId: account.id, status: 'connected' });
    assert.equal((await second.getAccount(admin.id, account.id))?.status, 'connected');
    await first.pool.query("update accounts.accounts set transport_seen_at=now()-interval '20 seconds' where id=$1", [account.id]);
    assert.equal((await second.getAccount(admin.id, account.id))?.status, 'disconnected');
    assert.equal((await second.listAccounts(admin.id, { connectionStatus: 'online' })).total, 0);
    assert.equal((await second.listAccounts(admin.id, { connectionStatus: 'offline' })).total, 1);
    await first.setAccountTransport({ adminId: admin.id, accountId: account.id, status: 'disconnected' });
    assert.equal((await second.getAccount(admin.id, account.id))?.status, 'disconnected');
    await first.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=expired', expiresAt: new Date(Date.now() - 1000).toISOString() });
    assert.equal((await second.getCredential(admin.id, account.id))?.status, 'expired');
    assert.equal((await first.getAccount(admin.id, account.id))?.status, 'expired');
    await first.updateAccount(admin.id, account.id, { status: 'disconnected' });
    await first.recordAccountDegraded({ adminId: admin.id, accountId: account.id, source: 'sold.orders' });
    await first.setAccountTransport({ adminId: admin.id, accountId: account.id, status: 'connected' });
    await second.updateAccount(admin.id, account.id, { status: 'connected' });
    assert.equal((await second.getAccount(admin.id, account.id))?.status, 'degraded');
    assert.equal((await second.listAccounts(admin.id, { status: 'connected' })).total, 0);
    assert.equal((await second.listAccounts(admin.id, { connectionStatus: 'unknown' })).total, 0);
    assert.equal((await second.listAccounts(admin.id, { connectionStatus: 'online' })).total, 1, 'fresh message heartbeat does not clear business degradation');
    await second.clearAccountDegraded({ adminId: admin.id, accountId: account.id, source: 'im', startedAt: new Date(Date.now() + 1000).toISOString() });
    assert.equal((await first.getAccount(admin.id, account.id))?.status, 'degraded');
    await second.clearAccountDegraded({ adminId: admin.id, accountId: account.id, source: 'sold.orders', startedAt: new Date(Date.now() + 1000).toISOString() });
    assert.equal((await first.getAccount(admin.id, account.id))?.status, 'connected');
    await first.recordAccountDegraded({ adminId: admin.id, accountId: account.id, source: 'order.detail' });
    const multiRisk = await first.recordAccountRisk({ adminId: admin.id, accountId: account.id, code: 'RGV587', source: 'sold.orders' });
    await second.recordAccountRisk({ adminId: admin.id, accountId: account.id, code: 'CAPTCHA', source: 'im' });
    await first.clearAccountRisk({ adminId: admin.id, accountId: account.id, episode: multiRisk!.riskEpisode!, source: 'im', startedAt: new Date(Date.now() + 1000).toISOString() });
    assert.equal((await second.getAccount(admin.id, account.id))?.status, 'verification_required');
    await second.clearAccountRisk({ adminId: admin.id, accountId: account.id, episode: multiRisk!.riskEpisode!, source: 'sold.orders', startedAt: new Date(Date.now() + 1000).toISOString() });
    assert.equal((await first.getAccount(admin.id, account.id))?.status, 'degraded');
    await first.clearAccountDegraded({ adminId: admin.id, accountId: account.id, source: 'order.detail', startedAt: new Date(Date.now() + 1000).toISOString() });
    assert.equal((await second.getAccount(admin.id, account.id))?.status, 'connected');
    assert.equal(await first.flushAccountRiskAlerts(10), 4);
    assert.equal(await second.flushAccountRiskAlerts(10), 0);
    const notifications = await second.listRiskNotifications(admin.id);
    assert.equal(notifications.length, 4);
    assert.equal(await first.acknowledgeRiskNotification(admin.id, notifications[0]!.id), true);
    assert.equal((await second.listRiskNotifications(admin.id)).length, 3);
    const audited = await first.pool.query("select count(*)::int as count from observability.audit_events where account_id=$1 and action like 'account.risk.%'", [account.id]);
    assert.equal(Number(audited.rows[0].count), 4);

    const input = { adminId: admin.id, accountId: account.id, eventRef: 'event-1', orderNo: '2503688126356636370', buyerRef: 'buyer-1', itemRef: 'item-1', conversationRef: 'conversation-1', receivedAt: new Date().toISOString() };
    const inserted = await first.enqueuePaymentEvent(input);
    assert.equal((await second.enqueuePaymentEvent(input)).id, inserted.id);
    const [a, b] = await Promise.all([first.claimPaymentEvents({ workerId: 'worker-a', limit: 1, leaseMs: 1000, accountId: account.id }), second.claimPaymentEvents({ workerId: 'worker-b', limit: 1, leaseMs: 1000, accountId: account.id })]);
    assert.equal(a.length + b.length, 1);
    const claimed = (a[0] ?? b[0])!;
    assert.equal(await first.finishPaymentEvent({ id: claimed.id, ownerToken: 'wrong', status: 'completed' }), false);
    assert.equal(await second.finishPaymentEvent({ id: claimed.id, ownerToken: claimed.ownerToken!, status: 'completed' }), true);
    assert.equal((await first.claimPaymentEvents({ workerId: 'worker-c', limit: 1, leaseMs: 1000, accountId: account.id })).length, 0);

    const step = { adminId: admin.id, accountId: account.id, orderNo: '2503688126356636370', executionKey: 'auto:order-1', stepKey: 'card:text:0' };
    const [claimA, claimB] = await Promise.all([first.beginDeliverySendStep(step), second.beginDeliverySendStep({ ...step, executionKey: 'manual:order-1' })]);
    assert.equal([claimA.status, claimB.status].filter((status) => status === 'ready').length, 1);
    const winner = claimA.status === 'ready' ? step : { ...step, executionKey: 'manual:order-1' };
    assert.equal(await first.completeDeliverySendStep({ ...winner, externalRef: 'message-1' }), true);
    assert.equal((await second.beginDeliverySendStep(winner)).status, 'succeeded');
    assert.equal((await second.beginDeliverySendStep({ ...winner, executionKey: winner.executionKey === step.executionKey ? 'manual:order-1' : step.executionKey })).status, 'blocked');
    await first.saveDeliveryConfirmation({ adminId: admin.id, accountId: account.id, orderNo: 'snapshot-order', executionKey: 'snapshot-execution', noLogisticsForm: true, tradeText: 'SECRET-FORM-TEXT' });
    const snapshot = await second.getDeliveryConfirmation({ adminId: admin.id, accountId: account.id, orderNo: 'snapshot-order', executionKey: 'snapshot-execution' });
    assert.deepEqual(snapshot, { noLogisticsForm: true, tradeText: 'SECRET-FORM-TEXT' });
    const ciphertext = await first.pool.query('select trade_text_ciphertext from orders.delivery_confirmation_snapshots where account_id=$1', [account.id]);
    assert.equal(Buffer.from(ciphertext.rows[0].trade_text_ciphertext).includes(Buffer.from('SECRET-FORM-TEXT')), false);
  } finally {
    await first.pool.query('delete from orders.delivery_confirmation_snapshots where account_id=$1', [account.id]);
    await first.pool.query('delete from orders.delivery_send_steps where account_id=$1', [account.id]);
    await first.pool.query('delete from orders.delivery_send_guards where account_id=$1', [account.id]);
    await first.pool.query('delete from orders.payment_event_jobs where account_id=$1', [account.id]);
    await first.pool.query('delete from accounts.risk_notifications where account_id=$1', [account.id]);
    await first.pool.query('delete from accounts.risk_alert_outbox where account_id=$1', [account.id]);
    await first.pool.query('delete from accounts.health_signals where account_id=$1', [account.id]);
    await first.pool.query('delete from observability.audit_events where account_id=$1', [account.id]);
    await first.pool.query('delete from auth.account_credentials where account_id=$1', [account.id]);
    await first.pool.query('delete from auth.account_scopes where account_id=$1', [account.id]);
    await first.pool.query('delete from accounts.accounts where id=$1', [account.id]);
    await first.pool.query('delete from auth.admins where id=$1', [admin.id]);
    await first.close();
    await second.close();
  }
});

test('cutover guards legacy successful coupon delivery still shown as pending by platform', async () => {
  const store = new PostgresStore(DATABASE_URL);
  const admin = await store.createAdmin({ email: `legacy-delivery-${crypto.randomUUID()}@example.com`, passwordHash: 'hash', displayName: 'Legacy' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `legacy-${crypto.randomUUID()}` });
  const orderNo = `legacy-${crypto.randomUUID()}`;
  const failedOrderNo = `failed-${crypto.randomUUID()}`;
  const cancelledOrderNo = `cancelled-${crypto.randomUUID()}`;
  const releasedOrderNo = `released-${crypto.randomUUID()}`;
  const ledgerOrderNo = `ledger-${crypto.randomUUID()}`;
  const skippedOrderNo = `skipped-${crypto.randomUUID()}`;
  const postCutoverOrderNo = `post-cutover-${crypto.randomUUID()}`;
  const ledgerKey = `paid_auto_delivery:${account.id}:${ledgerOrderNo}`;
  const skippedKey = `paid_auto_delivery:${account.id}:${skippedOrderNo}`;
  const postCutoverKey = `paid_auto_delivery:${account.id}:${postCutoverOrderNo}`;
  const releasedKey = `manual-delivery:${account.id}:${releasedOrderNo}`;
  try {
    const order = await store.createOrder({ adminId: admin.id, order: { orderNo, accountId: account.id, buyerId: 'buyer-legacy', buyerName: 'Buyer', itemId: 'item-legacy', itemTitle: 'Coupon', amountMinor: 100, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', source: 'xianyu' } });
    const record = await store.createDeliveryRecord({ adminId: admin.id, orderId: order.id, orderNo, accountId: account.id, deliveryType: 'coupon_only', idempotencyScope: `legacy:${account.id}`, idempotencyKey: orderNo, attempt: 1 });
    await store.updateDeliveryRecord({ adminId: admin.id, id: record.id, status: 'succeeded', externalOutcome: 'known_success', externalRef: 'legacy-message' });
    const failedOrder = await store.createOrder({ adminId: admin.id, order: { orderNo: failedOrderNo, accountId: account.id, buyerId: 'buyer-failed', buyerName: 'Buyer', itemId: 'item-failed', itemTitle: 'Coupon', amountMinor: 100, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', source: 'xianyu' } });
    const failedRecord = await store.createDeliveryRecord({ adminId: admin.id, orderId: failedOrder.id, orderNo: failedOrderNo, accountId: account.id, deliveryType: 'coupon_only', idempotencyScope: `legacy:${account.id}`, idempotencyKey: failedOrderNo, attempt: 1 });
    await store.updateDeliveryRecord({ adminId: admin.id, id: failedRecord.id, status: 'failed', externalOutcome: 'known_failure' });
    const cancelledOrder = await store.createOrder({ adminId: admin.id, order: { orderNo: cancelledOrderNo, accountId: account.id, buyerId: 'buyer-cancelled', buyerName: 'Buyer', itemId: 'item-cancelled', itemTitle: 'No logistics', amountMinor: 100, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'no_logistics', source: 'xianyu' } });
    const cancelledRecord = await store.createDeliveryRecord({ adminId: admin.id, orderId: cancelledOrder.id, orderNo: cancelledOrderNo, accountId: account.id, deliveryType: 'no_logistics', idempotencyScope: `legacy:${account.id}`, idempotencyKey: cancelledOrderNo, attempt: 1 });
    await store.updateDeliveryRecord({ adminId: admin.id, id: cancelledRecord.id, status: 'failed', externalOutcome: 'known_failure' });
    await store.updateDeliveryRecord({ adminId: admin.id, id: cancelledRecord.id, status: 'cancelled', externalOutcome: 'known_failure' });
    await store.pool.query("insert into automation.execution_ledger(execution_key,fingerprint,status,result_json) values($1,'legacy','completed',$2::jsonb)", [ledgerKey, JSON.stringify({ status: 'failed', reason: 'coupon_send_failed' })]);
    await store.pool.query("insert into automation.execution_ledger(execution_key,fingerprint,status,result_json) values($1,'legacy','completed',$2::jsonb)", [skippedKey, JSON.stringify({ status: 'skipped', reason: 'rule_disabled' })]);
    await store.pool.query("insert into coupons.coupon_reservations(admin_id,account_id,execution_key,purpose,batch_ids,fingerprint,quantity,status,lease_until) values($1,$2,$3,'delivery',$4::uuid[],'legacy',1,'released',now())", [admin.id, account.id, releasedKey, [crypto.randomUUID()]]);
    const migration = await readFile(new URL('../migrations/060_delivery_cutover_backfill.sql', import.meta.url), 'utf8');
    const client = await store.pool.connect();
    try {
      await client.query('begin');
      try {
        await client.query('update orders.delivery_cutover_gate set active=false where id=true');
        await client.query(migration);
        const guards = await client.query('select order_no,status from orders.delivery_send_guards where account_id=$1', [account.id]);
        assert.deepEqual(new Set(guards.rows.filter((row) => row.status === 'unknown').map((row) => row.order_no)), new Set([orderNo, failedOrderNo, cancelledOrderNo, releasedOrderNo, ledgerOrderNo]));
        const job = await client.query('select status from orders.payment_event_jobs where account_id=$1 and order_no=$2', [account.id, orderNo]);
        assert.equal(job.rows[0]?.status, 'pending');
      } finally {
        await client.query('rollback');
      }

      await store.pool.query("insert into automation.execution_ledger(execution_key,fingerprint,status,result_json) values($1,'post-cutover','completed',$2::jsonb)", [postCutoverKey, JSON.stringify({ status: 'failed', reason: 'coupon_spec_mismatch' })]);
      await client.query('begin');
      try {
        await client.query('update orders.delivery_cutover_gate set active=true where id=true');
        await client.query(migration);
        const guards = await client.query('select order_no from orders.delivery_send_guards where account_id=$1', [account.id]);
        assert.deepEqual(guards.rows, [], 'repeat migration must not fence skipped or failed-before-send executions');
      } finally {
        await client.query('rollback');
      }
    } finally {
      client.release();
    }
  } finally {
    await store.pool.query('delete from orders.delivery_send_steps where account_id=$1', [account.id]);
    await store.pool.query('delete from orders.delivery_send_guards where account_id=$1', [account.id]);
    await store.pool.query('delete from orders.payment_event_jobs where account_id=$1', [account.id]);
    await store.pool.query('delete from coupons.coupon_reservations where account_id=$1', [account.id]);
    await store.pool.query('delete from automation.execution_ledger where execution_key=any($1::text[])', [[ledgerKey, skippedKey, postCutoverKey]]);
    await store.pool.query('delete from orders.delivery_records where account_id=$1', [account.id]);
    await store.pool.query('delete from orders.orders where account_id=$1', [account.id]);
    await store.pool.query('delete from auth.account_scopes where account_id=$1', [account.id]);
    await store.pool.query('delete from accounts.accounts where id=$1', [account.id]);
    await store.pool.query('delete from auth.admins where id=$1', [admin.id]);
    await store.close();
  }
});
