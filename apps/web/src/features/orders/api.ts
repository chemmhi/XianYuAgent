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
function firstNonBlankString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}
function nestedItemTitle(item: Record<string, unknown>): string | undefined {
  const nested = ['item', 'product', 'goods', 'auction', 'itemInfo', 'item_info'].map((key) => asObject(item[key]));
  return firstNonBlankString(...nested.flatMap((value) => [value.displayItemTitle, value.display_item_title, value.itemTitle, value.item_title, value.itemName, value.item_name, value.productName, value.product_name, value.goodsTitle, value.goods_title, value.productTitle, value.product_title, value.auctionTitle, value.auction_title, value.title, value.name]));
}
function nestedItemImageUrl(item: Record<string, unknown>): string | undefined {
  const nested = ['item', 'product', 'goods', 'auction', 'itemInfo', 'item_info'].map((key) => asObject(item[key]));
  return firstNonBlankString(...nested.flatMap((value) => [value.itemImageUrl, value.item_image_url, value.imageUrl, value.image_url, value.picUrl, value.pic_url, value.mainImageUrl, value.main_image_url]));
}
function mapOrder(raw: unknown, fallbackAccountId?: string): OrderVM {
  const item = asObject(raw);
  const orderNo = String(item.orderNo ?? item.order_no ?? item.orderId ?? item.order_id ?? '');
  const hasMinorAmount = item.amountMinor !== undefined || item.amount_minor !== undefined;
  const amount = Number(item.amountMinor ?? item.amount_minor ?? item.amount ?? 0);
  const buyerName = String(item.buyerName ?? item.buyer_name ?? item.buyerRealName ?? item.buyer_real_name ?? item.receiverName ?? item.receiver_name ?? '');
  const buyerNickname = typeof (item.buyerNickname ?? item.buyer_nickname ?? item.buyerNick ?? item.buyer_nick ?? item.buyerFishNick ?? item.buyer_fish_nick ?? item.fishNick ?? item.userNick ?? item.user_nick ?? item.nickname ?? item.nick) === 'string'
    ? String(item.buyerNickname ?? item.buyer_nickname ?? item.buyerNick ?? item.buyer_nick ?? item.buyerFishNick ?? item.buyer_fish_nick ?? item.fishNick ?? item.userNick ?? item.user_nick ?? item.nickname ?? item.nick)
    : undefined;
  const rawBuyerAvatarUrl = item.buyerAvatarUrl ?? item.buyer_avatar_url ?? item.buyerAvatar ?? item.buyer_avatar ?? item.avatarUrl ?? item.avatar_url ?? item.headPic ?? item.head_pic;
  const buyerAvatarUrl = typeof rawBuyerAvatarUrl === 'string' && rawBuyerAvatarUrl.trim() ? rawBuyerAvatarUrl.trim() : undefined;
  const itemId = String(item.itemId ?? item.item_id ?? '');
  const rawItemTitle = firstNonBlankString(item.displayItemTitle, item.display_item_title, item.itemTitle, item.item_title, item.itemName, item.item_name, item.productName, item.product_name, item.goodsTitle, item.goods_title, item.productTitle, item.product_title, item.auctionTitle, item.auction_title, item.title, nestedItemTitle(item));
  const itemTitle = rawItemTitle && rawItemTitle !== itemId.trim() ? rawItemTitle : '';
  const itemImageUrl = firstNonBlankString(item.itemImageUrl, item.item_image_url, item.itemImage, item.item_image, item.imageUrl, item.image_url, item.picUrl, item.pic_url, item.mainImageUrl, item.main_image_url, nestedItemImageUrl(item));
  return {
    orderNo,
    accountId: String(item.accountId ?? item.account_id ?? item.cookieId ?? item.cookie_id ?? fallbackAccountId ?? ''),
    accountName: typeof item.accountName === 'string' ? item.accountName : undefined,
    buyerId: String(item.buyerId ?? item.buyer_id ?? ''),
    buyerName,
    buyerNickname,
    buyerAvatarUrl,
    itemId,
    itemTitle,
    itemImageUrl,
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

export function createOrdersApi(options: { get: <T>(path: string) => Promise<T>; post: <T>(path: string, body?: unknown, init?: RequestInit) => Promise<T> }): OrdersApi {
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
      await options.post('/api/v1/orders/refresh', accountId ? { accountId } : {}, { headers: { 'Idempotency-Key': `order-refresh-${accountId ?? 'active'}-${Date.now()}` } });
    },
  };
}

const mockBuyerAvatarUrl = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22 viewBox=%220 0 40 40%22%3E%3Ccircle cx=%2220%22 cy=%2220%22 r=%2220%22 fill=%22%23dbeafe%22/%3E%3Ccircle cx=%2220%22 cy=%2216%22 r=%227%22 fill=%22%231d4ed8%22/%3E%3Cpath d=%22M9 34c2-7 20-7 22 0%22 fill=%22%231d4ed8%22/%3E%3C/svg%3E';

const mockOrders: OrderVM[] = [
  { orderNo: 'XY202609180012', accountId: 'A', accountName: '闲鱼账号 A', buyerId: 'buyer_983421', buyerNickname: '陈赟cc', buyerName: '陈赟', buyerAvatarUrl: mockBuyerAvatarUrl, itemId: 'ITEM-93821', itemTitle: 'Python 全栈资料包', amountMinor: 3990, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: '2026-09-18T14:18:00+08:00', updatedAt: '2026-09-18T14:18:00+08:00', configVersion: 1, conversationId: 'cid_001' },
  { orderNo: 'XY202609180009', accountId: 'A', accountName: '闲鱼账号 A', buyerId: 'buyer_221804', buyerNickname: '麦麦折扣', buyerName: '麦麦', itemId: 'ITEM-93817', itemTitle: 'GitHub 源码下载', amountMinor: 1990, paymentStatus: 'paid', orderStatus: 'completed', deliveryStatus: 'delivered', afterSalesStatus: 'none', deliveryType: 'mixed', createdAt: '2026-09-18T14:05:00+08:00', updatedAt: '2026-09-18T14:06:00+08:00', configVersion: 1, conversationId: 'cid_002' },
  { orderNo: 'XY202609180003', accountId: 'A', accountName: '闲鱼账号 A', buyerId: 'buyer_442118', buyerNickname: '梵子BooM', buyerName: '梵子', itemId: 'ITEM-93011', itemTitle: '雅思单词 7000 词', amountMinor: 2990, paymentStatus: 'closed', orderStatus: 'closed', deliveryStatus: 'delivered', afterSalesStatus: 'refunding', deliveryType: 'manual', createdAt: '2026-09-18T11:26:00+08:00', updatedAt: '2026-09-18T13:12:00+08:00', configVersion: 2, conversationId: 'cid_003' },
  { orderNo: 'XY202609170088', accountId: 'A', accountName: '闲鱼账号 A', buyerId: 'buyer_668702', buyerNickname: '北海小姐', buyerName: '北海', itemId: 'ITEM-92007', itemTitle: 'Hermes Agent 企业实战', amountMinor: 5990, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'delivered', afterSalesStatus: 'none', deliveryType: 'no_logistics', createdAt: '2026-09-17T18:41:00+08:00', updatedAt: '2026-09-17T18:42:00+08:00', configVersion: 1 },
  { orderNo: 'XY202609170061', accountId: 'B', accountName: '闲鱼账号 B', buyerId: 'buyer_712633', buyerNickname: '胡桃夹子', buyerName: '胡桃', itemId: 'ITEM-93688', itemTitle: 'ComfyUI 基础训练营', amountMinor: 12900, paymentStatus: 'paid', orderStatus: 'failed', deliveryStatus: 'failed', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: '2026-09-17T16:40:00+08:00', updatedAt: '2026-09-17T16:41:00+08:00', deliveryFailReason: '未找到可交付配置，等待人工处理', configVersion: 1 },
  { orderNo: 'XY202609170032', accountId: 'B', accountName: '用户_16254876', buyerId: 'buyer_16254876', buyerNickname: '用户_16254876', buyerName: '用户', itemId: 'ITEM-91551', itemTitle: '婚礼视频制作', amountMinor: 9900, paymentStatus: 'closed', orderStatus: 'cancelled', deliveryStatus: 'cancelled', afterSalesStatus: 'closed', deliveryType: 'manual', createdAt: '2026-09-17T10:08:00+08:00', updatedAt: '2026-09-17T10:30:00+08:00', configVersion: 1 },
];

function cloneOrder(order: OrderVM): OrderVM { return { ...order }; }
export function createMockOrdersApi(): OrdersApi {
  return {
    async list(filters) {
      const keyword = filters.keyword?.trim().toLowerCase();
      const filtered = mockOrders.filter((order) => (!filters.accountId || order.accountId === filters.accountId)
        && (!keyword || [order.orderNo, order.buyerNickname ?? '', order.itemTitle].some((value) => value.toLowerCase().includes(keyword)))
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
