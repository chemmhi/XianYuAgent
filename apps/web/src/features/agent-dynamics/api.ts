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
      return unwrap(await transport.get<AgentDynamicsSummaryVM | ApiEnvelope<AgentDynamicsSummaryVM>>(`/api/v1/auto-reply/activity/summary${query(input)}`));
    },
    async listRuns(filters) {
      return unwrap(await transport.get<AgentDynamicsRunsPageVM | ApiEnvelope<AgentDynamicsRunsPageVM>>(`/api/v1/auto-reply/runs${query({ accountId: filters.accountId, range: filters.range, status: filters.status === 'all' ? undefined : filters.status, stage: filters.stage === 'all' ? undefined : filters.stage, keyword: filters.keyword || undefined, page: filters.page, pageSize: filters.pageSize })}`));
    },
    async getRunDetail(runId, accountId) {
      return unwrap(await transport.get<AgentDynamicsRunDetailVM | ApiEnvelope<AgentDynamicsRunDetailVM>>(`/api/v1/auto-reply/runs/${encodeURIComponent(runId)}${query({ accountId })}`));
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
