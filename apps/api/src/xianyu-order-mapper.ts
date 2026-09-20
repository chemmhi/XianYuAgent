import { createHash } from 'node:crypto';
import type { AfterSalesStatus, DeliveryStatus, OrderDeliveryType, OrderStatus, PaymentStatus, XianyuOrderItem } from './domain.js';

export interface XianyuOrderPageResult {
  items: XianyuOrderItem[];
  pageNumber: number;
  pageSize: number;
  totalCount?: number;
  totalPages?: number;
  hasMore: boolean;
}

export function mapXianyuOrderPage(response: Record<string, unknown> | undefined, pageNumber = 1, pageSize = 30): XianyuOrderPageResult {
  const data = asRecord(response?.data);
  const module = asRecord(data.module);
  const moduleItems = Array.isArray(module.items) ? module.items : undefined;
  const candidates = moduleItems ? [moduleItems, ...findOrderArrays(response)] : findOrderArrays(response);
  const source = candidates.sort((left, right) => scoreArray(right) - scoreArray(left))[0] ?? [];
  const items: XianyuOrderItem[] = [];
  for (const value of source) {
    const mapped = mapXianyuOrder(value);
    if (mapped) items.push(mapped);
  }
  const totalCount = firstNumber(module.totalCount, module.total_count, data.totalCount, data.total_count, data.total, response?.totalCount, response?.total_count, response?.total);
  const totalPages = firstNumber(module.totalPages, module.total_pages, module.pageCount, module.page_count, data.totalPages, data.total_pages, data.pageCount, data.page_count, response?.totalPages, response?.total_pages);
  const explicitHasMore = firstBoolean(module.nextPage, module.hasMore, data.nextPage, data.hasMore, response?.hasMore);
  return { items, pageNumber, pageSize, totalCount, totalPages, hasMore: explicitHasMore ?? (totalPages ? pageNumber < totalPages : items.length >= pageSize) };
}

export function mapXianyuOrder(value: unknown): XianyuOrderItem | undefined {
  const raw = unwrapOrder(value);
  const buyer = asRecord(raw.buyer);
  const item = asRecord(raw.item);
  const orderNo = firstString(raw.orderNo, raw.order_no, raw.orderId, raw.order_id, raw.orderNumber, raw.bizOrderId, raw.tradeId, raw.trade_id);
  if (!orderNo) return undefined;
  const statusValue = firstString(raw.orderStatus, raw.order_status, raw.status, raw.tradeStatus, raw.trade_status);
  const afterSalesValue = firstString(raw.afterSalesStatus, raw.after_sales_status, raw.refundStatus, raw.refund_status, raw.afterSaleStatus, raw.after_sale_status) ?? (isAfterSalesSignal(statusValue) ? statusValue : undefined);
  const buyerId = firstString(raw.buyerId, raw.buyer_id, raw.buyerUid, raw.buyer_uid, raw.userId, raw.user_id, buyer.id) ?? 'unknown-buyer';
  const buyerName = firstString(raw.buyerName, raw.buyer_name, raw.buyerFishNick, raw.buyer_fish_nick, raw.buyerNick, raw.buyer_nick, raw.fishNick, buyer.name, buyer.nick) ?? buyerId;
  const itemId = firstString(raw.itemId, raw.item_id, raw.auctionId, raw.auction_id, raw.commodityId, raw.commodity_id, item.id) ?? 'unknown-item';
  const itemTitle = firstString(raw.itemTitle, raw.item_title, raw.title, raw.auctionTitle, raw.auction_title, item.title) ?? itemId;
  const amountMinor = parseAmountMinorFields(raw);
  const createdAt = parseDate(firstValue(raw.createdAt, raw.created_at, raw.placedAt, raw.placed_at, raw.createTime, raw.create_time, raw.orderTime, raw.order_time)) ?? new Date().toISOString();
  const updatedAt = parseDate(firstValue(raw.updatedAt, raw.updated_at, raw.updateTime, raw.update_time, raw.modifyTime, raw.modify_time)) ?? createdAt;
  const productIdCandidate = firstString(raw.productId, raw.product_id);
  return {
    orderNo,
    buyerId,
    buyerName,
    itemId,
    itemTitle,
    amountMinor,
    paymentStatus: mapPaymentStatus(firstString(raw.paymentStatus, raw.payment_status, raw.payStatus, raw.pay_status, raw.tradeStatus, raw.trade_status)),
    orderStatus: mapOrderStatus(statusValue),
    deliveryStatus: mapDeliveryStatus(firstString(raw.deliveryStatus, raw.delivery_status, raw.shipStatus, raw.ship_status, raw.deliveryState, raw.delivery_state) ?? statusValue),
    afterSalesStatus: mapAfterSalesStatus(afterSalesValue),
    deliveryType: mapDeliveryType(raw),
    createdAt,
    updatedAt,
    deliveryFailReason: firstString(raw.deliveryFailReason, raw.delivery_fail_reason, raw.failReason, raw.fail_reason),
    conversationId: firstString(raw.conversationId, raw.conversation_id, raw.cid, raw.sessionId, raw.session_id),
    productId: isUuid(productIdCandidate) ? productIdCandidate : undefined,
    sourcePayloadDigest: digest(raw),
  };
}

function unwrapOrder(value: unknown): Record<string, unknown> {
  const root = asRecord(value);
  const commonData = asRecord(root.commonData);
  const buyerInfo = asRecord(root.buyerInfoVO);
  const priceInfo = asRecord(root.priceVO);
  const rightInfo = asRecord(root.rightVO);
  const orderId = firstString(commonData.orderId, commonData.orderID);
  if (orderId) {
    const rawStatus = firstString(commonData.orderStatus, commonData.status);
    const inRefund = toBoolean(commonData.inRefund);
    const buttons = Array.isArray(rightInfo.btnList) ? rightInfo.btnList : [];
    return {
      ...root,
      orderNo: orderId,
      itemId: firstString(commonData.itemId, commonData.auctionId, root.itemId),
      orderStatus: rawStatus,
      tradeStatus: rawStatus,
      buyerId: firstString(buyerInfo.buyerId, buyerInfo.userId, buyerInfo.id),
      buyerName: firstString(buyerInfo.name, buyerInfo.receiverName, buyerInfo.nick),
      amount: firstString(priceInfo.totalPrice, priceInfo.confirmFee, priceInfo.auctionPrice),
      quantity: firstString(priceInfo.buyNum, priceInfo.quantity),
      itemTitle: firstString(commonData.itemTitle, commonData.title, root.itemTitle),
      createdAt: firstValue(commonData.createTime, commonData.orderCreateTime, commonData.createdAt, root.createdAt),
      updatedAt: firstValue(commonData.updateTime, commonData.modifyTime, commonData.updatedAt, root.updatedAt),
      inRefund,
      afterSalesStatus: inRefund ? 'refunding' : undefined,
      deliveryStatus: rawStatus,
      isBargain: buttons.some((button) => /SKIP_PIN/i.test(firstString(asRecord(button).tradeAction) ?? '')),
    };
  }
  for (const key of ['orderInfo', 'order', 'trade', 'data']) {
    const nested = asRecord(root[key]);
    if (Object.keys(nested).length > 0 && (firstString(nested.orderNo, nested.order_no, nested.orderId, nested.order_id, nested.bizOrderId) || key === 'orderInfo')) return nested;
  }
  return root;
}

function findOrderArrays(root: unknown, depth = 0): Array<unknown[]> {
  if (depth > 6 || !root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return [root, ...root.flatMap((value) => findOrderArrays(value, depth + 1))];
  const record = root as Record<string, unknown>;
  const arrays: Array<unknown[]> = [];
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) arrays.push(value, ...value.flatMap((item) => findOrderArrays(item, depth + 1)));
    else if (value && typeof value === 'object') arrays.push(...findOrderArrays(value, depth + 1));
    if (['orderList', 'orders', 'orderInfoList', 'tradeList', 'list', 'items'].includes(key) && Array.isArray(value)) arrays.unshift(value);
  }
  return arrays;
}

function scoreArray(items: unknown[]): number { return items.reduce<number>((score, item) => { const raw = unwrapOrder(item); return score + (firstString(raw.orderNo, raw.order_no, raw.orderId, raw.order_id, raw.bizOrderId) ? 10 : 0); }, 0); }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function firstValue(...values: unknown[]): unknown { return values.find((value) => value !== undefined && value !== null && value !== ''); }
function firstString(...values: unknown[]): string | undefined { for (const value of values) { if (typeof value === 'string' && value.trim()) return value.trim(); if (typeof value === 'number' && Number.isFinite(value)) return String(value); } return undefined; }
function firstNumber(...values: unknown[]): number | undefined { for (const value of values) { const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN; if (Number.isFinite(number) && number > 0) return Math.trunc(number); } return undefined; }
function firstBoolean(...values: unknown[]): boolean | undefined { for (const value of values) { if (value === undefined || value === null || value === '') continue; return toBoolean(value); } return undefined; }
function toBoolean(value: unknown): boolean { if (typeof value === 'boolean') return value; if (typeof value === 'number') return value !== 0; return /^(true|1|yes)$/i.test(String(value).trim()); }
function isAfterSalesSignal(value: string | undefined): boolean { const normalized = normalize(value); return /refund|退款|after.?sale|售后/.test(normalized); }
function parseAmountMinorFields(raw: Record<string, unknown>): number {
  for (const key of ['amountMinor', 'amount_minor', 'payAmountMinor', 'pay_amount_minor', 'actualAmountMinor', 'actual_amount_minor']) {
    const value = raw[key];
    if (value === undefined || value === null || value === '') continue;
    const number = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(number) && number >= 0) return Math.round(number);
  }
  for (const key of ['amount', 'payAmount', 'pay_amount', 'actualAmount', 'actual_amount', 'price', 'orderAmount', 'order_amount']) {
    const value = raw[key];
    if (value === undefined || value === null || value === '') continue;
    const number = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(number) && number >= 0) return Math.round(number * 100);
  }
  return 0;
}
function parseDate(value: unknown): string | undefined { if (value === undefined || value === null || value === '') return undefined; if (typeof value === 'number' || (typeof value === 'string' && /^\d{10,13}$/.test(value))) { const numeric = Number(value); const milliseconds = numeric < 2_000_000_000 ? numeric * 1000 : numeric; const date = new Date(milliseconds); return Number.isNaN(date.getTime()) ? undefined : date.toISOString(); } const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? undefined : date.toISOString(); }
function normalize(value: string | undefined): string { return (value ?? '').trim().toLowerCase(); }
function mapPaymentStatus(value: string | undefined): PaymentStatus { const normalized = normalize(value); if (!normalized) return 'unknown'; if (/unpaid|wait.*pay|待付款|未付款|待支付/.test(normalized)) return 'unpaid'; if (/closed|close|关闭|交易关闭/.test(normalized)) return 'closed'; if (/paid|success|付款|已支付|待发货|已发货|交易成功|已完成|退款中|退款成功|已退款/.test(normalized)) return 'paid'; return 'unknown'; }
function mapOrderStatus(value: string | undefined): OrderStatus { const normalized = normalize(value); if (/canceling|cancelling|取消中/.test(normalized)) return 'cancelling'; if (/cancelled|canceled|已取消|退款成功|已退款|退款关闭/.test(normalized)) return 'cancelled'; if (/complete|finished|success|已完成|交易成功/.test(normalized)) return 'completed'; if (/closed|关闭|交易关闭/.test(normalized)) return 'closed'; if (/fail|失败/.test(normalized)) return 'failed'; return 'open'; }
function mapDeliveryStatus(value: string | undefined): DeliveryStatus { const normalized = normalize(value); if (/reserve|lock|锁库存/.test(normalized)) return 'reserving'; if (/partial|部分/.test(normalized)) return 'partially_delivered'; if (/deliver|ship|已发货|已交付|交易成功|已完成/.test(normalized)) return 'delivered'; if (/fail|失败/.test(normalized)) return 'failed'; if (/cancel|未发货|取消/.test(normalized)) return 'cancelled'; return 'pending'; }
function mapAfterSalesStatus(value: string | undefined): AfterSalesStatus { const normalized = normalize(value); if (!normalized || /none|无售后|无/.test(normalized)) return 'none'; if (/request|申请/.test(normalized)) return 'requested'; if (/refund.*ing|退款中/.test(normalized)) return 'refunding'; if (/refunded|已退款|退款成功/.test(normalized)) return 'refunded'; if (/reject|驳回/.test(normalized)) return 'rejected'; if (/closed|关闭/.test(normalized)) return 'closed'; return 'requested'; }
function mapDeliveryType(raw: Record<string, unknown>): OrderDeliveryType { const value = normalize(firstString(raw.deliveryType, raw.delivery_type, raw.shipType, raw.ship_type, raw.logisticsType, raw.logistics_type)); if (/coupon|卡券/.test(value)) return 'coupon_only'; if (/mixed|混合/.test(value)) return 'mixed'; if (/no.?logistics|免物流/.test(value)) return 'no_logistics'; return 'manual'; }
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function isUuid(value: string | undefined): value is string { return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)); }
