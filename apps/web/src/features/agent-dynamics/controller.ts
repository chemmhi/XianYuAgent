import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/http';
import { defaultAgentDynamicsApi, type AgentDynamicsApi } from './api';
import type { AgentDynamicsFilters, AgentDynamicsLoadError, AgentDynamicsRunsState, AgentDynamicsDetailState, AgentDynamicsSummaryState, AgentDynamicsLoadPhase } from './types';

export const defaultAgentDynamicsFilters: AgentDynamicsFilters = { range: '24h', status: 'all', stage: 'all', keyword: '', page: 1, pageSize: 10 };

export function toAgentDynamicsLoadError(error: unknown): AgentDynamicsLoadError {
  if (error instanceof ApiError && error.status === 403) return { code: 'FORBIDDEN', message: '当前管理员没有读取 Agent 动态的权限，请检查账号范围。', retryable: false };
  if (error instanceof ApiError && error.status === 404) return { code: 'NOT_FOUND', message: '运行记录不存在或已被归档。', retryable: false };
  if (error instanceof ApiError && error.status === 504) return { code: 'TIMEOUT', message: 'Agent 动态查询超时，请稍后重试。', retryable: true };
  if (error instanceof TypeError) return { code: 'NETWORK_ERROR', message: 'Agent 动态服务暂时不可用，请检查连接后重试。', retryable: true };
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : 'Agent 动态加载失败，请重试。', retryable: true };
}

function phaseForRunsError(error: AgentDynamicsLoadError): AgentDynamicsLoadPhase {
  return error.code === 'FORBIDDEN' ? 'forbidden' : error.code === 'TIMEOUT' ? 'timeout' : 'error';
}

/**
 * Keep the last successful run page visible while a background refresh fails.
 * Polling should surface an inline error, not blank the whole table.
 */
export function agentDynamicsRunsErrorState(previous: AgentDynamicsRunsState, error: AgentDynamicsLoadError): AgentDynamicsRunsState {
  return {
    phase: previous.data ? previous.phase : phaseForRunsError(error),
    data: previous.data,
    error,
    refreshing: false,
  };
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

export function useAgentDynamicsController(options: { api?: AgentDynamicsApi; accountId?: string; pollIntervalMs?: number; enabled?: boolean } = {}): AgentDynamicsController {
  const api = options.api ?? defaultAgentDynamicsApi;
  const enabled = options.enabled ?? true;
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
    if (!enabled || !accountId) return;
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
  }, [accountId, api, enabled, filters.range]);

  const reloadRuns = useCallback(async () => {
    if (!enabled || !accountId) return;
    const requestId = ++runsRequestId.current;
    setRuns((previous) => ({ ...previous, phase: previous.data ? previous.phase : 'loading', error: null, refreshing: Boolean(previous.data) }));
    try {
      const data = await api.listRuns({ ...filters, accountId });
      if (requestId !== runsRequestId.current) return;
      setRuns({ phase: data.items.length === 0 ? 'empty' : 'success', data, error: null, refreshing: false });
    } catch (error) {
      if (requestId !== runsRequestId.current) return;
      const mapped = toAgentDynamicsLoadError(error);
      setRuns((previous) => agentDynamicsRunsErrorState(previous, mapped));
    }
  }, [accountId, api, enabled, filters]);

  const reload = useCallback(async () => {
    await Promise.all([reloadSummary(), reloadRuns()]);
  }, [reloadRuns, reloadSummary]);

  useEffect(() => {
    if (!enabled || !accountId) {
      summaryRequestId.current += 1;
      runsRequestId.current += 1;
      detailRequestId.current += 1;
      setSummary({ phase: 'idle', data: null, error: null, refreshing: false });
      setRuns({ phase: 'idle', data: null, error: null, refreshing: false });
      setDetail({ phase: 'idle', data: null, error: null });
      return;
    }
    void reload();
  }, [accountId, enabled, filtersKey, reload]);

  useEffect(() => {
    if (!enabled || !accountId) return;
    const interval = options.pollIntervalMs ?? 5000;
    const timer = window.setInterval(() => { void reload(); }, interval);
    return () => window.clearInterval(timer);
  }, [accountId, enabled, options.pollIntervalMs, reload]);

  const openRun = useCallback(async (runId: string) => {
    if (!enabled || !accountId) return;
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
  }, [accountId, api, enabled]);

  const closeRun = useCallback(() => {
    detailRequestId.current += 1;
    setDetail({ phase: 'idle', data: null, error: null });
  }, []);

  const setKeyword = useCallback((keyword: string) => setFilters((previous) => ({ ...previous, keyword, page: 1 })), []);

  return { filters, setFilters, setKeyword, reload, reloadSummary, reloadRuns, openRun, closeRun, summary, runs, detail };
}
