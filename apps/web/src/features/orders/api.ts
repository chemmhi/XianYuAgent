import type { ApiError } from '../../api/http';
import type { AccountVM } from '../accounts/types';
import type { AfterSalesStatus, DeliveryStatus, OrderFilters, OrderStatus, OrderVM, OrdersPageVM, PaymentStatus } from './types';

export interface OrdersApi {
  list(filters: OrderFilters): Promise<OrdersPageVM>;
  getDetail(orderNo: string, accountId?: string): Promise<OrderVM>;
  refresh(accountId?: string): Promise<void>;
}

interface OrdersEnvelope {
  data?: unknown;
  items?: unknown[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  page_size?: number;
  total_pages?: number;
}

const paymentStatuses: PaymentStatus[] = ['unpaid', 'paid', 'closed', 'unknown'];
const orderStatuses: OrderStatus[] = ['open', 'cancelling', 'cancelled', 'completed', 'closed', 'failed'];
const deliveryStatuses: DeliveryStatus[] = ['pending', 'reserving', 'delivered', 'partially_delivered', 'failed', 'cancelled'];
const afterSalesStatuses: AfterSalesStatus[] = ['none', 'requested', 'refunding', 'refunded', 'rejected', 'closed'];

function asObject(value: unknown): Record<string, unknown> { return typeof value === 'object' && value ? value as Record<string, unknown> : {}; }
function pick(payload: OrdersEnvelope): unknown[] {
  if (Array.isArray(payload.items)) return payload.items;
  const data = asObject(payload.data);
  return Array.isArray(data.items) ? data.items : Array.isArray(payload.data) ? payload.data as unknown[] : [];
}
function parsePage(payload: OrdersEnvelope, fallback: OrderFilters): { items: unknown[]; total: number; page: number; pageSize: number; totalPages: number } {
  const items = pick(payload);
  const data = asObject(payload.data);
  const page = Number(payload.page ?? data.page ?? fallback.page ?? 1);
  const pageSize = Number(payload.pageSize ?? payload.page_size ?? data.pageSize ?? data.page_size ?? fallback.pageSize ?? 20);
  const total = Number(payload.total ?? data.total ?? items.length);
  const totalPages = Number(payload.totalPages ?? payload.total_pages ?? data.totalPages ?? data.total_pages ?? Math.max(1, Math.ceil(total / Math.max(1, pageSize))));
  return { items, total, page, pageSize, totalPages };
}

function asStatus<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T { return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback; }
function mapOrder(raw: unknown, fallbackAccountId?: string): OrderVM {
  const item = asObject(raw);
  const orderNo = String(item.orderNo ?? item.order_no ?? item.orderId ?? item.order_id ?? '');
  const hasMinorAmount = item.amountMinor !== undefined || item.amount_minor !== undefined;
  const amount = Number(item.amountMinor ?? item.amount_minor ?? item.amount ?? 0);
  return {
    orderNo,
    accountId: String(item.accountId ?? item.account_id ?? item.cookieId ?? item.cookie_id ?? fallbackAccountId ?? ''),
    accountName: typeof item.accountName === 'string' ? item.accountName : undefined,
    buyerId: String(item.buyerId ?? item.buyer_id ?? ''),
    buyerName: String(item.buyerName ?? item.buyer_name ?? item.buyerFishNick ?? item.buyer_fish_nick ?? item.buyerId ?? item.buyer_id ?? '未知买家'),
    itemId: String(item.itemId ?? item.item_id ?? ''),
    itemTitle: String(item.itemTitle ?? item.item_title ?? item.itemId ?? item.item_id ?? '未命名商品'),
    amountMinor: hasMinorAmount ? amount : Math.round(amount * 100),
    paymentStatus: asStatus(item.paymentStatus ?? item.payment_status, paymentStatuses, 'unknown'),
    orderStatus: asStatus(item.orderStatus ?? item.order_status, orderStatuses, 'open'),
    deliveryStatus: asStatus(item.deliveryStatus ?? item.delivery_status, deliveryStatuses, 'pending'),
    afterSalesStatus: asStatus(item.afterSalesStatus ?? item.after_sales_status, afterSalesStatuses, 'none'),
    deliveryType: asStatus(item.deliveryType ?? item.delivery_type, ['manual', 'no_logistics', 'coupon_only', 'mixed'] as const, 'manual'),
    createdAt: String(item.createdAt ?? item.created_at ?? item.placedAt ?? item.placed_at ?? ''),
    updatedAt: typeof (item.updatedAt ?? item.updated_at) === 'string' ? String(item.updatedAt ?? item.updated_at) : undefined,
    deliveryFailReason: typeof (item.deliveryFailReason ?? item.delivery_fail_reason) === 'string' ? String(item.deliveryFailReason ?? item.delivery_fail_reason) : undefined,
    conversationId: typeof (item.conversationId ?? item.conversation_id) === 'string' ? String(item.conversationId ?? item.conversation_id) : undefined,
    productId: typeof (item.productId ?? item.product_id) === 'string' ? String(item.productId ?? item.product_id) : undefined,
    configVersion: Number(item.configVersion ?? item.config_version ?? 1),
  };
}

function queryParams(filters: OrderFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({
    accountId: filters.accountId,
    keyword: filters.keyword?.trim() || undefined,
    paymentStatus: filters.paymentStatus && filters.paymentStatus !== 'all' ? filters.paymentStatus : undefined,
    orderStatus: filters.orderStatus && filters.orderStatus !== 'all' ? filters.orderStatus : undefined,
    deliveryStatus: filters.deliveryStatus && filters.deliveryStatus !== 'all' ? filters.deliveryStatus : undefined,
    afterSalesStatus: filters.afterSalesStatus && filters.afterSalesStatus !== 'all' ? filters.afterSalesStatus : undefined,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    page: String(filters.page ?? 1),
    pageSize: String(filters.pageSize ?? 20),
  })) if (value !== undefined && value !== '') params.set(key, value);
  return params.toString();
}

export function createOrdersApi(options: { get: <T>(path: string) => Promise<T>; post: <T>(path: string, body?: unknown) => Promise<T> }): OrdersApi {
  return {
    async list(filters) {
      const payload = await options.get<OrdersEnvelope>(`/api/v1/orders?${queryParams(filters)}`);
      const page = parsePage(payload, filters);
      return { ...page, items: page.items.map((item) => mapOrder(item, filters.accountId)) };
    },
    async getDetail(orderNo, accountId) {
      const payload = await options.get<unknown>(`/api/v1/orders/${encodeURIComponent(orderNo)}${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`);
      const body = asObject(payload);
      return mapOrder(body.data ?? payload, accountId);
    },
    async refresh(accountId) {
      await options.post('/api/v1/orders/refresh', accountId ? { accountId } : {});
    },
  };
}

const mockOrders: OrderVM[] = [
  { orderNo: 'XY202609180012', accountId: 'A', accountName: '闲鱼账号 A', buyerId: 'buyer_983421', buyerName: '陈赟cc', itemId: 'ITEM-93821', itemTitle: 'Python 全栈资料包', amountMinor: 3990, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: '2026-09-18T14:18:00+08:00', updatedAt: '2026-09-18T14:18:00+08:00', configVersion: 1, conversationId: 'cid_001' },
  { orderNo: 'XY202609180009', accountId: 'A', accountName: '闲鱼账号 A', buyerId: 'buyer_221804', buyerName: '麦麦折扣', itemId: 'ITEM-93817', itemTitle: 'GitHub 源码下载', amountMinor: 1990, paymentStatus: 'paid', orderStatus: 'completed', deliveryStatus: 'delivered', afterSalesStatus: 'none', deliveryType: 'mixed', createdAt: '2026-09-18T14:05:00+08:00', updatedAt: '2026-09-18T14:06:00+08:00', configVersion: 1, conversationId: 'cid_002' },
  { orderNo: 'XY202609180003', accountId: 'A', accountName: '闲鱼账号 A', buyerId: 'buyer_442118', buyerName: '梵子BooM', itemId: 'ITEM-93011', itemTitle: '雅思单词 7000 词', amountMinor: 2990, paymentStatus: 'closed', orderStatus: 'closed', deliveryStatus: 'delivered', afterSalesStatus: 'refunding', deliveryType: 'manual', createdAt: '2026-09-18T11:26:00+08:00', updatedAt: '2026-09-18T13:12:00+08:00', configVersion: 2, conversationId: 'cid_003' },
  { orderNo: 'XY202609170088', accountId: 'A', accountName: '闲鱼账号 A', buyerId: 'buyer_668702', buyerName: '北海小姐', itemId: 'ITEM-92007', itemTitle: 'Hermes Agent 企业实战', amountMinor: 5990, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'delivered', afterSalesStatus: 'none', deliveryType: 'no_logistics', createdAt: '2026-09-17T18:41:00+08:00', updatedAt: '2026-09-17T18:42:00+08:00', configVersion: 1 },
  { orderNo: 'XY202609170061', accountId: 'B', accountName: '闲鱼账号 B', buyerId: 'buyer_712633', buyerName: '胡桃夹子', itemId: 'ITEM-93688', itemTitle: 'ComfyUI 基础训练营', amountMinor: 12900, paymentStatus: 'paid', orderStatus: 'failed', deliveryStatus: 'failed', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: '2026-09-17T16:40:00+08:00', updatedAt: '2026-09-17T16:41:00+08:00', deliveryFailReason: '可用卡券库存不足，等待人工处理', configVersion: 1 },
  { orderNo: 'XY202609170032', accountId: 'B', accountName: '闲鱼账号 B', buyerId: 'buyer_16254876', buyerName: '用户_16254876', itemId: 'ITEM-91551', itemTitle: '婚礼视频制作', amountMinor: 9900, paymentStatus: 'closed', orderStatus: 'cancelled', deliveryStatus: 'cancelled', afterSalesStatus: 'closed', deliveryType: 'manual', createdAt: '2026-09-17T10:08:00+08:00', updatedAt: '2026-09-17T10:30:00+08:00', configVersion: 1 },
];

function cloneOrder(order: OrderVM): OrderVM { return { ...order }; }
export function createMockOrdersApi(): OrdersApi {
  return {
    async list(filters) {
      const keyword = filters.keyword?.trim().toLowerCase();
      const filtered = mockOrders.filter((order) => (!filters.accountId || order.accountId === filters.accountId)
        && (!keyword || [order.orderNo, order.buyerId, order.buyerName, order.itemId, order.itemTitle].some((value) => value.toLowerCase().includes(keyword)))
        && (!filters.paymentStatus || filters.paymentStatus === 'all' || order.paymentStatus === filters.paymentStatus)
        && (!filters.orderStatus || filters.orderStatus === 'all' || order.orderStatus === filters.orderStatus)
        && (!filters.deliveryStatus || filters.deliveryStatus === 'all' || order.deliveryStatus === filters.deliveryStatus)
        && (!filters.afterSalesStatus || filters.afterSalesStatus === 'all' || order.afterSalesStatus === filters.afterSalesStatus));
      const sorted = [...filtered].sort((a, b) => {
        const left = filters.sortBy === 'amountMinor' ? a.amountMinor : a.createdAt;
        const right = filters.sortBy === 'amountMinor' ? b.amountMinor : b.createdAt;
        return (left < right ? -1 : left > right ? 1 : 0) * (filters.sortOrder === 'asc' ? 1 : -1);
      });
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;
      return { items: sorted.slice((page - 1) * pageSize, page * pageSize).map(cloneOrder), total: sorted.length, page, pageSize, totalPages: Math.max(1, Math.ceil(sorted.length / pageSize)) };
    },
    async getDetail(orderNo) {
      const order = mockOrders.find((item) => item.orderNo === orderNo);
      if (!order) throw Object.assign(new Error('订单不存在'), { status: 404 });
      return cloneOrder(order);
    },
    async refresh() { return undefined; },
  };
}

export function isApiError(error: unknown, status: number): boolean { return (error as ApiError | undefined)?.status === status; }
export function accountNameForOrder(order: OrderVM, accounts: AccountVM[]): string { return order.accountName ?? accounts.find((account) => account.id === order.accountId)?.displayName ?? order.accountId; }
