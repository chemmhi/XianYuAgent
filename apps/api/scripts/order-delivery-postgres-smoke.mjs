import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { hashPassword } from '../dist/security.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const suffix = `${process.pid}-${Date.now()}`;
const email = `order-delivery-pg-${suffix}@example.com`;
let runtime;
let restarted;
let adminId;
let accountId;
let productId;
let batchId;
let orderNo;

function appConfig() {
  return {
    host: '127.0.0.1',
    port: 0,
    databaseUrl,
    redisUrl: '',
    cookieSecure: false,
    allowInMemory: false,
    sessionIdleMs: 1_800_000,
    sessionAbsoluteMs: 28_800_000,
    xianyuQrMode: 'stub',
    agentRuntime: 'in-process',
    modelTimeoutMs: 5_000,
    autoReplyModelEnabled: false,
    autoReplySendMode: 'simulate',
    buyerAllowlist: [],
    autoReplyRepairMode: 'enforce',
    autoReplyOutcomeReviewWorkerEnabled: false,
    autoReplyOutcomeReviewWorkerPollMs: 1_000,
    autoReplyOutcomeReviewWorkerBatchSize: 10,
    autoReplyOutcomeReviewWorkerLeaseSeconds: 60,
    credentialEncryptionKey: `order-delivery-pg-${suffix}`,
    objectStorageEndpoint: 'http://127.0.0.1:19000',
    objectStorageAccessKey: 'xianyu',
    objectStorageSecretKey: 'xianyu_dev_only',
    objectStorageBucket: 'xianyu-assets',
    objectStorageRegion: 'us-east-1',
  };
}

async function assertSchema(store) {
  const table = await store.pool.query(`
    select 1
      from information_schema.tables
     where table_schema='orders' and table_name='delivery_records'`);
  assert.equal(table.rowCount, 1, '047_order_delivery_records migration is required');
  const index = await store.pool.query(`
    select 1
      from pg_indexes
     where schemaname='orders' and indexname='delivery_records_coupon_item_success_uq'`);
  assert.equal(index.rowCount, 1, 'coupon item success uniqueness index is required');
}

async function run() {
  runtime = createApp(appConfig());
  await runtime.listen();
  await assertSchema(runtime.store);

  const admin = await runtime.store.createAdmin({ email, passwordHash: await hashPassword('password-123'), displayName: 'Order Delivery PostgreSQL Smoke' });
  adminId = admin.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `order-delivery-pg-${suffix}`, displayName: 'Delivery PG Account' });
  accountId = account.id;
  const product = await runtime.store.createProduct({ adminId, accountId, externalProductRef: `order-delivery-item-${suffix}`, title: 'PostgreSQL Delivery Item' });
  productId = product.id;

  const batch = await runtime.store.createCouponBatch({
    adminId,
    accountId,
    label: 'PG no-logistics coupon',
    purpose: 'text',
    metadata: { textContent: 'PG coupon delivery', useNoLogisticsForm: true },
  });
  batchId = batch.id;
  const imported = await runtime.store.importCouponItems({ adminId, batchId, contents: [`PG-COUPON-${suffix}`] });
  assert.equal(imported.items.length, 1);
  await runtime.productAutomation.update({
    adminId,
    productId,
    expectedConfigVersion: 1,
    config: { paidAutoDelivery: { enabled: true, couponBatchIds: [batch.sequenceId] } },
    requestId: `order-delivery-pg-automation-${suffix}`,
    traceId: `order-delivery-pg-automation-${suffix}`,
  });

  orderNo = `PG-DELIVERY-${suffix}`;
  await runtime.store.createOrder({
    adminId,
    order: {
      accountId,
      orderNo,
      buyerId: `buyer-${suffix}`,
      buyerName: 'PG Buyer',
      itemId: product.externalProductRef ?? product.id,
      itemTitle: product.title,
      amountMinor: 1990,
      paymentStatus: 'paid',
      orderStatus: 'open',
      deliveryStatus: 'pending',
      afterSalesStatus: 'none',
      deliveryType: 'coupon_only',
      productId,
    },
  });

  const key = `order-delivery-pg-key-${suffix}`;
  const first = await runtime.orderDelivery.deliver({ adminId, accountId, orderNo, idempotencyKey: key, requestId: `deliver-${suffix}`, traceId: `deliver-${suffix}` });
  assert.equal(first.record.status, 'succeeded');
  assert.ok(first.record.couponItemId);
  assert.equal(first.order?.deliveryStatus, 'delivered');
  assert.equal((await runtime.store.listDeliveryRecords(adminId, { accountId, orderNo })).length, 1);

  const repeated = await runtime.orderDelivery.deliver({ adminId, accountId, orderNo, idempotencyKey: key, requestId: `deliver-repeat-${suffix}`, traceId: `deliver-repeat-${suffix}` });
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.record.id, first.record.id);

  const persisted = await runtime.store.pool.query(`
    select d.status, d.external_outcome, d.coupon_item_id, d.attempt, o.delivery_status,
           outbox.status as outbox_status
      from orders.delivery_records d
      join orders.orders o on o.id=d.order_id
      join execution.outbox_jobs outbox on outbox.idempotency_key=d.idempotency_key
     where d.id=$1`, [first.record.id]);
  assert.deepEqual(persisted.rows[0], {
    status: 'succeeded',
    external_outcome: 'known_success',
    coupon_item_id: first.record.couponItemId,
    attempt: 1,
    delivery_status: 'delivered',
    outbox_status: 'succeeded',
  });

  await runtime.close();
  runtime = undefined;
  restarted = createApp(appConfig());
  await restarted.listen();
  const readback = await restarted.store.listDeliveryRecords(adminId, { accountId, orderNo });
  assert.equal(readback.length, 1);
  assert.equal(readback[0].status, 'succeeded');
  assert.equal(readback[0].couponItemId, first.record.couponItemId);
  console.log(JSON.stringify({ status: 'PASS', storage: 'postgres', orderNo, deliveryRecordId: readback[0].id, couponItemId: readback[0].couponItemId, idempotentReplay: true, restartReadback: true }));
}

try {
  await run();
} finally {
  const active = restarted ?? runtime;
  if (active?.store?.pool) {
    if (accountId) {
      await active.store.pool.query('delete from orders.delivery_records where account_id=$1', [accountId]);
      await active.store.pool.query('delete from execution.outbox_jobs where scope like $1', [`order-delivery:%:${accountId}`]);
      await active.store.pool.query('delete from coupons.coupon_reservation_items where reservation_id in (select id from coupons.coupon_reservations where account_id=$1)', [accountId]);
      await active.store.pool.query('delete from coupons.coupon_reservations where account_id=$1', [accountId]);
      await active.store.pool.query('delete from coupons.coupon_items where batch_id in (select id from coupons.coupon_batches where account_id=$1)', [accountId]);
      await active.store.pool.query('delete from coupons.coupon_bindings where coupon_batch_id in (select id from coupons.coupon_batches where account_id=$1)', [accountId]);
      await active.store.pool.query('delete from coupons.coupon_batches where account_id=$1', [accountId]);
      await active.store.pool.query('delete from orders.orders where account_id=$1', [accountId]);
      await active.store.pool.query('delete from products.product_automation_configs where account_id=$1', [accountId]);
      await active.store.pool.query('delete from products.products where account_id=$1', [accountId]);
      await active.store.pool.query('delete from observability.audit_events where account_id=$1', [accountId]);
      await active.store.pool.query('delete from auth.account_scopes where account_id=$1', [accountId]);
      await active.store.pool.query('delete from accounts.accounts where id=$1', [accountId]);
    }
    if (adminId) {
      await active.store.pool.query('delete from auth.sessions where admin_id=$1', [adminId]);
      await active.store.pool.query('delete from auth.admins where id=$1', [adminId]);
    }
  }
  if (restarted) await restarted.close();
  else if (runtime) await runtime.close();
}
