import type { AutoReplyActivitySummary, CouponBatchRecord, OrderRecord, ProductRecord, Store } from './domain.js';

export type NativeWorkspaceReadKind = 'products' | 'coupons' | 'orders' | 'agent_activity';

export interface NativeWorkspaceReadResult {
  kind: NativeWorkspaceReadKind;
  title: string;
  content: string;
  summary: string;
  data: Record<string, unknown>;
}

const WRITE_TERMS = /(发布|上传|新增|创建|修改|编辑|更新|保存|删除|作废|绑定|解绑|发货|发送|配置|设置|改价|撤回)/i;
const READ_TERMS = /(查看|查询|列出|列表|有哪些|多少|最近|状态|数据|概览|统计|当前|未发货|运营|处理量|成功率|耗时|失败|转人工|只读|仅查询|仅返回|仅查看)/i;

export function detectNativeWorkspaceRead(instruction: string): NativeWorkspaceReadKind | undefined {
  const normalized = instruction.replace(/\s+/g, ' ').trim();
  if (!normalized || WRITE_TERMS.test(normalized) && !/(查看|查询|状态|未发货|失败|只读|仅查询|仅返回|仅查看)/i.test(normalized)) return undefined;
  if (!READ_TERMS.test(normalized)) return undefined;
  if (/(运营|自动回复|agent|智能客服|处理量|成功率|吞吐|p95|转人工|健康|运行数据|workspace\s*状态|工作区状态|状态摘要|运行摘要)/i.test(normalized)) return 'agent_activity';
  if (/(卡券|卡密|优惠券|券批次|交付配置)/i.test(normalized)) return 'coupons';
  if (/(订单|买家|付款|支付|未发货|交付)/i.test(normalized)) return 'orders';
  if (/(商品|货架|库存|商品列表|商品状态)/i.test(normalized)) return 'products';
  return undefined;
}

export async function executeNativeWorkspaceRead(input: { store: Store; adminId: string; accountId: string; instruction: string; now?: Date }): Promise<NativeWorkspaceReadResult | undefined> {
  const kind = detectNativeWorkspaceRead(input.instruction);
  if (!kind) return undefined;
  if (!input.adminId || !(await input.store.hasAccountScope(input.adminId, input.accountId))) throw new Error('ACCOUNT_SCOPE_FORBIDDEN');
  const now = input.now ?? new Date();
  if (kind === 'products') {
    const result = await input.store.listProducts(input.adminId, { accountId: input.accountId, page: 1, pageSize: 20, sortBy: 'updatedAt', sortOrder: 'desc' });
    return productResult(result.items, result.total);
  }
  if (kind === 'coupons') {
    const result = await input.store.listCouponBatches(input.adminId, { accountId: input.accountId, page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' });
    return couponResult(result.items, result.total);
  }
  if (kind === 'orders') {
    const result = await input.store.listOrders(input.adminId, { accountId: input.accountId, page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' });
    return orderResult(result.items, result.total);
  }
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const to = now.toISOString();
  const summary = await input.store.getAutoReplyActivitySummary(input.adminId, { accountId: input.accountId, from, to });
  return activityResult(summary);
}

function productResult(items: ProductRecord[], total: number): NativeWorkspaceReadResult {
  const rows = items.map((item) => ({ id: item.id, externalProductRef: item.externalProductRef, title: item.title, status: item.status, priceMinor: item.priceMinor, skuCount: item.skuCount ?? 0, assetCount: item.assetCount ?? 0, couponBindingCount: item.couponBatches?.length ?? 0, updatedAt: item.updatedAt }));
  const content = rows.length === 0
    ? '当前账号暂无商品。'
    : [`当前账号共有 ${total} 个商品，以下展示最近更新的 ${rows.length} 个：`, ...rows.map((item, index) => `${index + 1}. ${item.title} · ${productStatusLabel(item.status)} · ${formatMoney(item.priceMinor)} · SKU ${item.skuCount} · 卡券绑定 ${item.couponBindingCount} · 更新于 ${formatTime(item.updatedAt)}`)].join('\n');
  return { kind: 'products', title: '商品查询', content, summary: `已读取 ${total} 个商品`, data: { total, items: rows } };
}

function couponResult(items: CouponBatchRecord[], total: number): NativeWorkspaceReadResult {
  const rows = items.map((item) => ({ id: item.id, label: item.label ?? item.sequenceId ?? item.id, purpose: item.purpose, status: item.status, totalCount: item.totalCount, availableCount: item.availableCount, reservedCount: item.reservedCount, consumedCount: item.consumedCount, bindingCount: item.bindings?.length ?? 0, productIds: item.bindings?.map((binding) => binding.productId) ?? [], updatedAt: item.updatedAt }));
  const content = rows.length === 0
    ? '当前账号暂无卡券批次。'
    : [`当前账号共有 ${total} 个卡券批次，以下展示最近更新的 ${rows.length} 个：`, ...rows.map((item, index) => `${index + 1}. ${item.label} · ${couponPurposeLabel(item.purpose)} · ${couponStatusLabel(item.status)} · 可用 ${item.availableCount ?? '—'}/${item.totalCount} · 绑定商品 ${item.bindingCount} · 更新于 ${formatTime(item.updatedAt)}`)].join('\n');
  return { kind: 'coupons', title: '卡券查询', content, summary: `已读取 ${total} 个卡券批次`, data: { total, items: rows } };
}

function orderResult(items: OrderRecord[], total: number): NativeWorkspaceReadResult {
  const rows = items.map((item) => ({ orderNo: item.orderNo, itemTitle: item.itemTitle, amountMinor: item.amountMinor, paymentStatus: item.paymentStatus, orderStatus: item.orderStatus, deliveryStatus: item.deliveryStatus, afterSalesStatus: item.afterSalesStatus, createdAt: item.createdAt, updatedAt: item.updatedAt }));
  const content = rows.length === 0
    ? '当前账号暂无订单。'
    : [`当前账号共有 ${total} 个订单，以下展示最近的 ${rows.length} 个：`, ...rows.map((item, index) => `${index + 1}. ${item.orderNo} · ${item.itemTitle} · 买家信息已脱敏 · ${formatMoney(item.amountMinor)} · 支付 ${paymentStatusLabel(item.paymentStatus)} · 交付 ${deliveryStatusLabel(item.deliveryStatus)} · ${formatTime(item.createdAt)}`)].join('\n');
  return { kind: 'orders', title: '订单查询', content, summary: `已读取 ${total} 个订单`, data: { total, items: rows } };
}

function activityResult(summary: AutoReplyActivitySummary): NativeWorkspaceReadResult {
  const completionRate = summary.completionRate <= 1 ? `${(summary.completionRate * 100).toFixed(1)}%` : `${summary.completionRate.toFixed(1)}%`;
  const content = [
    `过去 24 小时 Agent 运营摘要（${formatTime(summary.from)}–${formatTime(summary.to)}）`,
    `- 收到 ${summary.inboundCount} 条消息，处理中 ${summary.processingCount} 条，已持久化 ${summary.persistedCount} 条`,
    `- 完成率 ${completionRate}，转人工 ${summary.handoffCount} 条，失败 ${summary.failedCount} 条，跳过 ${summary.skippedCount} 条`,
    `- 吞吐 ${summary.throughputPerSecond.toFixed(3)}/秒，P95 ${Math.round(summary.p95DurationMs)}ms`,
    ...summary.health.slice(0, 6).map((item) => `- ${item.component}：${item.status}`),
  ].join('\n');
  return { kind: 'agent_activity', title: 'Agent 运营数据', content, summary: `已读取 Agent 运营摘要（${summary.inboundCount} 条入站）`, data: { from: summary.from, to: summary.to, inboundCount: summary.inboundCount, processingCount: summary.processingCount, persistedCount: summary.persistedCount, handoffCount: summary.handoffCount, failedCount: summary.failedCount, skippedCount: summary.skippedCount, completionRate: summary.completionRate, throughputPerSecond: summary.throughputPerSecond, p95DurationMs: summary.p95DurationMs, health: summary.health } };
}

function formatMoney(valueMinor?: number): string { return typeof valueMinor === 'number' && Number.isFinite(valueMinor) ? `¥${(valueMinor / 100).toFixed(2)}` : '价格未设置'; }
function formatTime(value: string): string { const parsed = Date.parse(value); return Number.isFinite(parsed) ? new Date(parsed).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '时间未知'; }
function productStatusLabel(status: string): string { return ({ draft: '草稿', ready: '待发布', publishing: '发布中', published: '已发布', failed: '发布失败', archived: '已归档' } as Record<string, string>)[status] ?? status; }
function couponPurposeLabel(purpose: string): string { return ({ text: '文本', data: '数据', api: 'API', image: '图片' } as Record<string, string>)[purpose] ?? purpose; }
function couponStatusLabel(status: string): string { return ({ active: '有效', depleted: '已耗尽', voided: '已作废', archived: '已归档' } as Record<string, string>)[status] ?? status; }
function paymentStatusLabel(status: string): string { return ({ unpaid: '未支付', paid: '已支付', closed: '已关闭', unknown: '未知' } as Record<string, string>)[status] ?? status; }
function deliveryStatusLabel(status: string): string { return ({ pending: '待交付', reserving: '预留中', delivered: '已交付', partially_delivered: '部分交付', failed: '失败', cancelled: '已取消' } as Record<string, string>)[status] ?? status; }
