import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/http';
import { defaultAgentDynamicsApi, type AgentDynamicsApi } from './api';
import type { AgentDynamicsEventVM, AgentDynamicsFilters, AgentDynamicsLoadError, AgentDynamicsRunRowVM, AgentDynamicsRunsState, AgentDynamicsDetailState, AgentDynamicsSummaryState } from './types';

export const defaultAgentDynamicsFilters: AgentDynamicsFilters = { range: '24h', status: 'all', stage: 'all', keyword: '', page: 1, pageSize: 20 };

function eventsFromRuns(items: AgentDynamicsRunRowVM[]): AgentDynamicsEventVM[] {
  return items.slice(0, 5)
    .map((row) => ({
      id: `run:${row.runId}`,
      runId: row.runId,
      time: row.timeLabel,
      title: `${row.buyer.name} 的消息${row.decision.key === 'processing' ? '正在处理' : row.decision.key === 'handoff' ? '已转人工' : row.decision.key === 'failed' ? '处理失败' : '已完成自动回复'}`,
      meta: `${row.intent} · ${row.senderOutcome.label}`,
      label: row.decision.label,
      tone: row.decision.tone,
    }));
}

export function toAgentDynamicsLoadError(error: unknown): AgentDynamicsLoadError {
  if (error instanceof ApiError && error.status === 403) return { code: 'FORBIDDEN', message: '当前管理员没有读取 Agent 动态的权限，请检查账号范围。', retryable: false };
  if (error instanceof ApiError && error.status === 404) return { code: 'NOT_FOUND', message: '运行记录不存在或已被归档。', retryable: false };
  if (error instanceof ApiError && error.status === 504) return { code: 'TIMEOUT', message: 'Agent 动态查询超时，请稍后重试。', retryable: true };
  if (error instanceof TypeError) return { code: 'NETWORK_ERROR', message: 'Agent 动态服务暂时不可用，请检查连接后重试。', retryable: true };
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : 'Agent 动态加载失败，请重试。', retryable: true };
}

export interface AgentDynamicsController {
  filters: AgentDynamicsFilters;
  setFilters: (filters: AgentDynamicsFilters | ((previous: AgentDynamicsFilters) => AgentDynamicsFilters)) => void;
  setKeyword: (keyword: string) => void;
  reload: () => Promise<void>;
  reloadSummary: () => Promise<void>;
  reloadRuns: () => Promise<void>;
  openRun: (runId: string) => Promise<void>;
  closeRun: () => void;
  summary: AgentDynamicsSummaryState;
  runs: AgentDynamicsRunsState;
  detail: AgentDynamicsDetailState;
}

export function useAgentDynamicsController(options: { api?: AgentDynamicsApi; accountId?: string; pollIntervalMs?: number } = {}): AgentDynamicsController {
  const api = options.api ?? defaultAgentDynamicsApi;
  const [filters, setFilters] = useState<AgentDynamicsFilters>({ ...defaultAgentDynamicsFilters, accountId: options.accountId });
  const [summary, setSummary] = useState<AgentDynamicsSummaryState>({ phase: 'idle', data: null, error: null, refreshing: false });
  const [runs, setRuns] = useState<AgentDynamicsRunsState>({ phase: 'idle', data: null, error: null, refreshing: false });
  const [detail, setDetail] = useState<AgentDynamicsDetailState>({ phase: 'idle', data: null, error: null });
  const summaryRequestId = useRef(0);
  const runsRequestId = useRef(0);
  const detailRequestId = useRef(0);
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);
  const accountId = options.accountId;

  const reloadSummary = useCallback(async () => {
    if (!accountId) {
      setSummary({ phase: 'idle', data: null, error: null, refreshing: false });
      return;
    }
    const requestId = ++summaryRequestId.current;
    setSummary((previous) => ({ ...previous, phase: previous.data ? previous.phase : 'loading', error: null, refreshing: Boolean(previous.data) }));
    try {
      const data = await api.getSummary({ accountId, range: filters.range });
      if (requestId !== summaryRequestId.current) return;
      setSummary({ phase: 'success', data, error: null, refreshing: false, lastLoadedAt: new Date().toISOString() });
    } catch (error) {
      if (requestId !== summaryRequestId.current) return;
      const mapped = toAgentDynamicsLoadError(error);
      setSummary((previous) => ({ phase: mapped.code === 'FORBIDDEN' ? 'forbidden' : mapped.code === 'TIMEOUT' ? 'timeout' : 'error', data: previous.data, error: mapped, refreshing: false, lastLoadedAt: previous.lastLoadedAt }));
    }
  }, [accountId, api, filters.range]);

  const reloadRuns = useCallback(async () => {
    if (!accountId) {
      setRuns({ phase: 'idle', data: null, error: null, refreshing: false });
      return;
    }
    const requestId = ++runsRequestId.current;
    setRuns((previous) => ({ ...previous, phase: previous.data ? previous.phase : 'loading', error: null, refreshing: Boolean(previous.data) }));
    try {
      const data = await api.listRuns({ ...filters, accountId });
      if (requestId !== runsRequestId.current) return;
      setRuns({ phase: data.items.length === 0 ? 'empty' : 'success', data, error: null, refreshing: false });
      setSummary((previous) => previous.data && previous.data.events.length === 0 ? { ...previous, data: { ...previous.data, events: eventsFromRuns(data.items) } } : previous);
    } catch (error) {
      if (requestId !== runsRequestId.current) return;
      const mapped = toAgentDynamicsLoadError(error);
      setRuns({ phase: mapped.code === 'FORBIDDEN' ? 'forbidden' : mapped.code === 'TIMEOUT' ? 'timeout' : 'error', data: null, error: mapped, refreshing: false });
    }
  }, [accountId, api, filters]);

  const reload = useCallback(async () => {
    await Promise.all([reloadSummary(), reloadRuns()]);
  }, [reloadRuns, reloadSummary]);

  useEffect(() => { if (accountId) void reload(); }, [accountId, filtersKey, reload]);

  useEffect(() => {
    const interval = options.pollIntervalMs ?? 5000;
    if (!accountId) return undefined;
    const timer = window.setInterval(() => { void reload(); }, interval);
    return () => window.clearInterval(timer);
  }, [accountId, options.pollIntervalMs, reload]);

  const openRun = useCallback(async (runId: string) => {
    if (!accountId) return;
    const requestId = ++detailRequestId.current;
    setDetail({ phase: 'loading', runId, data: null, error: null });
    try {
      const data = await api.getRunDetail(runId, accountId);
      if (requestId !== detailRequestId.current) return;
      setDetail({ phase: 'success', runId, data, error: null });
    } catch (error) {
      if (requestId !== detailRequestId.current) return;
      const mapped = toAgentDynamicsLoadError(error);
      setDetail({ phase: mapped.code === 'FORBIDDEN' ? 'forbidden' : 'error', runId, data: null, error: mapped });
    }
  }, [accountId, api]);

  const closeRun = useCallback(() => {
    detailRequestId.current += 1;
    setDetail({ phase: 'idle', data: null, error: null });
  }, []);

  const setKeyword = useCallback((keyword: string) => setFilters((previous) => ({ ...previous, keyword, page: 1 })), []);

  return { filters, setFilters, setKeyword, reload, reloadSummary, reloadRuns, openRun, closeRun, summary, runs, detail };
}
