import type {
  AccountRecord,
  ConversationRecord,
  CouponBatchRecord,
  OrderRecord,
  ProductRecord,
  Store,
} from './domain.js';

export interface DashboardTrendPoint {
  label: string;
  orderAmount: number;
  autoProcessRate: number;
}

export type DashboardRange = 'today' | '3d' | '7d' | '1m' | 'custom';

export interface DashboardQuery {
  range?: DashboardRange;
  from?: string;
  to?: string;
}

export interface DashboardSnapshot {
  totalSales: number;
  todayOrderAmount: number;
  autoProcessRate: number;
  pendingManualCount: number;
  availableCouponCount: number;
  trend: DashboardTrendPoint[];
  health: Array<{ label: string; value: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'gray' }>;
  productRank: Array<{ title: string; subtitle: string; orders: string; stock: string; status: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'gray' }>;
  recentActivity: Array<{ time: string; text: string; status: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'gray'; href?: string }>;
  riskTodos: Array<{ id: string; title: string; detail?: string; severity: 'high' | 'medium' | 'low'; href: string }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DASHBOARD_PAGE_SIZE = 1_000;
const ACTIVITY_LIMIT = 8;
const RISK_LIMIT = 8;
const DASHBOARD_RANGES: readonly DashboardRange[] = ['today', '3d', '7d', '1m', 'custom'];

/**
 * Read-only dashboard projection. The service deliberately composes Store
 * queries instead of reaching into PostgreSQL so MemoryStore and Postgres
 * share the exact same aggregation behavior and authorization boundary.
 */
export class DashboardService {
  constructor(private readonly store: Store) {}

  async getSnapshot(adminId: string, query?: DashboardQuery): Promise<DashboardSnapshot>;
  async getSnapshot(adminId: string, now?: Date, query?: DashboardQuery): Promise<DashboardSnapshot>;
  async getSnapshot(adminId: string, nowOrQuery: Date | DashboardQuery = new Date(), query: DashboardQuery = {}): Promise<DashboardSnapshot> {
    const now = nowOrQuery instanceof Date ? nowOrQuery : new Date();
    const resolvedQuery = nowOrQuery instanceof Date ? query : nowOrQuery;
    const [accountsResult, productsResult, ordersResult, couponsResult, conversationsResult] = await Promise.all([
      this.store.listAccounts(adminId, { page: 1, pageSize: DASHBOARD_PAGE_SIZE }),
      this.store.listProducts(adminId, { page: 1, pageSize: DASHBOARD_PAGE_SIZE, sortBy: 'updatedAt', sortOrder: 'desc' }),
      this.store.listOrders(adminId, { page: 1, pageSize: DASHBOARD_PAGE_SIZE, sortBy: 'createdAt', sortOrder: 'desc' }),
      this.store.listCouponBatches(adminId, { page: 1, pageSize: DASHBOARD_PAGE_SIZE }),
      this.store.listConversations(adminId, { limit: DASHBOARD_PAGE_SIZE }),
    ]);

    const accounts = accountsResult.items;
    const products = productsResult.items;
    const orders = ordersResult.items;
    const coupons = couponsResult.items;
    const conversations = conversationsResult.items;

    const trend = buildTrend(orders, now, resolvedQuery);
    const todayStart = startOfUtcDay(now);
    const todayOrders = orders.filter((order) => parseTime(order.createdAt) >= todayStart);
    const paidOrders = orders.filter((order) => order.paymentStatus === 'paid');
    const availableCouponCount = coupons.reduce((sum, batch) => sum + Number(batch.availableCount ?? 0), 0);
    const pendingManualCount = countPendingManual(orders, accounts, coupons, conversations);

    return {
      totalSales: round(sumMajorUnits(paidOrders)),
      todayOrderAmount: round(sumMajorUnits(todayOrders)),
      autoProcessRate: autoProcessRate(todayOrders),
      pendingManualCount,
      availableCouponCount,
      trend,
      health: buildHealth(accounts, availableCouponCount),
      productRank: buildProductRank(products, orders, coupons),
      recentActivity: buildRecentActivity(orders, conversations, now),
      riskTodos: buildRiskTodos(accounts, orders, coupons, conversations),
    };
  }
}

function buildTrend(orders: OrderRecord[], now: Date, query: DashboardQuery): DashboardTrendPoint[] {
  const window = resolveTrendWindow(now, query);
  const points: DashboardTrendPoint[] = [];
  const bucketMs = window.granularity === 'hour' ? HOUR_MS : DAY_MS;
  for (let bucketStart = window.start; bucketStart < window.end; bucketStart += bucketMs) {
    const bucketEnd = Math.min(bucketStart + bucketMs, window.end);
    const bucketOrders = orders.filter((order) => {
      const createdAt = parseTime(order.createdAt);
      return createdAt >= bucketStart && createdAt < bucketEnd;
    });
    const date = new Date(bucketStart);
    points.push({
      label: window.granularity === 'hour' ? hourLabel(date) : dayLabel(date, window.dayCount),
      orderAmount: round(sumMajorUnits(bucketOrders)),
      autoProcessRate: autoProcessRate(bucketOrders),
    });
  }
  return points;
}

function resolveTrendWindow(now: Date, query: DashboardQuery): { start: number; end: number; granularity: 'hour' | 'day'; dayCount: number } {
  const rawRange = query.range ?? (query.from || query.to ? 'custom' : '7d');
  const range = DASHBOARD_RANGES.includes(rawRange as DashboardRange) ? rawRange as DashboardRange : '7d';
  const todayStart = startOfUtcDay(now);
  if (range === 'today') return { start: todayStart, end: todayStart + DAY_MS, granularity: 'hour', dayCount: 1 };
  if (range === '3d') return { start: todayStart - (3 - 1) * DAY_MS, end: todayStart + DAY_MS, granularity: 'day', dayCount: 3 };
  if (range === '1m') return { start: todayStart - (30 - 1) * DAY_MS, end: todayStart + DAY_MS, granularity: 'day', dayCount: 30 };
  if (range === 'custom') {
    const custom = resolveCustomWindow(query.from, query.to, now);
    const dayCount = Math.max(1, Math.ceil((custom.end - custom.start) / DAY_MS));
    return { ...custom, granularity: dayCount === 1 && custom.end - custom.start <= DAY_MS ? 'hour' : 'day', dayCount };
  }
  return { start: todayStart - (7 - 1) * DAY_MS, end: todayStart + DAY_MS, granularity: 'day', dayCount: 7 };
}

function resolveCustomWindow(from: string | undefined, to: string | undefined, now: Date): { start: number; end: number } {
  if (!from || !to) return { start: startOfUtcDay(now), end: startOfUtcDay(now) + DAY_MS };
  const start = parseBoundary(from, false);
  const end = parseBoundary(to, true);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { start: startOfUtcDay(now), end: startOfUtcDay(now) + DAY_MS };
  return { start, end };
}

function parseBoundary(value: string, endOfDate: boolean): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return Number.NaN;
  if (endOfDate && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return startOfUtcDay(new Date(parsed)) + DAY_MS;
  return parsed;
}

function buildHealth(accounts: AccountRecord[], availableCouponCount: number): DashboardSnapshot['health'] {
  const connected = accounts.filter((account) => account.status === 'connected').length;
  const degraded = accounts.filter((account) => account.status === 'degraded' || account.status === 'expired' || account.status === 'disconnected').length;
  return [
    { label: '监听心跳', value: connected > 0 ? '正常' : degraded > 0 ? '需授权' : '待连接', tone: connected > 0 ? 'ok' : degraded > 0 ? 'warn' : 'gray' },
    { label: '自动回复策略', value: '已配置', tone: 'info' },
    { label: '虚拟发货', value: availableCouponCount > 0 ? '库存正常' : '库存告警', tone: availableCouponCount > 0 ? 'ok' : 'warn' },
    { label: '凭证边界', value: '管理员可管理', tone: 'warn' },
  ];
}

function buildProductRank(products: ProductRecord[], orders: OrderRecord[], coupons: CouponBatchRecord[]): DashboardSnapshot['productRank'] {
  const ordersByProduct = new Map<string, number>();
  const ordersByTitle = new Map<string, number>();
  for (const order of orders) {
    if (order.productId) ordersByProduct.set(order.productId, (ordersByProduct.get(order.productId) ?? 0) + 1);
    ordersByTitle.set(order.itemTitle, (ordersByTitle.get(order.itemTitle) ?? 0) + 1);
  }

  const stockByAccount = new Map<string, number>();
  for (const batch of coupons) stockByAccount.set(batch.accountId, (stockByAccount.get(batch.accountId) ?? 0) + Number(batch.availableCount ?? 0));

  return [...products]
    .map((product) => {
      const orderCount = ordersByProduct.get(product.id) ?? ordersByTitle.get(product.title) ?? 0;
      const stock = stockByAccount.get(product.accountId) ?? 0;
      const published = product.status === 'published' || product.status === 'ready';
      const available = published && stock > 0;
      return {
        orderCount,
        updatedAt: product.updatedAt,
        row: {
          title: product.title,
          subtitle: `虚拟资源 · ${stock > 0 ? '库存正常' : '缺库存'}`,
          orders: String(orderCount),
          stock: String(stock),
          status: available ? '可售' : stock === 0 ? '缺库存' : '待配置',
          tone: available ? 'ok' as const : stock === 0 ? 'warn' as const : 'gray' as const,
        },
      };
    })
    .sort((left, right) => right.orderCount - left.orderCount || right.updatedAt.localeCompare(left.updatedAt) || left.row.title.localeCompare(right.row.title))
    .slice(0, 4)
    .map((entry) => entry.row);
}

function buildRecentActivity(orders: OrderRecord[], conversations: ConversationRecord[], now: Date): DashboardSnapshot['recentActivity'] {
  const activity = [
    ...orders.map((order) => {
      const status = order.deliveryStatus === 'delivered' ? '已发货' : order.deliveryStatus === 'failed' ? '发货失败' : '待处理';
      const tone = order.deliveryStatus === 'delivered' ? 'ok' as const : order.deliveryStatus === 'failed' ? 'danger' as const : 'warn' as const;
      return { at: parseTime(order.updatedAt || order.createdAt), time: formatTime(order.updatedAt || order.createdAt), text: `订单 ${order.orderNo} ${status}`, status, tone, href: '/orders' };
    }),
    ...conversations.filter((conversation) => conversation.unreadCount > 0).map((conversation) => ({
      at: parseTime(conversation.lastMessageAt || conversation.updatedAt),
      time: formatTime(conversation.lastMessageAt || conversation.updatedAt),
      text: `${conversation.buyerDisplayName || conversation.buyerRef} 有 ${conversation.unreadCount} 条未读消息`,
      status: '待回复',
      tone: 'warn' as const,
      href: '/messages',
    })),
  ];
  const cutoff = now.getTime() - DAY_MS;
  return activity.filter((item) => item.at >= cutoff).sort((left, right) => right.at - left.at).slice(0, ACTIVITY_LIMIT).map(({ at: _at, ...item }) => item);
}

function buildRiskTodos(accounts: AccountRecord[], orders: OrderRecord[], coupons: CouponBatchRecord[], conversations: ConversationRecord[]): DashboardSnapshot['riskTodos'] {
  const todos: DashboardSnapshot['riskTodos'] = [];
  for (const account of accounts.filter((item) => ['expired', 'disconnected', 'degraded'].includes(item.status))) {
    todos.push({ id: `account-${account.id}`, title: `${account.displayName || account.sellerRef} 需要重新授权`, detail: '登录态不可用，消息监听与自动处理可能已暂停。', severity: account.status === 'expired' ? 'high' : 'medium', href: '/accounts' });
  }
  for (const order of orders.filter((item) => item.paymentStatus === 'paid' && ['pending', 'partially_delivered', 'failed'].includes(item.deliveryStatus))) {
    const failed = order.deliveryStatus === 'failed';
    todos.push({ id: `order-${order.id}`, title: `${order.itemTitle} ${failed ? '发货失败' : '待人工处理'}`, detail: failed ? (order.deliveryFailReason || '外部发货未成功，需要复核。') : '订单已付款但还没有完成交付。', severity: failed ? 'high' : 'medium', href: '/orders' });
  }
  for (const coupon of coupons.filter((item) => item.status === 'active' && Number(item.availableCount ?? 0) === 0)) {
    todos.push({ id: `coupon-${coupon.id}`, title: `${coupon.label || coupon.purpose} 缺少可售库存`, detail: '请补充卡密库存后再继续自动发货。', severity: 'high', href: '/coupons' });
  }
  for (const conversation of conversations.filter((item) => item.unreadCount > 0)) {
    todos.push({ id: `conversation-${conversation.id}`, title: `${conversation.buyerDisplayName || conversation.buyerRef} 有待回复消息`, detail: `${conversation.unreadCount} 条消息等待处理。`, severity: 'low', href: '/messages' });
  }
  return todos.slice(0, RISK_LIMIT);
}

function countPendingManual(orders: OrderRecord[], accounts: AccountRecord[], coupons: CouponBatchRecord[], conversations: ConversationRecord[]): number {
  return orders.filter((order) => order.paymentStatus === 'paid' && order.deliveryStatus !== 'delivered' && order.deliveryStatus !== 'cancelled').length
    + accounts.filter((account) => ['expired', 'disconnected', 'degraded'].includes(account.status)).length
    + coupons.filter((batch) => batch.status === 'active' && Number(batch.availableCount ?? 0) === 0).length
    + conversations.filter((conversation) => conversation.unreadCount > 0).length;
}

function autoProcessRate(orders: OrderRecord[]): number {
  const actionable = orders.filter((order) => order.paymentStatus === 'paid' && order.deliveryStatus !== 'cancelled');
  if (actionable.length === 0) return 0;
  return round((actionable.filter((order) => order.deliveryStatus === 'delivered').length / actionable.length) * 100, 1);
}

function sumMajorUnits(orders: OrderRecord[]): number {
  return orders.reduce((sum, order) => sum + Number(order.amountMinor || 0) / 100, 0);
}

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseTime(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTime(value: string | undefined): string {
  const parsed = parseTime(value);
  if (!parsed) return '--:--';
  return new Date(parsed).toISOString().slice(11, 16);
}

function weekdayLabel(date: Date): string {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getUTCDay()]!;
}

function hourLabel(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, '0')}:00`;
}

function dayLabel(date: Date, dayCount: number): string {
  return dayCount === 7 ? weekdayLabel(date) : `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
