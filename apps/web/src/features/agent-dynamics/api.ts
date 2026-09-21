import { ApiError } from '../../api/http';
import type {
  AgentDynamicsDecision,
  AgentDynamicsFilters,
  AgentDynamicsRange,
  AgentDynamicsRunDetailVM,
  AgentDynamicsRunsPageVM,
  AgentDynamicsRunRowVM,
  AgentDynamicsStage,
  AgentDynamicsSummaryVM,
  AgentDynamicsTimelineItemVM,
  AgentDynamicsTone,
} from './types';
import {
  formatTime,
  runStageFromStatus,
  stageLabel,
  toneForDecision,
  type AgentDynamicsRunStatus,
} from './types';

export interface AgentDynamicsApiTransport {
  get<T>(path: string): Promise<T>;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  message?: string | null;
  error?: { code?: string };
}

type BackendRun = {
  id: string;
  accountId?: string;
  conversationId?: string;
  intent?: string;
  decision?: AgentDynamicsDecision;
  status?: AgentDynamicsRunStatus;
  stage?: string;
  senderOutcome?: 'simulated' | 'known_success' | 'known_failure' | 'unknown';
  failureCode?: string;
  createdAt: string;
  updatedAt?: string;
  durationMs?: number;
  buyerDisplayName?: string;
  productTitle?: string;
  productId?: string;
  inboundMessagePreview?: string;
};

type BackendSummary = {
  from: string;
  to: string;
  asOf: string;
  inboundCount: number;
  processingCount: number;
  persistedCount: number;
  handoffCount: number;
  failedCount: number;
  skippedCount: number;
  completionRate: number;
  throughputPerSecond: number;
  p95DurationMs: number;
  byStatus: Array<{ status: AgentDynamicsRunStatus; count: number }>;
  byStage: Array<{ stage: string; count: number; averageDurationMs: number }>;
  exceptions: Array<{ code: string; count: number; status: AgentDynamicsRunStatus }>;
  health: Array<{ component: string; status: string; observedAt: string; details: Record<string, unknown> }>;
};

type BackendRunDetail = {
  run: BackendRun;
  events?: Array<{ id: string; eventType: string; stage: string; status: AgentDynamicsRunStatus; occurredAt: string }>;
  conversation?: { buyerDisplayName?: string; buyerAvatarUrl?: string };
  inboundMessage?: { bodyText?: string };
  outboundMessages?: Array<{ bodyText?: string }>;
  product?: { id?: string; title?: string };
};

const PROCESSING_STATUSES = new Set<AgentDynamicsRunStatus>(['received', 'classified', 'context_loaded', 'generated', 'simulated']);

function rangeParams(range: AgentDynamicsRange): { from: string; to: string } {
  const to = Date.now();
  const days = range === '7d' ? 7 : 1;
  return { from: new Date(to - days * 24 * 60 * 60 * 1000).toISOString(), to: new Date(to).toISOString() };
}

function stageKey(stageOrStatus: string | undefined, status: AgentDynamicsRunStatus | undefined): AgentDynamicsStage {
  if (stageOrStatus === 'gateway_received') return 'gateway';
  if (stageOrStatus === 'intent_recognition') return 'intent';
  if (stageOrStatus === 'context_read') return 'context';
  if (stageOrStatus === 'reply_generation') return 'generation';
  if (stageOrStatus === 'sending' || stageOrStatus === 'persisted') return 'persistence';
  if (stageOrStatus === 'handoff' || stageOrStatus === 'failed' || stageOrStatus === 'skipped') return 'generation';
  return status ? runStageFromStatus(status) : 'gateway';
}

function stageTone(stage: AgentDynamicsStage): AgentDynamicsTone {
  return stage === 'generation' ? 'warn' : stage === 'persistence' ? 'info' : 'success';
}

function statusLabel(status: AgentDynamicsRunStatus | undefined, decision: AgentDynamicsDecision | undefined): string {
  if (PROCESSING_STATUSES.has(status ?? 'received')) return '处理中';
  if (decision === 'replied' || status === 'persisted') return '自动回复';
  if (decision === 'handoff' || status === 'handoff') return '待人工';
  if (decision === 'failed' || status === 'failed') return '执行失败';
  return '已跳过';
}

function senderOutcomeVM(run: BackendRun): { label: string; tone: AgentDynamicsTone } {
  if (run.status === 'persisted' || run.senderOutcome === 'known_success') return { label: '已发送 / 已落库', tone: 'success' };
  if (run.senderOutcome === 'simulated') return { label: '模拟 / 已落库', tone: 'success' };
  if (run.senderOutcome === 'known_failure') return { label: '发送失败 / 已落库', tone: 'danger' };
  if (run.status && PROCESSING_STATUSES.has(run.status)) return { label: '未发送 / 未落库', tone: 'gray' };
  return { label: '未发送 / 已落库', tone: 'gray' };
}

export function mapBackendRunToViewModel(run: BackendRun, context?: BackendRunDetail): AgentDynamicsRunRowVM {
  const status = run.status ?? 'received';
  const decision = run.decision ?? (PROCESSING_STATUSES.has(status) ? 'replied' : 'skipped');
  const stage = stageKey(run.stage, status);
  const buyerName = run.buyerDisplayName ?? context?.conversation?.buyerDisplayName ?? '未知买家';
  const productName = run.productTitle ?? context?.product?.title ?? '未关联商品';
  return {
    runId: run.id,
    createdAt: run.createdAt,
    timeLabel: formatTime(run.createdAt),
    buyer: { name: buyerName, avatar: context?.conversation?.buyerAvatarUrl ?? buyerName.slice(0, 1), conversationId: run.conversationId },
    inboundPreview: run.inboundMessagePreview ?? context?.inboundMessage?.bodyText ?? '暂无买家消息预览',
    product: { name: productName, productId: run.productId ?? context?.product?.id },
    intent: run.intent ?? '未识别',
    stage: { key: stage, label: stageLabel(stage), tone: stageTone(stage) },
    decision: { key: PROCESSING_STATUSES.has(status) ? 'processing' : decision, label: statusLabel(status, decision), tone: PROCESSING_STATUSES.has(status) ? 'info' : toneForDecision(decision) },
    senderOutcome: senderOutcomeVM(run),
    durationMs: Number.isFinite(run.durationMs) ? Math.max(0, Number(run.durationMs)) : Math.max(0, Date.parse(run.updatedAt ?? run.createdAt) - Date.parse(run.createdAt)),
    failureCode: run.failureCode,
    persisted: status === 'persisted' || run.senderOutcome === 'known_success' || run.senderOutcome === 'simulated',
    accountId: run.accountId,
  };
}

function mapHealthTone(status: string): AgentDynamicsTone {
  const normalized = status.toLowerCase();
  if (['online', 'healthy', 'ok', 'ready', 'normal', 'connected'].includes(normalized)) return 'success';
  if (['degraded', 'warning', 'unknown'].includes(normalized)) return 'warn';
  if (['offline', 'error', 'failed', 'down'].includes(normalized)) return 'danger';
  return 'info';
}

function mapBackendSummary(summary: BackendSummary): AgentDynamicsSummaryVM {
  const stageRows = new Map(summary.byStage.map((row) => [row.stage, row]));
  const stages: Array<{ key: AgentDynamicsStage; backend: string; label: string }> = [
    { key: 'gateway', backend: 'gateway_received', label: '网关接收' },
    { key: 'intent', backend: 'intent_recognition', label: '意图识别' },
    { key: 'context', backend: 'context_read', label: '上下文读取' },
    { key: 'generation', backend: 'reply_generation', label: '回复生成' },
    { key: 'persistence', backend: 'persisted', label: '提交并落库' },
  ];
  const health = summary.health.map((item) => ({ key: item.component, name: item.component, meta: item.details?.description ? String(item.details.description) : `最近检查 ${formatTime(item.observedAt)}`, value: item.status, tone: mapHealthTone(item.status) }));
  const healthy = health.length === 0 || health.every((item) => item.tone === 'success');
  const total = Math.max(1, summary.inboundCount);
  const statusDistribution = [
    { key: 'replied', label: '自动回复完成', percent: (summary.persistedCount / total) * 100, tone: 'success' as const },
    { key: 'handoff', label: '转人工', percent: (summary.handoffCount / total) * 100, tone: 'warn' as const },
    { key: 'failed', label: '执行失败', percent: (summary.failedCount / total) * 100, tone: 'danger' as const },
    { key: 'processing', label: '处理中', percent: (summary.processingCount / total) * 100, tone: 'info' as const },
  ];
  return {
    gateway: { status: healthy ? 'online' : 'offline', heartbeatLabel: health[0]?.meta ?? `最近刷新 ${formatTime(summary.asOf)}`, queueLabel: `${summary.processingCount.toLocaleString('zh-CN')} 条处理中` },
    kpis: [
      { key: 'gateway', label: '网关连接', value: healthy ? '在线' : '异常', foot: healthy ? '● 稳定 · 最近刷新' : '● 异常 · 请检查链路', tone: healthy ? 'success' : 'danger' },
      { key: 'inbound', label: '今日入站消息', value: summary.inboundCount.toLocaleString('zh-CN'), foot: `↑ ${summary.throughputPerSecond.toFixed(1)}/s · 当前窗口`, tone: 'success' },
      { key: 'processing', label: '当前处理中', value: summary.processingCount.toLocaleString('zh-CN'), foot: `p95 ${(summary.p95DurationMs / 1000).toFixed(1)}s · 当前窗口`, tone: summary.processingCount > 0 ? 'info' : 'success' },
      { key: 'persisted', label: '今日已落库', value: summary.persistedCount.toLocaleString('zh-CN'), foot: `${(summary.completionRate * 100).toFixed(1)}% · 当前窗口完成闭环`, tone: 'success' },
    ],
    pipeline: stages.map((stage, index) => { const row = stageRows.get(stage.backend); return { key: stage.key, index: String(index + 1).padStart(2, '0'), label: stage.label, count: row?.count ?? (stage.key === 'persistence' ? summary.persistedCount : 0), meta: row?.averageDurationMs ? `平均 ${(row.averageDurationMs / 1000).toFixed(1)}s` : '暂无数据', status: 'online' as const }; }),
    events: [],
    health,
    healthSummary: [
      { label: '当前吞吐', value: `${summary.throughputPerSecond.toFixed(1)}/s`, note: '当前查询窗口' },
      { label: '端到端 p95', value: `${(summary.p95DurationMs / 1000).toFixed(1)}s`, note: '从接收至落库' },
    ],
    statusDistribution: statusDistribution.filter((item) => item.percent > 0 || summary.inboundCount === 0),
    exceptions: summary.exceptions.map((item) => ({ key: item.code, title: item.code, meta: `${item.count} 条 · ${item.status}`, count: item.count, tone: item.status === 'failed' ? 'danger' : item.status === 'handoff' ? 'warn' : 'info' })),
    asOf: summary.asOf,
    refreshIntervalMs: 5000,
  };
}

function mapBackendDetail(detail: BackendRunDetail): AgentDynamicsRunDetailVM {
  const row = mapBackendRunToViewModel(detail.run, detail);
  const timeline = (detail.events ?? []).map((event) => ({ id: event.id, title: event.eventType, meta: `${formatTime(event.occurredAt)} · ${event.stage}`, tone: event.status === 'failed' ? 'danger' : event.status === 'handoff' ? 'warn' : 'success' as AgentDynamicsTone }));
  const reply = detail.outboundMessages?.[detail.outboundMessages.length - 1]?.bodyText;
  return { ...row, message: detail.inboundMessage?.bodyText ?? row.inboundPreview, reply, outcomeLabel: row.senderOutcome.label, timeline, chatPath: row.buyer.conversationId ? `/messages?conversationId=${encodeURIComponent(row.buyer.conversationId)}` : '/messages' };
}

function unwrap<T>(payload: T | ApiEnvelope<T>): T {
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
    const envelope = payload as ApiEnvelope<T>;
    if (!envelope.success || envelope.data === null) throw new Error(envelope.message ?? envelope.error?.code ?? 'AGENT_DYNAMICS_REQUEST_FAILED');
    return envelope.data;
  }
  return payload as T;
}

export interface AgentDynamicsApi {
  getSummary(input: { accountId?: string; range: AgentDynamicsRange }): Promise<AgentDynamicsSummaryVM>;
  listRuns(filters: AgentDynamicsFilters): Promise<AgentDynamicsRunsPageVM>;
  getRunDetail(runId: string, accountId?: string): Promise<AgentDynamicsRunDetailVM>;
}

function query(input: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export function createAgentDynamicsApi(transport: AgentDynamicsApiTransport): AgentDynamicsApi {
  return {
    async getSummary(input) {
      const range = rangeParams(input.range);
      const payload = unwrap(await transport.get<BackendSummary | ApiEnvelope<BackendSummary>>(`/api/v1/auto-reply/activity/summary${query({ accountId: input.accountId, ...range })}`));
      return mapBackendSummary(payload);
    },
    async listRuns(filters) {
      const range = rangeParams(filters.range);
      const decision = filters.status === 'all' || filters.status === 'processing' ? undefined : filters.status;
      const processing = filters.status === 'processing' ? 'true' : undefined;
      const stage = filters.stage === 'all' ? undefined : ({ gateway: 'gateway_received', intent: 'intent_recognition', context: 'context_read', generation: 'reply_generation', persistence: 'persisted' } as const)[filters.stage];
      const payload = unwrap(await transport.get<{ items: BackendRun[]; total: number; page: number; pageSize: number; totalPages: number } | ApiEnvelope<{ items: BackendRun[]; total: number; page: number; pageSize: number; totalPages: number }>>(`/api/v1/auto-reply/runs${query({ accountId: filters.accountId, ...range, decision, processing, stage, keyword: filters.keyword || undefined, page: filters.page, pageSize: filters.pageSize })}`));
      const mapped = payload.items.map((item) => mapBackendRunToViewModel(item));
      return { ...payload, items: mapped };
    },
    async getRunDetail(runId, accountId) {
      const payload = unwrap(await transport.get<BackendRunDetail | ApiEnvelope<BackendRunDetail>>(`/api/v1/auto-reply/runs/${encodeURIComponent(runId)}${query({ accountId })}`));
      return mapBackendDetail(payload);
    },
  };
}

function isoAt(secondsAgo: number): string {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
}

const mockRows: AgentDynamicsRunRowVM[] = [
  { runId: 'run_success', createdAt: isoAt(3), timeLabel: '14:32:06', buyer: { name: '一只橘喵喵亮晶晶', avatar: '橘', conversationId: 'conversation_success' }, inboundPreview: '请问这个数字资料包具体包含什么？', product: { name: '数字资料包', productId: 'product_001' }, intent: '商品咨询', stage: { key: 'persistence', label: '已完成', tone: 'info' }, decision: { key: 'replied', label: '自动回复', tone: 'success' }, senderOutcome: { label: '模拟 / 已落库', tone: 'success' }, durationMs: 3200, persisted: true },
  { runId: 'run_handoff', createdAt: isoAt(5), timeLabel: '14:32:07', buyer: { name: '买家A', avatar: 'A', conversationId: 'conversation_handoff' }, inboundPreview: '这个订单什么时候发货？', product: { name: '手工教程', productId: 'product_002' }, intent: '发货咨询', stage: { key: 'context', label: '上下文不足', tone: 'warn' }, decision: { key: 'handoff', label: '待人工', tone: 'warn' }, senderOutcome: { label: '未发送 / 已落库', tone: 'gray' }, durationMs: 1800, persisted: true },
  { runId: 'run_failed', createdAt: isoAt(8), timeLabel: '14:31:56', buyer: { name: '买家B', avatar: 'B', conversationId: 'conversation_failed' }, inboundPreview: '请问购买后怎么使用？', product: { name: '资料包', productId: 'product_003' }, intent: '商品咨询', stage: { key: 'generation', label: '回复生成', tone: 'danger' }, decision: { key: 'failed', label: '执行失败', tone: 'danger' }, senderOutcome: { label: '未发送 / 已落库', tone: 'gray' }, durationMs: 8600, failureCode: 'RESPONSES_API_TIMEOUT', persisted: true },
  { runId: 'run_processing', createdAt: isoAt(10), timeLabel: '14:31:58', buyer: { name: '买家C', avatar: 'C', conversationId: 'conversation_processing' }, inboundPreview: '你好，还有其他类似商品吗？', product: { name: '课程链接', productId: 'product_004' }, intent: '跨商品咨询', stage: { key: 'context', label: '上下文读取', tone: 'info' }, decision: { key: 'processing', label: '处理中', tone: 'info' }, senderOutcome: { label: '未发送 / 未落库', tone: 'gray' }, durationMs: 2100, persisted: false },
];

const mockSummary: AgentDynamicsSummaryVM = {
  gateway: { status: 'online', heartbeatLabel: '最近心跳 2 秒前', queueLabel: '消息队列 6 条处理中' },
  kpis: [
    { key: 'gateway', label: '网关连接', value: '在线', foot: '● 稳定 · 最近心跳 2 秒前', tone: 'success' },
    { key: 'inbound', label: '今日入站消息', value: '12,842', foot: '↑ 18.6% · 较昨日', tone: 'success' },
    { key: 'processing', label: '当前处理中', value: '6', foot: '平均 2.4s · 队列未堆积', tone: 'info' },
    { key: 'persisted', label: '今日已落库', value: '10,943', foot: '85.2% · 入站消息完成闭环', tone: 'success' },
  ],
  pipeline: [
    { key: 'gateway', index: '01', label: '网关接收', count: 12842, meta: '最近 2 秒前', status: 'online' },
    { key: 'intent', index: '02', label: '意图识别', count: 12798, meta: '平均 0.4s', status: 'online' },
    { key: 'context', index: '03', label: '上下文读取', count: 12552, meta: '平均 0.7s', status: 'online' },
    { key: 'generation', index: '04', label: '回复生成', count: 10964, meta: '平均 2.1s', status: 'online' },
    { key: 'persistence', index: '05', label: '提交并落库', count: 10943, meta: '平均 0.2s', status: 'online' },
  ],
  events: [
    { id: 'event_success', runId: 'run_success', time: '14:32:09', title: '一只橘喵喵亮晶晶 的消息已完成自动回复', meta: '商品咨询 · 模拟提交 · 已落库', label: '完成', tone: 'success' },
    { id: 'event_handoff', runId: 'run_handoff', time: '14:32:07', title: '买家A 需要确认发货时间', meta: '工具结果不足 · 已转人工', label: '转人工', tone: 'warn' },
    { id: 'event_failed', runId: 'run_failed', time: '14:32:04', title: '买家B 的回复生成失败', meta: 'Responses API 超时 · 未提交发送', label: '失败', tone: 'danger' },
    { id: 'event_processing', runId: 'run_processing', time: '14:31:58', title: '买家C 正在处理跨商品咨询', meta: '上下文读取中 · 已读取 2 个会话', label: '处理中', tone: 'info' },
  ],
  health: [
    { key: 'gateway', name: '闲鱼网关监听', meta: '最近心跳 2 秒前', value: '在线', tone: 'success' },
    { key: 'queue', name: '消息队列', meta: '积压 0 · 处理 6', value: '正常', tone: 'success' },
    { key: 'model', name: '模型服务', meta: 'Responses API · p95 3.8s', value: '正常', tone: 'success' },
    { key: 'sender', name: '发送适配器', meta: '当前模式 simulate', value: '就绪', tone: 'success' },
    { key: 'storage', name: '运行落库', meta: '最近写入 2 秒前', value: '正常', tone: 'success' },
  ],
  healthSummary: [{ label: '当前吞吐', value: '8.4/s', note: '过去 5 分钟' }, { label: '端到端 p95', value: '4.6s', note: '从接收至落库' }],
  statusDistribution: [
    { key: 'replied', label: '自动回复完成', percent: 85.2, tone: 'success' },
    { key: 'handoff', label: '转人工', percent: 8.7, tone: 'warn' },
    { key: 'failed', label: '执行失败', percent: 0.6, tone: 'danger' },
    { key: 'unknown', label: '发送状态未知', percent: 0.1, tone: 'info' },
  ],
  exceptions: [
    { key: 'timeout', title: '模型请求超时', meta: '12 条 · 可自动重试', count: 12, tone: 'danger' },
    { key: 'insufficient_facts', title: '工具事实不足', meta: '8 条 · 建议转人工', count: 8, tone: 'warn' },
    { key: 'send_unknown', title: '发送状态未知', meta: '2 条 · 需确认闲鱼侧状态', count: 2, tone: 'info' },
  ],
  asOf: new Date().toISOString(),
  refreshIntervalMs: 5000,
};

function cloneSummary(): AgentDynamicsSummaryVM {
  return JSON.parse(JSON.stringify({ ...mockSummary, asOf: new Date().toISOString() })) as AgentDynamicsSummaryVM;
}

function detailFor(row: AgentDynamicsRunRowVM): AgentDynamicsRunDetailVM {
  const defaultTimeline: AgentDynamicsTimelineItemVM[] = [
    { id: `${row.runId}:received`, title: '已接收买家消息', meta: `${row.timeLabel} · 闲鱼网关 push`, tone: 'success' as const },
    { id: `${row.runId}:intent`, title: '意图识别完成', meta: `${row.intent} · 置信度 0.92 · 0.4s`, tone: 'success' as const },
    { id: `${row.runId}:context`, title: '已读取商品与会话上下文', meta: '商品信息 + 同买家历史会话 · 0.7s', tone: 'success' as const },
    { id: `${row.runId}:generated`, title: 'Agent 已生成回复', meta: 'Responses API · 2.1s', tone: row.decision.key === 'failed' ? 'danger' as const : 'success' as const },
    { id: `${row.runId}:persisted`, title: row.persisted ? '已模拟提交发送并落库' : '运行处理中', meta: row.persisted ? 'senderOutcome: simulated · run 持久化成功' : '尚未生成最终回复', tone: row.persisted ? 'success' as const : 'info' as const },
  ];
  if (row.decision.key === 'failed') defaultTimeline[3] = { id: `${row.runId}:generated`, title: '回复生成失败', meta: 'Responses API 超时 · 8.6s · 未提交发送', tone: 'danger' };
  if (row.decision.key === 'handoff') defaultTimeline[3] = { id: `${row.runId}:generated`, title: '工具事实不足，已转人工', meta: '发货时间无法确认 · 未提交发送', tone: 'warn' };
  return {
    ...row,
    message: row.inboundPreview,
    reply: row.decision.key === 'failed' ? '本次未生成可发送回复，运行已记录并进入异常列表。' : row.decision.key === 'handoff' ? '当前无法确认发货时间，已转人工处理。' : row.decision.key === 'processing' ? 'Agent 正在读取店铺商品信息，尚未生成最终回复。' : '这个数字资料包包含完整资料说明，购买后请按商品页面指引获取并使用。',
    outcomeLabel: row.senderOutcome.label,
    timeline: defaultTimeline,
    chatPath: row.buyer.conversationId ? `/messages?conversationId=${encodeURIComponent(row.buyer.conversationId)}` : '/messages',
  };
}

export function createMockAgentDynamicsApi(): AgentDynamicsApi {
  return {
    async getSummary() { return cloneSummary(); },
    async listRuns(filters) {
      const keyword = filters.keyword.trim().toLowerCase();
      const items = mockRows.filter((row) => {
        const keywordMatch = !keyword || [row.buyer.name, row.product.name, row.inboundPreview, row.intent].some((value) => value.toLowerCase().includes(keyword));
        const statusMatch = filters.status === 'all' || row.decision.key === filters.status;
        const stageMatch = filters.stage === 'all' || row.stage.key === filters.stage;
        return keywordMatch && statusMatch && stageMatch;
      });
      const pageSize = filters.pageSize || 20;
      const page = Math.max(1, filters.page || 1);
      const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
      const hasFilters = Boolean(keyword || filters.status !== 'all' || filters.stage !== 'all');
      return { items: items.slice((page - 1) * pageSize, page * pageSize), total: hasFilters ? items.length : 12842, page, pageSize, totalPages };
    },
    async getRunDetail(runId) {
      const row = mockRows.find((item) => item.runId === runId);
      if (!row) throw new ApiError('运行记录不存在', 404);
      return detailFor(row);
    },
  };
}

export const defaultAgentDynamicsApi = createMockAgentDynamicsApi();

export type AgentDynamicsRunStatusFilter = AgentDynamicsFilters['status'];
export type AgentDynamicsStageFilter = AgentDynamicsFilters['stage'];
export type AgentDynamicsRunDecisionKey = AgentDynamicsDecision;
export type AgentDynamicsRunStageKey = AgentDynamicsStage;
