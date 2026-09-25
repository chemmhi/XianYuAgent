import type { AutomationOrderSnapshot } from './product-automation.js';

export function orderFingerprint(order: Pick<AutomationOrderSnapshot, 'paymentStatus' | 'orderStatus' | 'deliveryStatus' | 'afterSalesStatus' | 'itemId' | 'buyerId' | 'buyerName' | 'buyerNickname' | 'productId' | 'quantity' | 'skuSpec' | 'reviewedAt'>): string {
  return JSON.stringify({
    paymentStatus: order.paymentStatus,
    orderStatus: order.orderStatus,
    deliveryStatus: order.deliveryStatus,
    afterSalesStatus: order.afterSalesStatus,
    itemId: order.itemId,
    buyerId: order.buyerId,
    buyerName: order.buyerName,
    buyerNickname: order.buyerNickname,
    productId: order.productId,
    quantity: order.quantity,
    skuSpec: order.skuSpec,
    reviewedAt: order.reviewedAt,
  });
}

export function shouldProcessObservedOrder(input: {
  order: Pick<AutomationOrderSnapshot, 'createdAt' | 'updatedAt' | 'paymentStatus' | 'orderStatus' | 'deliveryStatus' | 'afterSalesStatus' | 'itemId' | 'buyerId' | 'buyerName' | 'buyerNickname' | 'productId' | 'quantity' | 'skuSpec' | 'reviewedAt'>;
  previousFingerprint?: string;
  accountInitialized: boolean;
  monitorStartedAt: number;
}): boolean {
  if (input.previousFingerprint !== undefined) return input.previousFingerprint !== orderFingerprint(input.order);
  if (input.accountInitialized) return true;
  const createdAt = Date.parse(input.order.createdAt);
  const updatedAt = Date.parse(input.order.updatedAt);
  if (!Number.isFinite(createdAt) && !Number.isFinite(updatedAt)) return true;
  const lastChangedAt = Math.max(
    Number.isFinite(createdAt) ? createdAt : Number.NEGATIVE_INFINITY,
    Number.isFinite(updatedAt) ? updatedAt : Number.NEGATIVE_INFINITY,
  );
  return lastChangedAt >= input.monitorStartedAt - 60_000;
}

export function reviewTransitioned(before: Pick<AutomationOrderSnapshot, 'reviewedAt'> | undefined, after: Pick<AutomationOrderSnapshot, 'reviewedAt'>): boolean {
  return !before?.reviewedAt && Boolean(after.reviewedAt);
}
