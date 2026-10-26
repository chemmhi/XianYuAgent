import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PostgresStore } from '../src/store-postgres.js';
import { AutomationWorkflowService, PersistentAutomationExecutionLedger } from '../src/product-automation.js';
import { XianyuProductAutomationExecutionAdapter } from '../src/product-automation-xianyu.js';
import type { XianyuImService } from '../src/xianyu-im-service.js';
import type { XianyuMtopClient } from '../src/xianyu-mtop.js';

const DATABASE_URL = process.env.RECORD_RETENTION_TEST_DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';

test('verified partial delivery restores only its image checkpoint and queues missing content once', async () => {
  const store = new PostgresStore(DATABASE_URL);
  const admin = await store.createAdmin({ email: `partial-delivery-${crypto.randomUUID()}@example.com`, passwordHash: 'hash', displayName: 'Recovery' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `seller-${crypto.randomUUID()}` });
  const orderNo = `partial-${crypto.randomUUID()}`;
  const executionKey = `paid_auto_delivery:${account.id}:${orderNo}`;
  try {
    const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer', externalConversationRef: 'external-conversation' });
    const product = await store.createProduct({ adminId: admin.id, accountId: account.id, externalProductRef: 'item', title: 'Item' });
    await store.createOrder({ adminId: admin.id, order: { orderNo, accountId: account.id, buyerId: 'buyer', buyerName: 'Buyer', itemId: 'item', itemTitle: 'Item', amountMinor: 100, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', conversationId: conversation.id, productId: product.id } });
    const batch = await store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: 'Card', purpose: 'text', metadata: { textContent: 'secret card', imageUrls: ['data:image/png;base64,aGVsbG8='] } });
    const reservation = await store.reserveCoupon({ adminId: admin.id, accountId: account.id, batchIds: [batch.id], quantity: 1, executionKey, purpose: 'delivery' });
    const stepKey = `${reservation.items[0]!.itemId}:image:0`;
    const input = { adminId: admin.id, accountId: account.id, orderNo, executionKey, stepKey };
    assert.equal((await store.beginDeliverySendStep(input)).status, 'ready');
    await store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'outbound', senderRole: 'agent', bodyType: 'image', bodyRef: 'https://example.test/image.png', externalMessageRef: 'image.PNM' });
    await store.markDeliverySendUnknown(input);
    assert.equal(await store.quarantineCouponReservation({ adminId: admin.id, executionKey, reason: 'DELIVERY_SEND_RESULT_UNKNOWN' }), true);
    await store.pool.query(`insert into automation.execution_ledger(execution_key,fingerprint,status,result_json,retryable,attempt_count)
      values($1,'fingerprint','completed',$2::jsonb,false,1)`, [executionKey, JSON.stringify({ status: 'manual_review', executionKey, reason: 'DELIVERY_SEND_RESULT_UNKNOWN' })]);
    await store.pool.query(`insert into orders.payment_event_jobs(admin_id,account_id,event_ref,order_no,buyer_ref,conversation_ref,status,received_at)
      values($1,$2,$3,$4,'buyer','external-conversation','manual_review',now())`, [admin.id, account.id, `event-${crypto.randomUUID()}`, orderNo]);

    await assert.rejects(() => store.resumeVerifiedPartialDelivery({ ...input, externalMessageRef: 'wrong.PNM' }), /IMAGE_EVIDENCE/);
    assert.equal((await store.getCouponReservation({ adminId: admin.id, reservationId: reservation.reservationId }))?.status, 'quarantined');
    await store.pool.query("update coupons.coupon_batches set updated_at=now()+interval '1 second' where id=$1", [batch.id]);
    await assert.rejects(() => store.resumeVerifiedPartialDelivery({ ...input, externalMessageRef: 'image.PNM' }), /COUPON_PLAN_CHANGED/);
    await store.pool.query("update coupons.coupon_batches set updated_at=(select created_at-interval '1 millisecond' from orders.delivery_send_steps where account_id=$2 and order_no=$3) where id=$1", [batch.id, account.id, orderNo]);

    await store.resumeVerifiedPartialDelivery({ ...input, externalMessageRef: 'image.PNM' });
    // Simulate the previous release: only audit evidence exists. The migration
    // must backfill it idempotently before all old audit records are deleted.
    await store.pool.query('update orders.delivery_send_steps set recovery_verified_at=null where account_id=$1', [account.id]);
    const migration = await readFile(new URL('../migrations/071_record_retention.sql', import.meta.url), 'utf8');
    await store.pool.query(migration);
    await store.pool.query(migration);
    assert.ok((await store.pool.query('select recovery_verified_at from orders.delivery_send_steps where account_id=$1', [account.id])).rows[0].recovery_verified_at);
    await store.pool.query("update observability.audit_events set created_at=now()-interval '4 days' where account_id=$1", [account.id]);
    await store.cleanupAuditEvents({ createdBefore: new Date(Date.now() - 3 * 86400_000).toISOString() });
    assert.equal((await store.pool.query('select count(*)::int count from observability.audit_events where account_id=$1', [account.id])).rows[0].count, 0);
    const state = await store.pool.query(`select s.status step_status,s.external_ref,g.status guard_status,r.status reservation_status,
      l.retryable,l.result_json->>'reason' ledger_reason,j.status job_status,j.attempt_count
      from orders.delivery_send_steps s join orders.delivery_send_guards g on g.account_id=s.account_id and g.order_no=s.order_no
      join coupons.coupon_reservations r on r.execution_key=s.execution_key
      join automation.execution_ledger l on l.execution_key=s.execution_key
      join orders.payment_event_jobs j on j.account_id=s.account_id and j.order_no=s.order_no where s.account_id=$1 and s.order_no=$2`, [account.id, orderNo]);
    assert.deepEqual(state.rows[0], { step_status: 'succeeded', external_ref: 'image.PNM', guard_status: 'active', reservation_status: 'reserved', retryable: true, ledger_reason: 'DELIVERY_VERIFIED_PARTIAL_RESUME', job_status: 'pending', attempt_count: 0 });
    assert.deepEqual(await store.beginDeliverySendStep(input), { status: 'succeeded', externalRef: 'image.PNM' });
    await assert.rejects(() => store.resumeVerifiedPartialDelivery({ ...input, externalMessageRef: 'image.PNM' }), /GUARD_MISMATCH/);
    await store.pool.query("update coupons.coupon_reservations set lease_until=now()-interval '1 minute' where id=$1", [reservation.reservationId]);
    assert.equal(await store.bindDeliveryReservation({ adminId: admin.id, accountId: account.id, orderNo, reservationId: reservation.reservationId, executionKey }), true);
    assert.ok(Date.parse((await store.getCouponReservation({ adminId: admin.id, reservationId: reservation.reservationId }))!.leaseUntil) > Date.now());

    let imageSends = 0;
    const textSends: string[] = [];
    const im = {
      isReady: async () => true,
      sendImage: async () => { imageSends += 1; throw new Error('image must not replay'); },
      sendText: async (_admin: string, _account: string, _conversation: string, text: string) => { textSends.push(text); return { externalMessageRef: 'text.PNM' }; },
    } as unknown as XianyuImService;
    const mtop = {
      fetchOrderCandidates: async () => ({ success: true, items: [{ orderNo, buyerId: 'buyer', itemId: 'item', paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none' }] }),
      readOrderDetail: async () => ({ success: true, detail: { orderNo, buyerId: 'buyer', itemId: 'item', paymentStatus: 'paid', deliveryStatus: 'pending' } }),
    } as unknown as XianyuMtopClient;
    const adapter = new XianyuProductAutomationExecutionAdapter(store, () => mtop, () => im);
    const workflow = new AutomationWorkflowService(adapter, new PersistentAutomationExecutionLedger(store));
    let releasePlan!: () => void;
    let planReady!: () => void;
    const planEntered = new Promise<void>((resolve) => { planReady = resolve; });
    const planBlocked = new Promise<void>((resolve) => { releasePlan = resolve; });
    const holdingPlan = store.withVerifiedPartialDeliveryPlan({ accountId: account.id, orderNo, executionKey, reservationId: reservation.reservationId }, async () => {
      planReady();
      await planBlocked;
    });
    await planEntered;
    let editFinished = false;
    const edit = store.updateCouponBatch({ adminId: admin.id, batchId: batch.id, patch: { metadata: { textContent: 'wrong card', imageUrls: ['data:image/png;base64,aGVsbG8='] } } })
      .then(() => { editFinished = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(editFinished, false, 'coupon edits must wait until the send plan lock is released');
    } finally { releasePlan(); }
    await holdingPlan;
    await edit;
    const changed = await adapter.sendCoupon({ adminId: admin.id, accountId: account.id, orderNo, reservationId: reservation.reservationId, executionKey, purpose: 'delivery' });
    assert.equal(changed.errorCode, 'DELIVERY_RECOVERY_COUPON_PLAN_CHANGED');
    assert.deepEqual(textSends, []);
    assert.equal((await store.getCouponReservation({ adminId: admin.id, reservationId: reservation.reservationId }))?.status, 'quarantined');
    await store.pool.query(`update coupons.coupon_batches set metadata_json=$2::jsonb,
      updated_at=(select created_at-interval '1 millisecond' from orders.delivery_send_steps where account_id=$3 and order_no=$4) where id=$1`,
    [batch.id, JSON.stringify(batch.metadata), account.id, orderNo]);
    await store.pool.query("update coupons.coupon_reservations set status='reserved',reason=null where id=$1", [reservation.reservationId]);
    const configured = {
      paidAutoDelivery: { enabled: true, couponBatchIds: [batch.id], autoConfirm: false, maxAttempts: 1, retryBackoffSeconds: 300 },
      unpaidAutoReprice: { enabled: false, mode: 'fixed' as const, targetPriceMinor: 0, maxAttempts: 1, retryBackoffSeconds: 0 },
      reviewGift: { enabled: false, couponBatchIds: [], maxAttempts: 1, retryBackoffSeconds: 0 },
      reviewReminder: { enabled: false, firstDelayMinutes: 60, repeatIntervalMinutes: 60, maxReminders: 1, message: '' },
    };
    const order = await store.getOrder(admin.id, orderNo, account.id);
    assert.ok(order);
    const result = await workflow.handlePaymentPaid({ adminId: admin.id, config: configured, order, eventId: 'verified-resume' });
    assert.equal(result.status, 'succeeded');
    assert.equal(imageSends, 0);
    assert.deepEqual(textSends, ['secret card']);
    assert.equal((await store.getCouponReservation({ adminId: admin.id, reservationId: reservation.reservationId }))?.status, 'committed');
  } finally {
    await store.pool.query('delete from observability.audit_events where account_id=$1', [account.id]);
    await store.pool.query('delete from orders.payment_event_jobs where account_id=$1', [account.id]);
    await store.pool.query('delete from automation.execution_ledger where execution_key=$1', [executionKey]);
    await store.pool.query('delete from orders.delivery_send_steps where account_id=$1', [account.id]);
    await store.pool.query('delete from orders.delivery_send_guards where account_id=$1', [account.id]);
    await store.pool.query('delete from orders.delivery_confirmation_snapshots where account_id=$1', [account.id]);
    await store.pool.query('delete from coupons.coupon_reservation_items where reservation_id in (select id from coupons.coupon_reservations where account_id=$1)', [account.id]);
    await store.pool.query('delete from coupons.coupon_reservations where account_id=$1', [account.id]);
    await store.pool.query('delete from coupons.coupon_items where batch_id in (select id from coupons.coupon_batches where account_id=$1)', [account.id]);
    await store.pool.query('delete from coupons.coupon_batches where account_id=$1', [account.id]);
    await store.pool.query('delete from messages.events where account_id=$1', [account.id]);
    await store.pool.query('delete from messages.messages where account_id=$1', [account.id]);
    await store.pool.query('delete from orders.orders where account_id=$1', [account.id]);
    await store.pool.query('delete from products.products where account_id=$1', [account.id]);
    await store.pool.query('delete from messages.conversations where account_id=$1', [account.id]);
    await store.pool.query('delete from auth.account_scopes where account_id=$1', [account.id]);
    await store.pool.query('delete from accounts.accounts where id=$1', [account.id]);
    await store.pool.query('delete from auth.admins where id=$1', [admin.id]);
    await store.close();
  }
});
