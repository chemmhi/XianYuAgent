import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryStore } from '../src/store-memory.js';

async function fixture(itemCount = 2) {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: `coupon-reservation-${Date.now()}-${Math.random()}@example.com`, passwordHash: 'hash', displayName: 'Coupon Reservation Test' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `coupon-reservation-${Date.now()}-${Math.random()}` });
  const batch = await store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: 'Reservation Batch', purpose: 'text', deliveryScope: 'buyer_deliverable' });
  await store.importCouponItems({ adminId: admin.id, batchId: batch.id, contents: Array.from({ length: itemCount }, (_, index) => `coupon-${index + 1}`) });
  return { store, admin, account, batch };
}

function reservationInput(fixtureValue: Awaited<ReturnType<typeof fixture>>, executionKey: string, quantity = 1) {
  return { adminId: fixtureValue.admin.id, accountId: fixtureValue.account.id, batchIds: [fixtureValue.batch.id], quantity, executionKey, purpose: 'delivery' as const };
}

test('coupon reservation is idempotent under concurrent same-key calls and returns delivery metadata', async () => {
  const value = await fixture(2);
  const input = reservationInput(value, 'same-key');
  const [first, second] = await Promise.all([value.store.reserveCoupon(input), value.store.reserveCoupon(input)]);
  assert.equal(first.reservationId, second.reservationId);
  assert.deepEqual(first.items, second.items);
  assert.equal(first.items[0]?.batchLabel, 'Reservation Batch');
  const batch = await value.store.getCouponBatch(value.admin.id, value.batch.id);
  assert.equal(batch?.items?.filter((item) => item.status === 'available').length, 1);
  assert.equal(batch?.items?.filter((item) => item.status === 'reserved').length, 1);
});

test('coupon reservation prevents concurrent oversell across different execution keys', async () => {
  const value = await fixture(1);
  const results = await Promise.allSettled([
    value.store.reserveCoupon(reservationInput(value, 'key-a')),
    value.store.reserveCoupon(reservationInput(value, 'key-b')),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.match(String(rejected?.reason?.message), /COUPON_DELIVERY_ITEM_UNAVAILABLE/);
});

test('release makes inventory available and the same execution key can reopen a retry reservation', async () => {
  const value = await fixture(1);
  const input = reservationInput(value, 'retry-key');
  const reserved = await value.store.reserveCoupon(input);
  const released = await value.store.releaseCouponReservation({ adminId: value.admin.id, reservationId: reserved.reservationId, executionKey: input.executionKey, reason: 'send_failed' });
  assert.equal(released.status, 'released');
  assert.equal((await value.store.getCouponBatch(value.admin.id, value.batch.id))?.items?.filter((item) => item.status === 'available').length, 1);
  const reopened = await value.store.reserveCoupon(input);
  assert.equal(reopened.reservationId, reserved.reservationId);
  assert.equal(reopened.status, 'reserved');
  assert.equal((await value.store.getCouponBatch(value.admin.id, value.batch.id))?.items?.filter((item) => item.status === 'reserved').length, 1);
});

test('commit is idempotent and prevents release after finalization', async () => {
  const value = await fixture(1);
  const input = reservationInput(value, 'commit-key');
  const reserved = await value.store.reserveCoupon(input);
  const committed = await value.store.commitCouponReservation({ adminId: value.admin.id, reservationId: reserved.reservationId, executionKey: input.executionKey });
  const replay = await value.store.commitCouponReservation({ adminId: value.admin.id, reservationId: reserved.reservationId, executionKey: input.executionKey });
  assert.equal(committed.status, 'committed');
  assert.deepEqual(replay, committed);
  assert.equal((await value.store.getCouponBatch(value.admin.id, value.batch.id))?.items?.filter((item) => item.status === 'consumed').length, 1);
  await assert.rejects(() => value.store.releaseCouponReservation({ adminId: value.admin.id, reservationId: reserved.reservationId, executionKey: input.executionKey, reason: 'late_release' }), /COUPON_RESERVATION_FINALIZED/);
});

test('expired lease is released before read and can be reopened', async () => {
  const value = await fixture(1);
  const input = { ...reservationInput(value, 'expiry-key'), leaseSeconds: 1 };
  const reserved = await value.store.reserveCoupon(input);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const expired = await value.store.getCouponReservation({ adminId: value.admin.id, reservationId: reserved.reservationId, executionKey: input.executionKey });
  assert.equal(expired?.status, 'expired');
  assert.equal((await value.store.getCouponBatch(value.admin.id, value.batch.id))?.items?.filter((item) => item.status === 'available').length, 1);
  await assert.rejects(() => value.store.commitCouponReservation({ adminId: value.admin.id, reservationId: reserved.reservationId, executionKey: input.executionKey }), /COUPON_RESERVATION_EXPIRED/);
  const reopened = await value.store.reserveCoupon(input);
  assert.equal(reopened.status, 'reserved');
  assert.equal(reopened.reservationId, reserved.reservationId);
});

test('reservation execution key fingerprint and admin scope are enforced', async () => {
  const value = await fixture(2);
  const reserved = await value.store.reserveCoupon(reservationInput(value, 'fingerprint-key', 1));
  await assert.rejects(() => value.store.reserveCoupon(reservationInput(value, 'fingerprint-key', 2)), /COUPON_RESERVATION_KEY_CONFLICT/);
  const otherAdmin = await value.store.createAdmin({ email: `coupon-reservation-other-${Date.now()}-${Math.random()}@example.com`, passwordHash: 'hash', displayName: 'Other Admin' });
  assert.equal(await value.store.getCouponReservation({ adminId: otherAdmin.id, reservationId: reserved.reservationId }), undefined);
});
