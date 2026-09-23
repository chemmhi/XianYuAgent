import { createHash } from 'node:crypto';
import type { CouponReservationItemRecord, CouponReservationRecord, CouponReservationPurpose } from './domain.js';

export const DEFAULT_COUPON_RESERVATION_LEASE_SECONDS = 300;
export const MAX_COUPON_RESERVATION_LEASE_SECONDS = 86_400;
export const MAX_COUPON_RESERVATION_QUANTITY = 10_000;

export function normalizeCouponReservationInput(input: {
  batchIds: string[];
  quantity: number;
  executionKey: string;
  purpose: CouponReservationPurpose;
}): { batchIds: string[]; quantity: number; executionKey: string; purpose: CouponReservationPurpose } {
  const batchIds = [...new Set(input.batchIds.map((value) => value.trim()).filter(Boolean))];
  if (batchIds.length < 1 || batchIds.length > 100) throw new Error('COUPON_BATCH_REQUIRED');
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_COUPON_RESERVATION_QUANTITY) throw new Error('COUPON_RESERVATION_INVALID_QUANTITY');
  const executionKey = input.executionKey.trim();
  if (!executionKey || executionKey.length > 500) throw new Error('COUPON_RESERVATION_INVALID_EXECUTION_KEY');
  if (input.purpose !== 'delivery' && input.purpose !== 'gift') throw new Error('COUPON_RESERVATION_INVALID_PURPOSE');
  return { batchIds, quantity: input.quantity, executionKey, purpose: input.purpose };
}

export function normalizeLeaseSeconds(value: number | undefined): number {
  if (value === undefined) return DEFAULT_COUPON_RESERVATION_LEASE_SECONDS;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_COUPON_RESERVATION_LEASE_SECONDS) throw new Error('COUPON_RESERVATION_INVALID_LEASE');
  return value;
}

export function reservationFingerprint(input: { adminId: string; accountId: string; batchIds: string[]; quantity: number; purpose: CouponReservationPurpose }): string {
  return createHash('sha256').update(JSON.stringify({ adminId: input.adminId, accountId: input.accountId, batchIds: input.batchIds, quantity: input.quantity, purpose: input.purpose })).digest('hex');
}

export function cloneCouponReservation(record: CouponReservationRecord): CouponReservationRecord {
  return {
    ...record,
    batchIds: [...record.batchIds],
    items: record.items.map((item) => ({ ...item })),
  };
}

export function cloneCouponReservationItem(item: CouponReservationItemRecord): CouponReservationItemRecord {
  return { ...item };
}
