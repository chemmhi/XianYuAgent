export type XianyuSystemMessageKind =
  | 'unpaid_order'
  | 'paid_waiting_shipment'
  | 'received'
  | 'reviewed'
  | 'trade_success'
  | 'trade_closed'
  | 'refund_success'
  | 'refund_closed';

export interface XianyuOrderStatusSnapshot {
  itemId?: string;
  paymentStatus: string;
  orderStatus: string;
  deliveryStatus: string;
  afterSalesStatus: string;
}

/**
 * Text is only a candidate signal. Callers must also prove that the gateway
 * supplied a platform reminder field before using this parser for system
 * message handling.
 */
export function parseXianyuSystemMessageKind(value: string | undefined): XianyuSystemMessageKind | undefined {
  const normalized = value?.replace(/\s+/gu, ' ').trim();
  if (!normalized) return undefined;

  const statusText = unwrapStatusText(normalized);
  if (/^(?:我已拍下|买家已拍下|已拍下)[，,、:：\s]*(?:待付款|等待付款|待支付)$/u.test(statusText)) return 'unpaid_order';
  if (/^(?:我已付款|我已支付|买家已付款|买家已支付|已付款|已支付)[，,、:：\s]*(?:等待你?发货|等待您?发货|待发货)$/u.test(statusText)) return 'paid_waiting_shipment';
  if (/^已确认收货[。！!]?$/u.test(statusText)) return 'received';
  if (/^(?:已评价|评价完成)[。！!]?$/u.test(statusText)) return 'reviewed';
  if (/^交易成功[。！!]?$/u.test(statusText)) return 'trade_success';
  if (/^交易关闭[。！!]?$/u.test(statusText)) return 'trade_closed';
  if (/^退款成功[。！!]?$/u.test(statusText)) return 'refund_success';
  if (/^退款关闭[。！!]?$/u.test(statusText)) return 'refund_closed';
  return undefined;
}

export function isXianyuSystemMessageText(value: string | undefined): boolean {
  return Boolean(parseXianyuSystemMessageKind(value));
}

/**
 * These fields are emitted by the Xianyu reminder envelope. A buyer can type
 * the same visible text, but their normal chat payload does not carry these
 * reminder fields, so text alone never upgrades a message to `system`.
 */
export function hasXianyuSystemEnvelopeMarker(...sources: unknown[]): boolean {
  return sources.some((source) => {
    const record = asRecord(source);
    return Boolean(nonEmpty(record.reminderContent) || nonEmpty(record.detailNotice) || nonEmpty(record.reminderUrl));
  });
}

export function matchesXianyuOrderStatus(kind: XianyuSystemMessageKind, order: XianyuOrderStatusSnapshot): boolean {
  const paymentStatus = order.paymentStatus.trim().toLowerCase();
  const orderStatus = order.orderStatus.trim().toLowerCase();
  const deliveryStatus = order.deliveryStatus.trim().toLowerCase();
  const afterSalesStatus = order.afterSalesStatus.trim().toLowerCase();
  switch (kind) {
    case 'unpaid_order':
      return paymentStatus === 'unpaid' && !['closed', 'cancelled', 'failed'].includes(orderStatus);
    case 'paid_waiting_shipment':
      return paymentStatus === 'paid' && ['pending', 'reserving', 'partially_delivered'].includes(deliveryStatus) && !['closed', 'cancelled', 'failed'].includes(orderStatus);
    case 'received':
      return deliveryStatus === 'delivered' || orderStatus === 'completed';
    case 'reviewed':
      return orderStatus === 'completed';
    case 'trade_success':
      return paymentStatus === 'paid' && (orderStatus === 'completed' || deliveryStatus === 'delivered');
    case 'trade_closed':
      return paymentStatus === 'closed' || ['closed', 'cancelled', 'failed'].includes(orderStatus);
    case 'refund_success':
      return afterSalesStatus === 'refunded';
    case 'refund_closed':
      return ['closed', 'rejected'].includes(afterSalesStatus);
  }
}

function unwrapStatusText(value: string): string {
  const pairs: Array<[string, string]> = [['[', ']'], ['【', '】'], ['（', '）'], ['(', ')']];
  for (const [left, right] of pairs) {
    if (value.startsWith(left) && value.endsWith(right)) return value.slice(left.length, -right.length).trim();
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
