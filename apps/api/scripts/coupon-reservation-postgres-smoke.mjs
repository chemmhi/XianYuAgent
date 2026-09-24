import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../dist/app.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const runtime = createApp({ host: '127.0.0.1', port: 0, databaseUrl, redisUrl: '', cookieSecure: false, allowInMemory: false, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub', webSocketAllowedOrigins: [], agentRuntime: 'in-process', modelTimeoutMs: 1000, credentialEncryptionKey: 'test-key', objectStorageEndpoint: 'http://127.0.0.1:19000', objectStorageAccessKey: 'xianyu', objectStorageSecretKey: 'xianyu', objectStorageBucket: 'xianyu-assets', objectStorageRegion: 'us-east-1' });
const suffix = `${process.pid}-${Date.now()}`;
let admin;
let account;
let batch;
const reservationIds = [];

await runtime.store.pool.query(await readFile(new URL('../migrations/033_coupon_reservations.sql', import.meta.url), 'utf8'));
await runtime.listen();
try {
  assert.equal((await runtime.store.health()).reachable, true, 'PostgreSQL must be reachable and base migrations must be applied');
  admin = await runtime.store.createAdmin({ email: `coupon-reservation-pg-${suffix}@example.com`, passwordHash: 'hash', displayName: 'Coupon Reservation PG' });
  account = await runtime.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `coupon-reservation-pg-${suffix}` });
  batch = await runtime.store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: 'PG Reservation Batch', purpose: 'text', deliveryScope: 'buyer_deliverable' });
  await runtime.store.importCouponItems({ adminId: admin.id, batchId: batch.id, contents: [`pg-coupon-1-${suffix}`, `pg-coupon-2-${suffix}`] });

  const reserveInput = { adminId: admin.id, accountId: account.id, batchIds: [batch.id], quantity: 1, executionKey: `pg-same-${suffix}`, purpose: 'delivery' };
  const [first, second] = await Promise.all([runtime.store.reserveCoupon(reserveInput), runtime.store.reserveCoupon(reserveInput)]);
  reservationIds.push(first.reservationId);
  assert.equal(first.reservationId, second.reservationId);
  assert.equal(first.items.length, 1);

  const oversell = await Promise.allSettled([
    runtime.store.reserveCoupon({ ...reserveInput, executionKey: `pg-a-${suffix}` }),
    runtime.store.reserveCoupon({ ...reserveInput, executionKey: `pg-b-${suffix}` }),
  ]);
  const fulfilled = oversell.filter((result) => result.status === 'fulfilled');
  assert.equal(fulfilled.length, 1);
  const rejected = oversell.find((result) => result.status === 'rejected');
  assert.match(String(rejected?.reason?.message), /COUPON_DELIVERY_ITEM_UNAVAILABLE/);
  for (const result of fulfilled) reservationIds.push(result.value.reservationId);

  const released = await runtime.store.releaseCouponReservation({ adminId: admin.id, reservationId: first.reservationId, executionKey: reserveInput.executionKey, reason: 'pg_send_failed' });
  assert.equal(released.status, 'released');
  const reopened = await runtime.store.reserveCoupon(reserveInput);
  assert.equal(reopened.reservationId, first.reservationId);
  assert.equal(reopened.status, 'reserved');
  const committed = await runtime.store.commitCouponReservation({ adminId: admin.id, reservationId: reopened.reservationId, executionKey: reserveInput.executionKey });
  const commitReplay = await runtime.store.commitCouponReservation({ adminId: admin.id, reservationId: reopened.reservationId, executionKey: reserveInput.executionKey });
  assert.equal(committed.status, 'committed');
  assert.deepEqual(commitReplay, committed);

  await runtime.store.importCouponItems({ adminId: admin.id, batchId: batch.id, contents: [`pg-coupon-3-${suffix}`] });
  const expiryInput = { ...reserveInput, executionKey: `pg-expiry-${suffix}`, leaseSeconds: 1 };
  const expiring = await runtime.store.reserveCoupon(expiryInput);
  reservationIds.push(expiring.reservationId);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const expired = await runtime.store.getCouponReservation({ adminId: admin.id, reservationId: expiring.reservationId, executionKey: expiryInput.executionKey });
  assert.equal(expired?.status, 'expired');
  console.log('coupon reservation PostgreSQL smoke passed');
} finally {
  if (batch) {
    await runtime.store.pool.query('delete from coupons.coupon_reservation_items where reservation_id in (select id from coupons.coupon_reservations where account_id=$1)', [account.id]);
    await runtime.store.pool.query('delete from coupons.coupon_reservations where account_id=$1', [account.id]);
    await runtime.store.pool.query('delete from coupons.coupon_items where batch_id=$1', [batch.id]);
    await runtime.store.pool.query('delete from coupons.coupon_batches where id=$1', [batch.id]);
  }
  if (account) {
    await runtime.store.pool.query('delete from auth.account_scopes where account_id=$1', [account.id]);
    await runtime.store.pool.query('delete from accounts.accounts where id=$1', [account.id]);
  }
  if (admin) await runtime.store.pool.query('delete from auth.admins where id=$1', [admin.id]);
  await runtime.close();
}
