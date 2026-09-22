import type {
  AccountSummary,
  AgentSettings,
  ChatMessage,
  ConfirmationCard,
  ConversationSummary,
  CouponBatchSummary,
  DashboardSnapshot,
  OrderSummary,
  PageQuery,
  PageResult,
  ProductSummary,
  WorkspaceRun,
  WorkspaceSession,
} from './contracts';
import { createHttpClient } from './http';

export interface XianyuApi {
  dashboard: {
    getSnapshot(): Promise<DashboardSnapshot>;
  };
  accounts: {
    list(query?: PageQuery): Promise<PageResult<AccountSummary>>;
    switchAccount(accountId: string): Promise<void>;
    updateStatus(accountId: string, enabled: boolean): Promise<void>;
  };
  products: {
    list(query?: PageQuery & { accountId?: string }): Promise<PageResult<ProductSummary>>;
    refresh(accountId?: string): Promise<void>;
  };
  coupons: {
    list(query?: PageQuery & { itemId?: string }): Promise<PageResult<CouponBatchSummary>>;
    create(input: { name: string; type: 'text' | 'data' | 'api' | 'image'; contentRef: string }): Promise<void>;
  };
  orders: {
    list(query?: PageQuery & { accountId?: string; status?: string }): Promise<PageResult<OrderSummary>>;
    deliver(orderNo: string): Promise<void>;
    retryDelivery(orderNo: string): Promise<void>;
  };
  chat: {
    listConversations(accountId: string, query?: PageQuery): Promise<PageResult<ConversationSummary>>;
    listMessages(accountId: string, cid: string): Promise<ChatMessage[]>;
    sendMessage(input: { accountId: string; cid: string; buyerId: string; text: string }): Promise<void>;
  };
  workspace: {
    listSessions(): Promise<WorkspaceSession[]>;
    startRun(input: { sessionId: string; instruction: string; idempotencyKey: string }): Promise<WorkspaceRun>;
    confirm(runId: string, confirmationId: string): Promise<WorkspaceRun>;
    getConfirmation(runId: string): Promise<ConfirmationCard | null>;
  };
  settings: {
    get(): Promise<AgentSettings>;
    update(input: Partial<AgentSettings>): Promise<void>;
  };
}

interface LegacyPage<T> {
  data?: T[];
  list?: T[];
  total?: number;
  page?: number;
  page_size?: number;
  total_pages?: number;
}

interface LegacyAccount {
  id: string;
  enabled?: boolean;
  online?: boolean;
  ai_enabled?: boolean;
  use_ai_reply?: boolean;
  remark?: string;
  note?: string;
  disable_reason?: string;
  login_password?: string;
}

interface LegacyItem {
  cookie_id: string;
  item_id: string;
  title?: string;
  item_title?: string;
  price?: string | number;
  item_price?: string | number;
  item_quantity?: string | number;
  item_status_desc?: string;
  updated_at?: string;
  has_card?: boolean;
}

interface LegacyCard {
  id?: number;
  item_id?: string;
  name: string;
  type?: 'api' | 'text' | 'data' | 'image';
  delivery_count?: number;
  enabled?: boolean;
  created_at?: string;
}

interface LegacyOrder {
  order_id?: string;
  order_no?: string;
  cookie_id: string;
  item_id: string;
  item_title?: string;
  buyer_id: string;
  buyer_fish_nick?: string;
  amount: string | number;
  status?: string;
  delivery_send_status?: 'success' | 'failed' | 'unknown' | 'timeout' | null;
  delivery_fail_reason?: string;
  placed_at?: string;
  created_at?: string;
}

function accountSummary(item: LegacyAccount): AccountSummary {
  return {
    id: item.id,
    displayName: item.id,
    remark: item.remark ?? item.note ?? '',
    enabled: Boolean(item.enabled),
    online: Boolean(item.online),
    aiEnabled: Boolean(item.ai_enabled ?? item.use_ai_reply),
    credentialState: item.disable_reason || item.login_password ? 'complete' : 'missing',
  };
}

function productSummary(item: LegacyItem): ProductSummary {
  const stock = Number(item.item_quantity ?? 0);
  const statusText = item.item_status_desc ?? '';
  const status: ProductSummary['status'] = /下架|offline/i.test(statusText)
    ? 'offline'
    : stock <= 0
      ? 'out_of_stock'
      : /草稿|draft/i.test(statusText)
        ? 'draft'
        : 'on_sale';
  return {
    accountId: item.cookie_id,
    itemId: item.item_id,
    title: item.title ?? item.item_title ?? item.item_id,
    price: Number(item.price ?? item.item_price ?? 0),
    stock,
    status,
    updatedAt: item.updated_at ?? '',
  };
}

function couponSummary(item: LegacyCard): CouponBatchSummary {
  const available = Math.max(0, Number(item.delivery_count ?? 0));
  return {
    batchId: String(item.id ?? item.name),
    itemId: item.item_id,
    itemTitle: item.name,
    total: available,
    available,
    status: available === 0 ? 'delivered' : available < 20 ? 'low_stock' : 'available',
    createdAt: item.created_at ?? '',
    accountId: 'current',
  };
}

function orderSummary(item: LegacyOrder): OrderSummary {
  const status = item.status ?? 'unknown';
  const paymentStatus: OrderSummary['paymentStatus'] = status === 'refunding' || status === 'refunded'
    ? 'refunding'
    : status === 'cancelled'
      ? 'closed'
      : status === 'completed'
        ? 'completed'
        : 'paid';
  const deliveryStatus: OrderSummary['deliveryStatus'] = item.delivery_send_status === 'failed'
    ? 'failed'
    : item.delivery_send_status === 'success' || status === 'shipped' || status === 'completed'
      ? 'delivered'
      : status === 'cancelled'
        ? 'not_delivered'
        : 'pending';
  return {
    orderNo: item.order_no ?? item.order_id ?? '',
    buyerId: item.buyer_id,
    buyerName: item.buyer_fish_nick ?? item.buyer_id,
    itemId: item.item_id,
    itemTitle: item.item_title ?? item.item_id,
    amount: Number(item.amount ?? 0),
    paymentStatus,
    deliveryStatus,
    createdAt: item.placed_at ?? item.created_at ?? '',
    accountId: item.cookie_id,
  };
}

function toPageResult<T>(payload: LegacyPage<T> | T[], page = 1, pageSize = 20): PageResult<T> {
  const items = Array.isArray(payload) ? payload : payload.data ?? payload.list ?? [];
  const total = Array.isArray(payload) ? items.length : payload.total ?? items.length;
  const resolvedPage = Array.isArray(payload) ? page : payload.page ?? page;
  const resolvedPageSize = Array.isArray(payload) ? pageSize : payload.page_size ?? pageSize;
  const totalPages = Array.isArray(payload)
    ? Math.max(1, Math.ceil(total / Math.max(1, resolvedPageSize)))
    : payload.total_pages ?? Math.max(1, Math.ceil(total / Math.max(1, resolvedPageSize)));
  return { items, total, page: resolvedPage, pageSize: resolvedPageSize, totalPages };
}

function queryString(query: PageQuery = {}): string {
  const params = new URLSearchParams();
  params.set('page', String(query.page ?? 1));
  params.set('page_size', String(query.pageSize ?? 20));
  if (query.search?.trim()) params.set('search', query.search.trim());
  return params.toString();
}

export function createLiveApi(options: { baseUrl?: string; getToken?: () => string | null } = {}): XianyuApi {
  const http = createHttpClient(options);

  return {
    dashboard: {
      async getSnapshot() {
        const [adminStats, todayStats, accountStats, trend] = await Promise.all([
          http.get<Record<string, unknown>>('/api/v1/admin/stats'),
          http.get<Record<string, unknown>>('/api/v1/admin/stats/today'),
          http.get<Record<string, unknown>>('/api/v1/cookies/stats'),
          http.get<{ trend?: Array<{ date: string; amount: number; count: number }> }>('/api/v1/cookies/stats/order-trend'),
        ]);
        const admin = (adminStats as { data?: Record<string, unknown> }).data ?? adminStats;
        const today = (todayStats as { data?: Record<string, unknown> }).data ?? todayStats;
        const accounts = (accountStats as { data?: Record<string, unknown> }).data ?? accountStats;
        const rows = trend.trend ?? [];
        return {
          totalSales: Number(admin.total_sales ?? admin.totalSales ?? today.total_order_amount ?? today.order_amount ?? 0),
          todayOrderAmount: Number(today.today_order_amount ?? today.order_amount ?? 0),
          autoProcessRate: Number(admin.auto_process_rate ?? admin.ai_reply_success_rate ?? 0),
          pendingManualCount: Number(admin.pending_manual_count ?? admin.risk_count ?? 0),
          availableCouponCount: Number(accounts.available_card_count ?? accounts.available_coupon_count ?? 0),
          trend: rows.map((row) => ({ label: row.date, orderAmount: row.amount, autoProcessRate: row.count })),
          riskTodos: [],
        };
      },
    },
    accounts: {
      async list(query = {}) {
        const payload = await http.get<LegacyPage<LegacyAccount>>(`/api/v1/cookies/details/paginated?${queryString(query)}`);
        const result = toPageResult(payload, query.page, query.pageSize);
        return { ...result, items: result.items.map(accountSummary) };
      },
      async switchAccount(accountId) {
        await http.put(`/api/v1/cookies/${encodeURIComponent(accountId)}/status`, { enabled: true });
      },
      async updateStatus(accountId, enabled) {
        await http.put(`/api/v1/cookies/${encodeURIComponent(accountId)}/status`, { enabled });
      },
    },
    products: {
      async list(query = {}) {
        const params = new URLSearchParams(queryString(query));
        if (query.accountId) params.set('cookie_id', query.accountId);
        const payload = await http.get<LegacyPage<LegacyItem>>(`/api/v1/items/paginated?${params.toString()}`);
        const result = toPageResult(payload, query.page, query.pageSize);
        return { ...result, items: result.items.map(productSummary) };
      },
      async refresh(accountId) {
        await http.post('/api/v1/items/get-all-from-account', accountId ? { cookie_id: accountId } : {});
      },
    },
    coupons: {
      async list(query = {}) {
        const params = new URLSearchParams(queryString(query));
        if (query.itemId) params.set('item_id', query.itemId);
        const payload = await http.get<LegacyPage<LegacyCard>>(`/api/v1/cards?${params.toString()}`);
        const result = toPageResult(payload, query.page, query.pageSize);
        return { ...result, items: result.items.map(couponSummary) };
      },
      async create(input) {
        await http.post('/api/v1/cards', { name: input.name, type: input.type, text_content: input.contentRef });
      },
    },
    orders: {
      async list(query = {}) {
        const params = new URLSearchParams(queryString(query));
        if (query.accountId) params.set('cookie_id', query.accountId);
        if (query.status) params.set('status', query.status);
        const payload = await http.get<LegacyPage<LegacyOrder>>(`/api/v1/orders?${params.toString()}`);
        const result = toPageResult(payload, query.page, query.pageSize);
        return { ...result, items: result.items.map(orderSummary) };
      },
      async deliver(orderNo) {
        await http.post('/api/v1/orders/manual-delivery', { order_no: orderNo });
      },
      async retryDelivery(orderNo) {
        await http.post('/api/v1/orders/no-logistics-delivery', { order_no: orderNo });
      },
    },
    chat: {
      async listConversations(accountId, query = {}) {
        const params = new URLSearchParams();
        if (query.page) params.set('cursor', String(query.page));
        params.set('limit', String(query.pageSize ?? 20));
        const payload = await http.get<{ data?: { conversations?: ConversationSummary[]; hasMore?: boolean } }>(`/api/v1/chat-new/conversations/${encodeURIComponent(accountId)}?${params.toString()}`);
        const data = payload.data ?? {};
        const items = data.conversations ?? [];
        return { items, total: items.length, page: query.page ?? 1, pageSize: query.pageSize ?? 20, totalPages: data.hasMore ? 2 : 1 };
      },
      async listMessages(accountId, cid) {
        const payload = await http.get<{ data?: { messages?: ChatMessage[] } }>(`/api/v1/chat-new/messages/${encodeURIComponent(accountId)}/${encodeURIComponent(cid)}?limit=100`);
        return payload.data?.messages ?? [];
      },
      async sendMessage(input) {
        await http.post(`/api/v1/chat-new/send-message/${encodeURIComponent(input.accountId)}`, { cid: input.cid, toUserId: input.buyerId, text: input.text });
      },
    },
    workspace: {
      async listSessions() {
        return http.get<WorkspaceSession[]>('/api/v1/agent/sessions');
      },
      async startRun(input) {
        return http.post<WorkspaceRun>('/api/v1/agent/runs', input);
      },
      async confirm(runId, confirmationId) {
        return http.post<WorkspaceRun>(`/api/v1/agent/runs/${encodeURIComponent(runId)}/confirm`, { confirmation_id: confirmationId });
      },
      async getConfirmation(runId) {
        return http.get<ConfirmationCard | null>(`/api/v1/agent/runs/${encodeURIComponent(runId)}/confirmation`);
      },
    },
    settings: {
      async get() {
        const payload = await http.get<Record<string, string | number | boolean>>('/api/v1/system-settings');
        return {
          autoReplyEnabled: Boolean(payload['ai_reply.enabled'] ?? true),
          autoDeliveryEnabled: Boolean(payload['delivery.auto_enabled'] ?? true),
          replyDelaySeconds: Number(payload['reply.delay_seconds'] ?? 180),
          humanApprovalRequiredFor: String(payload['policy.human_approval_actions'] ?? 'product.publish,order.retry_delivery').split(','),
          aiProvider: String(payload['ai.provider'] ?? 'openai-compatible'),
          aiModel: String(payload['ai.model'] ?? 'gpt-4.1-mini'),
          systemSettings: payload,
        };
      },
      async update(input) {
        const patch: Record<string, string | number | boolean> = { ...(input.systemSettings ?? {}) };
        if (input.autoReplyEnabled !== undefined) patch['ai_reply.enabled'] = input.autoReplyEnabled;
        if (input.autoDeliveryEnabled !== undefined) patch['delivery.auto_enabled'] = input.autoDeliveryEnabled;
        if (input.replyDelaySeconds !== undefined) patch['reply.delay_seconds'] = input.replyDelaySeconds;
        if (input.aiProvider !== undefined) patch['ai.provider'] = input.aiProvider;
        if (input.aiModel !== undefined) patch['ai.model'] = input.aiModel;
        await http.put('/api/v1/system-settings', patch);
      },
    },
  };
}
