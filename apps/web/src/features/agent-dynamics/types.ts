export type AgentDynamicsTone = 'success' | 'warn' | 'danger' | 'info' | 'gray';

export type AgentDynamicsRunStatus =
  | 'received'
  | 'classified'
  | 'context_loaded'
  | 'generated'
  | 'simulated'
  | 'persisted'
  | 'handoff'
  | 'skipped'
  | 'failed';

export type AgentDynamicsDecision = 'replied' | 'handoff' | 'skipped' | 'failed';
export type AgentDynamicsStage = 'gateway' | 'intent' | 'context' | 'generation' | 'persistence';
export type AgentDynamicsRange = '24h' | '7d';

export interface AgentDynamicsKpiVM {
  key: 'gateway' | 'inbound' | 'processing' | 'persisted';
  label: string;
  value: string;
  foot: string;
  tone: AgentDynamicsTone;
  accent?: string;
}

export interface AgentDynamicsPipelineStageVM {
  key: AgentDynamicsStage;
  index: string;
  label: string;
  count: number;
  meta: string;
  status: 'online' | 'warning' | 'error';
}

export interface AgentDynamicsEventVM {
  id: string;
  runId?: string;
  time: string;
  title: string;
  meta: string;
  label: string;
  tone: AgentDynamicsTone;
}

export interface AgentDynamicsHealthVM {
  key: string;
  name: string;
  meta: string;
  value: string;
  tone: AgentDynamicsTone;
}

export interface AgentDynamicsHealthStatVM {
  label: string;
  value: string;
  note: string;
}

export interface AgentDynamicsStatusDistributionVM {
  key: string;
  label: string;
  percent: number;
  tone: AgentDynamicsTone;
}

export interface AgentDynamicsExceptionVM {
  key: string;
  title: string;
  meta: string;
  count: number;
  tone: AgentDynamicsTone;
}

export interface AgentDynamicsSummaryVM {
  gateway: {
    status: 'online' | 'offline';
    heartbeatLabel: string;
    queueLabel: string;
  };
  kpis: AgentDynamicsKpiVM[];
  pipeline: AgentDynamicsPipelineStageVM[];
  events: AgentDynamicsEventVM[];
  health: AgentDynamicsHealthVM[];
  healthSummary: AgentDynamicsHealthStatVM[];
  statusDistribution: AgentDynamicsStatusDistributionVM[];
  exceptions: AgentDynamicsExceptionVM[];
  asOf: string;
  refreshIntervalMs: number;
}

export interface AgentDynamicsBuyerVM {
  name: string;
  avatar?: string;
  conversationId?: string;
}

export interface AgentDynamicsProductVM {
  name: string;
  productId?: string;
}

export interface AgentDynamicsRunRowVM {
  runId: string;
  createdAt: string;
  timeLabel: string;
  buyer: AgentDynamicsBuyerVM;
  inboundPreview: string;
  product: AgentDynamicsProductVM;
  intent: string;
  stage: { key: AgentDynamicsStage; label: string; tone: AgentDynamicsTone };
  decision: { key: AgentDynamicsDecision | 'processing'; label: string; tone: AgentDynamicsTone };
  senderOutcome: { label: string; tone: AgentDynamicsTone };
  durationMs: number;
  failureCode?: string;
  persisted: boolean;
  accountId?: string;
}

export interface AgentDynamicsRunsPageVM {
  items: AgentDynamicsRunRowVM[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AgentDynamicsTimelineItemVM {
  id: string;
  title: string;
  meta: string;
  tone: AgentDynamicsTone;
  sequence?: number;
  stage?: string;
  status?: string;
  eventType?: string;
  traceId?: string;
  details?: {
    input?: Array<{ label: string; value: string }>;
    output?: Array<{ label: string; value: string }>;
    error?: Array<{ label: string; value: string }>;
  };
}

export interface AgentDynamicsRunDetailVM extends AgentDynamicsRunRowVM {
  message: string;
  reply?: string;
  outcomeLabel: string;
  timeline: AgentDynamicsTimelineItemVM[];
  chatPath?: string;
}

export interface AgentDynamicsFilters {
  accountId?: string;
  range: AgentDynamicsRange;
  status: 'all' | AgentDynamicsDecision | 'processing';
  stage: 'all' | AgentDynamicsStage;
  keyword: string;
  page: number;
  pageSize: number;
}

export type AgentDynamicsLoadPhase = 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'forbidden' | 'timeout';

export interface AgentDynamicsLoadError {
  code: 'FORBIDDEN' | 'NOT_FOUND' | 'NETWORK_ERROR' | 'TIMEOUT' | 'UNKNOWN';
  message: string;
  retryable: boolean;
}

export interface AgentDynamicsSummaryState {
  phase: AgentDynamicsLoadPhase;
  data: AgentDynamicsSummaryVM | null;
  error: AgentDynamicsLoadError | null;
  refreshing: boolean;
  lastLoadedAt?: string;
}

export interface AgentDynamicsRunsState {
  phase: AgentDynamicsLoadPhase;
  data: AgentDynamicsRunsPageVM | null;
  error: AgentDynamicsLoadError | null;
  refreshing: boolean;
}

export interface AgentDynamicsDetailState {
  phase: 'idle' | 'loading' | 'success' | 'error' | 'forbidden';
  runId?: string;
  data: AgentDynamicsRunDetailVM | null;
  error: AgentDynamicsLoadError | null;
}

export function toneForDecision(decision: AgentDynamicsDecision | 'processing'): AgentDynamicsTone {
  if (decision === 'replied') return 'success';
  if (decision === 'handoff') return 'warn';
  if (decision === 'failed') return 'danger';
  if (decision === 'processing') return 'info';
  return 'gray';
}

export function stageLabel(stage: AgentDynamicsStage): string {
  return ({ gateway: '网关接收', intent: '意图识别', context: '上下文读取', generation: '回复生成', persistence: '提交并落库' })[stage];
}

export function runStageFromStatus(status: AgentDynamicsRunStatus): AgentDynamicsStage {
  if (status === 'received') return 'gateway';
  if (status === 'classified') return 'intent';
  if (status === 'context_loaded') return 'context';
  if (status === 'generated' || status === 'failed' || status === 'handoff' || status === 'skipped') return 'generation';
  return 'persistence';
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '—';
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
