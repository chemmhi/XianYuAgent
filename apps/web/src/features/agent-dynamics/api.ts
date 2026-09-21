import { ApiError } from '../../api/http';
import {
  formatDuration,
  formatTime,
  runStageFromStatus,
  stageLabel,
  toneForDecision,
} from './types';
import type {
  AgentDynamicsDecision,
  AgentDynamicsEventVM,
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

type RawAutoReplyRunStatus = 'received' | 'classified' | 'context_loaded' | 'generated' | 'simulated' | 'persisted' | 'handoff' | 'skipped' | 'failed';
type RawAutoReplyRunStage = 'gateway_received' | 'intent_recognition' | 'context_read' | 'reply_generation' | 'sending' | 'persisted' | 'handoff' | 'skipped' | 'failed';

interface RawAutoReplyRunListItem {
  id: string;
  accountId: string;
  conversationId: string;
  inboundMessageId: string;
  intent: string;
  decision: AgentDynamicsDecision;
  status: RawAutoReplyRunStatus;
  productId?: string;
  senderOutcome?: 'simulated' | 'known_success' | 'known_failure' | 'unknown';
  outboundMessageId?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
  stage: RawAutoReplyRunStage;
  durationMs: number;
  buyerDisplayName?: string;
  productTitle?: string;
  inboundMessagePreview?: string;
}

interface RawAutoReplyRunEvent {
  id: string;
  runId: string;
  sequence?: number;
  eventType: string;
  stage: RawAutoReplyRunStage;
  status: RawAutoReplyRunStatus;
  occurredAt: string;
  durationMs?: number;
  traceId?: string;
  payload?: Record<string, unknown>;
}

interface RawAutoReplyRunListResult {
  items: RawAutoReplyRunListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface RawAutoReplyRunDetail {
  run: RawAutoReplyRunListItem;
  events: RawAutoReplyRunEvent[];
  conversation?: { id: string; buyerDisplayName?: string };
  inboundMessage?: { bodyText?: string };
  outboundMessages: Array<{ bodyText?: string }>;
  product?: { id: string; title?: string };
}

interface RawActivitySummary {
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
  byStatus: Array<{ status: RawAutoReplyRunStatus; count: number }>;
  byStage: Array<{ stage: RawAutoReplyRunStage; count: number; averageDurationMs: number }>;
  exceptions: Array<{ code: string; count: number; status: RawAutoReplyRunStatus }>;
  health: Array<{ component: string; status: string; observedAt: string; details?: Record<string, unknown> }>;
  events?: RawAutoReplyRunEvent[];
}

const PROCESSING_STATUSES: RawAutoReplyRunStatus[] = ['received', 'classified', 'context_loaded', 'generated', 'simulated'];
const TERMINAL_STATUSES = new Set<RawAutoReplyRunStatus>(['persisted', 'handoff', 'skipped', 'failed']);

const RAW_STAGE_GROUPS: Record<'all' | AgentDynamicsStage, RawAutoReplyRunStage[]> = {
  all: [],
  gateway: ['gateway_received'],
  intent: ['intent_recognition'],
  context: ['context_read'],
  generation: ['reply_generation', 'handoff', 'failed'],
  persistence: ['sending', 'persisted', 'skipped'],
};

const RAW_STATUS_GROUPS: Record<AgentDynamicsFilters['status'], RawAutoReplyRunStatus[]> = {
  all: [],
  replied: ['persisted'],
  handoff: ['handoff'],
  failed: ['failed'],
  processing: PROCESSING_STATUSES,
  skipped: ['skipped'],
};

const RAW_STAGE_TO_VM: Record<RawAutoReplyRunStage, AgentDynamicsStage> = {
  gateway_received: 'gateway',
  intent_recognition: 'intent',
  context_read: 'context',
  reply_generation: 'generation',
  sending: 'persistence',
  persisted: 'persistence',
  handoff: 'generation',
  failed: 'generation',
  skipped: 'persistence',
};

const SUMMARY_STAGE_GROUPS: Array<{ key: AgentDynamicsStage; stages: RawAutoReplyRunStage[] }> = [
  { key: 'gateway', stages: ['gateway_received'] },
  { key: 'intent', stages: ['intent_recognition'] },
  { key: 'context', stages: ['context_read'] },
  { key: 'generation', stages: ['reply_generation', 'handoff', 'failed'] },
  { key: 'persistence', stages: ['sending', 'persisted', 'skipped'] },
];

function rangeWindow(range: AgentDynamicsRange, now = Date.now()): { from: string; to: string } {
  const durationMs = range === '7d' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return { from: new Date(now - durationMs).toISOString(), to: new Date(now).toISOString() };
}

function rawStageToVm(stage: RawAutoReplyRunStage, status: RawAutoReplyRunStatus): AgentDynamicsStage {
  return RAW_STAGE_TO_VM[stage] ?? runStageFromStatus(status);
}

function stageTone(status: RawAutoReplyRunStatus): AgentDynamicsRunRowVM['stage']['tone'] {
  if (status === 'failed') return 'danger';
  if (status === 'handoff') return 'warn';
  if (PROCESSING_STATUSES.includes(status)) return 'info';
  if (status === 'skipped') return 'gray';
  return 'success';
}

function decisionLabel(decision: AgentDynamicsDecision | 'processing'): string {
  return decision === 'replied' ? '自动回复' : decision === 'handoff' ? '待人工' : decision === 'failed' ? '执行失败' : decision === 'skipped' ? '已跳过' : '处理中';
}

function senderOutcomeVm(raw: RawAutoReplyRunListItem): AgentDynamicsRunRowVM['senderOutcome'] {
  if (raw.senderOutcome === 'simulated') return { label: '模拟 / 已落库', tone: 'success' };
  if (raw.senderOutcome === 'known_success') return { label: '已发送 / 已落库', tone: 'success' };
  if (raw.senderOutcome === 'known_failure') return { label: '发送失败 / 已落库', tone: 'danger' };
  if (raw.senderOutcome === 'unknown') return { label: '发送状态未知 / 已落库', tone: 'warn' };
  return { label: TERMINAL_STATUSES.has(raw.status) ? '未发送 / 已落库' : '未发送 / 未落库', tone: 'gray' };
}

function mapRun(raw: RawAutoReplyRunListItem): AgentDynamicsRunRowVM {
  const processing = PROCESSING_STATUSES.includes(raw.status);
  const stage = rawStageToVm(raw.stage, raw.status);
  const decision = processing ? 'processing' : raw.decision;
  const buyerName = raw.buyerDisplayName?.trim() || '未知买家';
  const productName = raw.productTitle?.trim() || '未关联商品';
  return {
    runId: raw.id,
    createdAt: raw.createdAt,
    timeLabel: formatTime(raw.createdAt),
    buyer: { name: buyerName, avatar: buyerName.slice(0, 1), conversationId: raw.conversationId },
    inboundPreview: raw.inboundMessagePreview?.trim() || '买家消息已脱敏',
    product: { name: productName, productId: raw.productId },
    intent: raw.intent || '未识别',
    stage: { key: stage, label: stageLabel(stage), tone: stageTone(raw.status) },
    decision: { key: decision, label: decisionLabel(decision), tone: toneForDecision(decision) },
    senderOutcome: senderOutcomeVm(raw),
    durationMs: Number.isFinite(raw.durationMs) ? Math.max(0, raw.durationMs) : 0,
    failureCode: raw.failureCode,
    persisted: TERMINAL_STATUSES.has(raw.status),
    accountId: raw.accountId,
  };
}

function eventTitle(event: RawAutoReplyRunEvent, run: AgentDynamicsRunRowVM): string {
  if (event.status === 'failed') return `${run.buyer.name} 的回复生成失败`;
  if (event.status === 'handoff') return `${run.buyer.name} 已转人工处理`;
  if (event.status === 'skipped') return `${run.buyer.name} 已跳过自动回复`;
  if (event.status === 'persisted') return `${run.buyer.name} 的消息已完成自动回复`;
  if (event.stage === 'gateway_received') return `${run.buyer.name} 的消息已接收`;
  if (event.stage === 'intent_recognition') return `${run.buyer.name} 已完成意图识别`;
  if (event.stage === 'context_read') return `${run.buyer.name} 已完成上下文读取`;
  if (event.stage === 'reply_generation') return `${run.buyer.name} 已完成回复生成`;
  if (event.stage === 'sending') return `${run.buyer.name} 已完成发送提交`;
  return `${run.buyer.name} 已完成${run.intent}处理`;
}

function eventTone(status: RawAutoReplyRunStatus): AgentDynamicsRunRowVM['stage']['tone'] {
  if (status === 'failed') return 'danger';
  if (status === 'handoff') return 'warn';
  if (PROCESSING_STATUSES.includes(status)) return 'info';
  return 'success';
}

function mapEvents(events: RawAutoReplyRunEvent[], runs: Map<string, AgentDynamicsRunRowVM>): AgentDynamicsEventVM[] {
  return events.map((event) => {
    const run = runs.get(event.runId);
    const tone = eventTone(event.status);
    const detail = event.durationMs === undefined ? event.eventType : `${event.eventType} · ${formatDuration(event.durationMs)}`;
    return { id: event.id, runId: event.runId, time: formatTime(event.occurredAt), title: run ? eventTitle(event, run) : event.eventType, meta: detail, label: event.status === 'persisted' ? '完成' : event.status === 'handoff' ? '转人工' : event.status === 'failed' ? '失败' : PROCESSING_STATUSES.includes(event.status) ? '处理中' : '已记录', tone };
  });
}

function mapRunToSummaryEvent(row: AgentDynamicsRunRowVM): AgentDynamicsEventVM {
  const tone = row.decision.tone;
  return { id: `${row.runId}:summary`, runId: row.runId, time: row.timeLabel, title: row.decision.key === 'failed' ? `${row.buyer.name} 的回复生成失败` : row.decision.key === 'handoff' ? `${row.buyer.name} 已转人工处理` : row.decision.key === 'processing' ? `${row.buyer.name} 正在处理${row.intent}` : `${row.buyer.name} 的消息已完成自动回复`, meta: `${row.intent} · ${row.senderOutcome.label}`, label: row.decision.key === 'failed' ? '失败' : row.decision.key === 'handoff' ? '转人工' : row.decision.key === 'processing' ? '处理中' : '完成', tone };
}

function healthTone(status: string): AgentDynamicsSummaryVM['health'][number]['tone'] {
  const normalized = status.toLowerCase();
  if (['online', 'healthy', 'ok', 'ready', 'normal', 'connected'].includes(normalized)) return 'success';
  if (['offline', 'error', 'failed', 'degraded', 'down'].includes(normalized)) return 'danger';
  return 'warn';
}

function healthLabel(status: string): string {
  const normalized = status.toLowerCase();
  if (['online', 'connected'].includes(normalized)) return '在线';
  if (['healthy', 'ok', 'ready', 'normal'].includes(normalized)) return '正常';
  if (['offline', 'down'].includes(normalized)) return '离线';
  if (['error', 'failed', 'degraded'].includes(normalized)) return '异常';
  return '未知';
}

function mapSummaryHealth(raw: RawActivitySummary): AgentDynamicsSummaryVM['health'] {
  if (raw.health.length === 0) return [{ key: 'health-snapshot', name: '健康快照', meta: '服务端未提供健康快照', value: '未知', tone: 'warn' }];
  return raw.health.map((item) => ({ key: item.component, name: item.component, meta: `最近观测 ${formatTime(item.observedAt)}`, value: healthLabel(item.status), tone: healthTone(item.status) }));
}

function mapSummary(raw: RawActivitySummary, events: AgentDynamicsEventVM[] = []): AgentDynamicsSummaryVM {
  const byStage = Array.isArray(raw.byStage) ? raw.byStage : [];
  const byStatus = Array.isArray(raw.byStatus) ? raw.byStatus : [];
  const exceptionsRaw = Array.isArray(raw.exceptions) ? raw.exceptions : [];
  const healthRaw = Array.isArray(raw.health) ? raw.health : [];
  const total = Math.max(0, Number(raw.inboundCount ?? 0));
  const stageRows = SUMMARY_STAGE_GROUPS.map(({ key, stages }, index) => {
    const rows = byStage.filter((item) => stages.includes(item.stage));
    const count = rows.reduce((sum, item) => sum + item.count, 0);
    const avg = rows.length ? Math.round(rows.reduce((sum, item) => sum + item.averageDurationMs, 0) / rows.length) : 0;
    return { key, index: String(index + 1).padStart(2, '0'), label: stageLabel(key), count, meta: avg > 0 ? `平均 ${formatDuration(avg)}` : '暂无阶段数据', status: count > 0 ? 'online' : 'warning' } as const;
  });
  const health = mapSummaryHealth({ ...raw, health: healthRaw });
  const gatewayHealth = health.find((item) => item.key.toLowerCase().includes('gateway') || item.name.includes('网关'));
  const gatewayStatus = gatewayHealth?.tone === 'danger' ? 'offline' : 'online';
  const completionPercent = `${(Math.max(0, Math.min(1, Number(raw.completionRate ?? 0))) * 100).toFixed(1)}%`;
  const statusCounts = new Map<AgentDynamicsDecision | 'processing' | 'unknown', number>();
  for (const item of byStatus) {
    const key: AgentDynamicsDecision | 'processing' | 'unknown' = PROCESSING_STATUSES.includes(item.status) ? 'processing' : item.status === 'persisted' ? 'replied' : item.status === 'handoff' || item.status === 'failed' || item.status === 'skipped' ? item.status : 'unknown';
    statusCounts.set(key, (statusCounts.get(key) ?? 0) + item.count);
  }
  const statusRows: Array<{ key: AgentDynamicsDecision | 'processing'; label: string; tone: AgentDynamicsSummaryVM['statusDistribution'][number]['tone'] }> = [
    { key: 'replied', label: '自动回复完成', tone: 'success' as const },
    { key: 'handoff', label: '转人工', tone: 'warn' as const },
    { key: 'failed', label: '执行失败', tone: 'danger' as const },
    { key: 'processing', label: '处理中', tone: 'info' as const },
  ];
  const statusDistribution = statusRows.map((item) => ({ ...item, percent: total ? ((statusCounts.get(item.key) ?? 0) / total) * 100 : 0 }));
  const exceptions = exceptionsRaw.map((item) => ({ key: item.code, title: item.code, meta: `${item.count} 条 · ${item.status}`, count: item.count, tone: item.status === 'failed' ? 'danger' as const : item.status === 'handoff' ? 'warn' as const : 'info' as const }));
  return {
    gateway: { status: gatewayStatus, heartbeatLabel: gatewayHealth?.meta ?? '暂无心跳快照', queueLabel: Number(raw.processingCount ?? 0) > 0 ? `当前处理中 ${raw.processingCount} 条` : '消息队列空闲' },
    kpis: [
      { key: 'gateway', label: '网关连接', value: gatewayStatus === 'online' ? '在线' : '离线', foot: `${gatewayStatus === 'online' ? '● 稳定' : '● 需关注'} · ${gatewayHealth?.meta ?? '暂无健康快照'}`, tone: gatewayStatus === 'online' ? 'success' : 'danger' },
      { key: 'inbound', label: '当前范围入站消息', value: total.toLocaleString('zh-CN'), foot: `范围 ${formatTime(raw.from)} - ${formatTime(raw.to)}`, tone: 'info' },
      { key: 'processing', label: '当前处理中', value: Number(raw.processingCount ?? 0).toLocaleString('zh-CN'), foot: `端到端 p95 ${formatDuration(Number(raw.p95DurationMs ?? 0))}`, tone: Number(raw.processingCount ?? 0) > 0 ? 'info' : 'success' },
      { key: 'persisted', label: '已完成闭环', value: Number(raw.persistedCount ?? 0).toLocaleString('zh-CN'), foot: `${completionPercent} · 入站消息完成闭环`, tone: 'success' },
    ],
    pipeline: stageRows,
    events,
    health,
    healthSummary: [{ label: '当前吞吐', value: `${Number(raw.throughputPerSecond ?? 0).toFixed(1)}/s`, note: '所选时间范围' }, { label: '端到端 p95', value: formatDuration(Number(raw.p95DurationMs ?? 0)), note: '从接收至落库' }],
    statusDistribution,
    exceptions,
    asOf: raw.asOf,
    refreshIntervalMs: 5000,
  };
}

const EVENT_DETAIL_LABELS: Record<string, string> = {
  kind: '类型',
  messageId: '消息',
  inboundMessageId: '入站消息',
  digest: '摘要',
  inputDigest: '输入摘要',
  contextDigest: '上下文摘要',
  replyDigest: '回复摘要',
  bodyType: '消息类型',
  direction: '方向',
  textLength: '正文长度',
  outputLength: '输出长度',
  supportedMessage: '可处理',
  enabled: '自动回复开关',
  allowlistConfigured: '白名单已配置',
  buyerIdentityMatched: '买家命中',
  identityKeyCount: '身份候选数',
  intent: '意图',
  confidence: '置信度',
  decision: '决策',
  riskFlags: '风险标记',
  conversationId: '会话',
  maxHistory: '历史上限',
  historyCount: '历史条数',
  productId: '商品',
  orderRefs: '订单引用',
  orderRefsCount: '订单数',
  reason: '原因',
  debounceMs: '防抖窗口',
  elapsedMs: '已等待',
  senderOutcome: '发送结果',
  segmentCount: '回复段数',
  mode: '发送模式',
  outboundMessageId: '出站消息',
  persisted: '已落库',
  status: '状态',
  code: '错误码',
};

function formatEventDetailValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.map((item) => formatEventDetailValue(item)).join('、');
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return '[不可展示]'; }
  }
  return String(value);
}

function mapEventDetailFields(value: unknown): Array<{ label: string; value: string }> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const fields = Object.entries(value as Record<string, unknown>)
    .filter(([key, fieldValue]) => Boolean(EVENT_DETAIL_LABELS[key]) && fieldValue !== undefined)
    .map(([key, fieldValue]) => ({ label: EVENT_DETAIL_LABELS[key]!, value: formatEventDetailValue(fieldValue) }));
  return fields.length > 0 ? fields : undefined;
}

function mapEventDetails(event: RawAutoReplyRunEvent): AgentDynamicsTimelineItemVM['details'] {
  const payload = event.payload ?? {};
  const input = mapEventDetailFields(payload.input);
  const output = mapEventDetailFields(payload.output) ?? mapEventDetailFields({ status: event.status, decision: payload.decision, intent: payload.intent });
  const error = mapEventDetailFields(payload.error) ?? (payload.failureCode ? [{ label: '错误码', value: formatEventDetailValue(payload.failureCode) }] : undefined);
  if (!input && !output && !error) return undefined;
  return { input, output, error };
}

function mapDetail(raw: RawAutoReplyRunDetail): AgentDynamicsRunDetailVM {
  const row = mapRun(raw.run);
  const events = [...raw.events].sort((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER));
  const timeline: AgentDynamicsTimelineItemVM[] = events.length > 0 ? events.map((event) => ({ id: event.id, sequence: event.sequence, stage: event.stage, status: event.status, eventType: event.eventType, traceId: event.traceId, title: eventTitle(event, row), meta: `${formatTime(event.occurredAt)} · ${event.eventType}${event.durationMs === undefined ? '' : ` · ${formatDuration(event.durationMs)}`}`, tone: eventTone(event.status), details: mapEventDetails(event) })) : [{ id: `${row.runId}:status`, title: decisionLabel(row.decision.key), meta: `${row.timeLabel} · 当前状态 ${raw.run.status}`, tone: row.decision.tone }];
  return { ...row, message: raw.inboundMessage?.bodyText ?? row.inboundPreview, reply: raw.outboundMessages[0]?.bodyText, outcomeLabel: row.senderOutcome.label, timeline, chatPath: row.buyer.conversationId ? `/messages?conversationId=${encodeURIComponent(row.buyer.conversationId)}` : '/messages' };
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
  async function fetchRawList(input: { accountId?: string; range: AgentDynamicsRange; status: AgentDynamicsFilters['status']; stage: AgentDynamicsFilters['stage']; keyword: string; page: number; pageSize: number }): Promise<AgentDynamicsRunsPageVM> {
    if (!input.accountId) return { items: [], page: Math.max(1, input.page), pageSize: Math.max(1, input.pageSize), total: 0, totalPages: 1 };
    const window = rangeWindow(input.range);
    const statuses = RAW_STATUS_GROUPS[input.status];
    const stages = RAW_STAGE_GROUPS[input.stage];
    const rawStatuses = statuses.length ? statuses : [undefined];
    const rawStages = stages.length ? stages : [undefined];
    const expanded = rawStatuses.length > 1 || rawStages.length > 1;
    const requests = rawStatuses.flatMap((status) => rawStages.map((stage) => transport.get<RawAutoReplyRunListResult | ApiEnvelope<RawAutoReplyRunListResult>>(`/api/v1/auto-reply/runs${query({ accountId: input.accountId, from: window.from, to: window.to, status, stage, keyword: input.keyword.trim() || undefined, page: expanded ? 1 : input.page, pageSize: expanded ? 100 : input.pageSize })}`)));
    const responses = await Promise.all(requests);
    const pages = responses.map((response) => unwrap(response));
    if (!expanded) {
      const page = pages[0];
      return { items: page.items.map(mapRun), page: page.page, pageSize: page.pageSize, total: page.total, totalPages: page.totalPages };
    }
    const seen = new Set<string>();
    const merged = pages.flatMap((page) => page.items).filter((item) => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id));
    const page = Math.max(1, input.page);
    const pageSize = Math.max(1, input.pageSize);
    const items = merged.slice((page - 1) * pageSize, page * pageSize);
    return { items: items.map(mapRun), page, pageSize, total: merged.length, totalPages: Math.max(1, Math.ceil(merged.length / pageSize)) };
  }

  return {
    async getSummary(input) {
      if (!input.accountId) return mapSummary({ from: new Date(0).toISOString(), to: new Date(0).toISOString(), asOf: new Date().toISOString(), inboundCount: 0, processingCount: 0, persistedCount: 0, handoffCount: 0, failedCount: 0, skippedCount: 0, completionRate: 0, throughputPerSecond: 0, p95DurationMs: 0, byStatus: [], byStage: [], exceptions: [], health: [] });
      const window = rangeWindow(input.range);
      const raw = unwrap(await transport.get<RawActivitySummary | ApiEnvelope<RawActivitySummary>>(`/api/v1/auto-reply/activity/summary${query({ accountId: input.accountId, from: window.from, to: window.to })}`));
      let runs: RawAutoReplyRunListResult | undefined;
      if (!raw.events?.length) {
        runs = await transport.get<RawAutoReplyRunListResult | ApiEnvelope<RawAutoReplyRunListResult>>(`/api/v1/auto-reply/runs${query({ accountId: input.accountId, from: window.from, to: window.to, page: 1, pageSize: 20 })}`).then(unwrap).catch(() => undefined);
      }
      const runRows = runs?.items.map(mapRun) ?? [];
      const runMap = new Map(runRows.map((row) => [row.runId, row]));
      const events = raw.events ? mapEvents(raw.events, runMap) : runRows.slice(0, 6).map(mapRunToSummaryEvent);
      return mapSummary(raw, events);
    },
    async listRuns(filters) {
      return fetchRawList(filters);
    },
    async getRunDetail(runId, accountId) {
      if (!accountId) throw new ApiError('ACCOUNT_CONTEXT_REQUIRED', 422);
      const raw = unwrap(await transport.get<RawAutoReplyRunDetail | ApiEnvelope<RawAutoReplyRunDetail>>(`/api/v1/auto-reply/runs/${encodeURIComponent(runId)}${query({ accountId })}`));
      return mapDetail(raw);
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
