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
import type { XianyuApi } from './xianyuApi';

const accounts: AccountSummary[] = [
  { id: 'A', displayName: '闲鱼账号 A', remark: '资料自动发货店', enabled: true, online: true, aiEnabled: true, credentialState: 'complete' },
  { id: 'B', displayName: '闲鱼账号 B', remark: '副店铺 · 课程资料', enabled: true, online: false, aiEnabled: false, credentialState: 'refresh_required' },
  { id: 'C', displayName: '闲鱼账号 C', remark: '测试账号', enabled: false, online: true, aiEnabled: false, credentialState: 'complete' },
];

const products: ProductSummary[] = [
  { accountId: 'A', itemId: 'ITEM-93821', title: 'Python 全栈资料包', price: 39.9, stock: 368, status: 'on_sale', updatedAt: '2026-09-18 14:10', cardBatchRef: '1' },
  { accountId: 'A', itemId: 'ITEM-93817', title: 'GitHub 源码下载', price: 19.9, stock: 129, status: 'on_sale', updatedAt: '2026-09-18 13:42', cardBatchRef: '2' },
  { accountId: 'B', itemId: 'ITEM-93688', title: 'ComfyUI 基础训练营', price: 129, stock: 0, status: 'out_of_stock', updatedAt: '2026-09-16 10:18', cardBatchRef: '3' },
];

const coupons: CouponBatchSummary[] = [
  { batchId: '1', itemId: 'ITEM-93821', itemTitle: 'Python 全栈资料包', total: 400, available: 368, status: 'available', createdAt: '2026-09-18 14:02', accountId: 'A' },
  { batchId: '3', itemId: 'ITEM-93688', itemTitle: 'ComfyUI 基础训练营', total: 100, available: 12, status: 'low_stock', createdAt: '2026-09-16 09:18', accountId: 'B' },
];

const orders: OrderSummary[] = [
  { orderNo: 'XY202609180012', buyerId: 'buyer_983421', buyerName: '陈赟cc', itemId: 'ITEM-93821', itemTitle: 'Python 全栈资料包', amount: 39.9, paymentStatus: 'paid', deliveryStatus: 'pending', createdAt: '2026-09-18 14:18', accountId: 'A' },
  { orderNo: 'XY202609180009', buyerId: 'buyer_221804', buyerName: '麦麦折扣', itemId: 'ITEM-93817', itemTitle: 'GitHub 源码下载', amount: 19.9, paymentStatus: 'completed', deliveryStatus: 'delivered', createdAt: '2026-09-18 14:05', accountId: 'A' },
  { orderNo: 'XY202609170061', buyerId: 'buyer_712633', buyerName: '胡桃夹子', itemId: 'ITEM-93688', itemTitle: 'ComfyUI 基础训练营', amount: 129, paymentStatus: 'paid', deliveryStatus: 'failed', createdAt: '2026-09-17 16:40', accountId: 'B' },
];

const conversations: ConversationSummary[] = [
  { cid: 'cid_001', accountId: 'A', buyerId: 'buyer_983421', buyerName: '陈赟cc', itemTitle: 'Python 全栈资料包', preview: '在吗，付款后多久发货？', unreadCount: 1, lastMessageAt: '14:22' },
  { cid: 'cid_002', accountId: 'A', buyerId: 'buyer_221804', buyerName: '麦麦折扣', itemTitle: 'GitHub 源码下载', preview: '想了解一下课程更新内容', unreadCount: 0, lastMessageAt: '14:16' },
  { cid: 'cid_003', accountId: 'A', buyerId: 'buyer_442118', buyerName: '梵子BooM', itemTitle: '雅思单词 7000 词', preview: '已付款，请查收', unreadCount: 2, lastMessageAt: '13:58' },
];

let settings: AgentSettings = {
  autoReplyEnabled: true,
  autoDeliveryEnabled: true,
  replyDelaySeconds: 180,
  humanApprovalRequiredFor: ['product.publish', 'order.retry_delivery'],
  aiProvider: 'openai-compatible',
  aiModel: 'gpt-4.1-mini',
  systemSettings: {},
};

function page<T>(items: T[], query: PageQuery = {}): PageResult<T> {
  const pageNumber = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const search = query.search?.trim().toLowerCase();
  const filtered = search ? items.filter((item) => JSON.stringify(item).toLowerCase().includes(search)) : items;
  const start = (pageNumber - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page: pageNumber,
    pageSize,
    totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
  };
}

export function createMockApi(): XianyuApi {
  return {
    dashboard: {
      async getSnapshot(): Promise<DashboardSnapshot> {
        return {
          totalSales: 78420,
          todayOrderAmount: 18640,
          selectedRangeSales: 78420,
          autoProcessRate: 96.8,
          pendingManualCount: 3,
          trend: [
            { label: '周一', orderAmount: 58, autoProcessRate: 82 },
            { label: '周二', orderAmount: 64, autoProcessRate: 85 },
            { label: '周三', orderAmount: 61, autoProcessRate: 84 },
            { label: '周四', orderAmount: 75, autoProcessRate: 88 },
            { label: '周五', orderAmount: 72, autoProcessRate: 90 },
            { label: '周六', orderAmount: 84, autoProcessRate: 93 },
          ],
          health: [
            { label: '监听心跳', value: '正常', tone: 'ok' },
            { label: '自动回复策略', value: '180 秒', tone: 'info' },
            { label: '虚拟发货', value: '立即发货', tone: 'ok' },
            { label: '凭证边界', value: '管理员可管理', tone: 'warn' },
          ],
          productRank: [
            { title: 'Python 全栈资料包', subtitle: '虚拟资源 · 交付配置已就绪', orders: '42', deliveryConfig: '已就绪', status: '可交付', tone: 'ok' },
            { title: 'AI 绘画教程合集', subtitle: '虚拟资源 · 交付配置已就绪', orders: '31', deliveryConfig: '已就绪', status: '可交付', tone: 'ok' },
            { title: '考研英语资料', subtitle: '虚拟资源 · 待配置交付内容', orders: '18', deliveryConfig: '待配置', status: '待配置', tone: 'warn' },
            { title: '自动化办公模板', subtitle: '虚拟资源 · 交付配置已就绪', orders: '12', deliveryConfig: '已就绪', status: '可交付', tone: 'ok' },
          ],
          recentActivity: [
            { time: '14:22', text: '小橙子询问付款后发货时间，AI 已引用商品知识 v12 回复。', status: 'AI 已回复', tone: 'ok', href: '/messages' },
            { time: '14:18', text: '订单 XY20260909001 已付款，Outbox 立即发货成功。', status: '已发货', tone: 'ok', href: '/orders' },
            { time: '14:11', text: '买家索要跨商品资源，系统拦截并通知管理员。', status: '风险待确认', tone: 'warn', href: '/workspace' },
            { time: '13:58', text: '考研英语资料付款后未发货，生成待办。', status: '补发货', tone: 'warn', href: '/orders' },
          ],
          riskTodos: [
            { id: 'todo_001', title: '考研英语资料付款后未发货', detail: '订单已付款，需要补充或重试发货。', severity: 'high', href: '/orders' },
            { id: 'todo_002', title: '闲鱼账号 B 需要重新授权', detail: '登录态已过期，消息监听与自动回复已暂停。', severity: 'medium', href: '/accounts' },
            { id: 'todo_003', title: '跨商品资源请求已拦截', detail: '等待人工确认下一步处理策略。', severity: 'low', href: '/messages' },
          ],
        };
      },
    },
    accounts: {
      async list(query) { return page(accounts, query); },
      async switchAccount(accountId) { accounts.forEach((account) => { account.enabled = account.id === accountId; }); },
      async updateStatus(accountId, enabled) { const account = accounts.find((item) => item.id === accountId); if (account) account.enabled = enabled; },
    },
    products: {
      async list(query) { return page(query?.accountId ? products.filter((item) => item.accountId === query.accountId) : products, query); },
      async refresh() {},
    },
    coupons: {
      async list(query) { const scoped = query?.itemId ? coupons.filter((item) => item.itemId === query.itemId) : coupons; return page([...scoped].sort((left, right) => right.createdAt.localeCompare(left.createdAt)), query); },
      async create(input) { const used = new Set(coupons.map((coupon) => Number(coupon.batchId)).filter((value) => Number.isSafeInteger(value) && value > 0)); let next = 1; while (used.has(next)) next += 1; coupons.unshift({ batchId: String(next), itemTitle: input.name, total: 0, available: 0, status: 'available', createdAt: new Date().toISOString(), accountId: 'A' }); },
    },
    orders: {
      async list(query) {
        const scoped = orders.filter((order) => (!query?.accountId || order.accountId === query.accountId) && (!query?.status || order.deliveryStatus === query.status || order.paymentStatus === query.status));
        return page(scoped, query);
      },
      async deliver(orderNo) { const order = orders.find((item) => item.orderNo === orderNo); if (order) order.deliveryStatus = 'delivered'; },
      async retryDelivery(orderNo) { const order = orders.find((item) => item.orderNo === orderNo); if (order) order.deliveryStatus = 'delivered'; },
    },
    chat: {
      async listConversations(accountId, query) { return page(conversations.filter((item) => item.accountId === accountId), query); },
      async listMessages(accountId, cid): Promise<ChatMessage[]> {
        const conversation = conversations.find((item) => item.accountId === accountId && item.cid === cid);
        if (!conversation) return [];
        return [
          { messageId: `${cid}_001`, cid, sender: 'buyer', text: conversation.preview, createdAt: '14:18' },
          { messageId: `${cid}_002`, cid, sender: 'agent', text: '你好，虚拟资源商品付款后会立即自动发送，通常几秒内就能收到。', createdAt: '14:19', source: 'ai' },
        ];
      },
      async sendMessage(input) { const conversation = conversations.find((item) => item.accountId === input.accountId && item.cid === input.cid); if (conversation) conversation.preview = input.text; },
    },
    workspace: {
      async listSessions(): Promise<WorkspaceSession[]> {
        return [
          { id: 'session_product_publish', title: '商品发布助手', preview: '上传图片并生成发布确认卡', status: 'waiting_confirmation', updatedAt: '刚刚' },
          { id: 'session_order_query', title: '订单查询', preview: '查询 XY202609180012 的状态', status: 'completed', updatedAt: '8 分钟前' },
          { id: 'session_coupon_create', title: '卡券生成', preview: '为 Python 全栈资料包生成卡密', status: 'completed', updatedAt: '昨天' },
        ];
      },
      async startRun(input): Promise<WorkspaceRun> {
        return {
          id: `run_${Date.now()}`,
          sessionId: input.sessionId,
          instruction: input.instruction,
          status: 'waiting_confirmation',
          steps: [
            { id: 'step_context', title: '解析账号与商品上下文', status: 'succeeded' },
            { id: 'step_policy', title: '执行策略与风险判断', status: 'succeeded' },
            { id: 'step_confirm', title: '生成外部写动作确认卡', status: 'waiting_confirmation' },
          ],
          auditRef: `AUD-${Date.now()}`,
          idempotencyKey: input.idempotencyKey,
        };
      },
      async confirm(runId): Promise<WorkspaceRun> {
        return {
          id: runId,
          sessionId: 'session_product_publish',
          instruction: '已确认外部写动作',
          status: 'succeeded',
          steps: [
            { id: 'step_context', title: '解析账号与商品上下文', status: 'succeeded' },
            { id: 'step_policy', title: '执行策略与风险判断', status: 'succeeded' },
            { id: 'step_confirm', title: '确认并投递 Outbox', status: 'succeeded' },
          ],
          auditRef: `AUD-${Date.now()}`,
        };
      },
      async getConfirmation(runId): Promise<ConfirmationCard> {
        return {
          id: `confirm_${runId}`,
          runId,
          action: 'product.publish',
          risk: 'medium',
          summary: '发布 Python 全栈资料包到闲鱼账号 A',
          changes: [
            { label: '商品状态', before: '草稿', after: '在售' },
            { label: '图片', before: '0 张', after: '3 张已上传' },
            { label: '交付配置', before: '未校验', after: '已配置' },
          ],
          policyRef: 'product.publish.confirm',
          auditRef: `AUD-${Date.now()}`,
          idempotencyKey: `ITEM-93821-PUBLISH-${Date.now()}`,
        };
      },
    },
    settings: {
      async get() { return { ...settings, systemSettings: { ...settings.systemSettings } }; },
      async update(input) { settings = { ...settings, ...input, systemSettings: { ...settings.systemSettings, ...(input.systemSettings ?? {}) } }; },
    },
  };
}
