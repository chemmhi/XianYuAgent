import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/http';
import type { DashboardApi } from './api';
import { createMockDashboardApi } from './api.mock';
import { toDashboardVM, type DashboardLoadError, type DashboardQuery, type DashboardState } from './types';

const defaultMockDashboardApi = createMockDashboardApi();

function toLoadError(error: unknown): DashboardLoadError {
  if (error instanceof ApiError && error.status === 403) return { code: 'FORBIDDEN', message: '当前管理员没有读取仪表盘的权限，请检查账号范围。', retryable: false };
  if (error instanceof ApiError && error.status === 504) return { code: 'TIMEOUT', message: '指标可能滞后，服务端查询超时。', retryable: true };
  if (error instanceof TypeError) return { code: 'NETWORK_ERROR', message: '仪表盘服务暂时不可用，请检查连接后重试。', retryable: true };
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : '仪表盘加载失败，请重试。', retryable: true };
}

export interface DashboardController {
  state: DashboardState;
  query: DashboardQuery;
  setQuery: (query: DashboardQuery) => void;
  reload: () => Promise<void>;
}

/** Do not expose a prior account's snapshot while a new account is loading. */
export function getVisibleDashboardState(state: DashboardState, loadedAccountId: string | undefined, accountId: string | undefined): DashboardState {
  if (loadedAccountId === accountId) return state;
  return { phase: accountId ? 'loading' : 'idle', data: null, error: null, refreshing: false };
}

export function useDashboardController(options: { api?: DashboardApi; accountId?: string } = {}): DashboardController {
  const dashboardApi = options.api ?? defaultMockDashboardApi;
  const accountId = options.accountId?.trim() || undefined;
  const [state, setState] = useState<DashboardState>({ phase: 'idle', data: null, error: null, refreshing: false });
  const [loadedAccountId, setLoadedAccountId] = useState<string | undefined>(accountId);
  const loadedAccountIdRef = useRef(loadedAccountId);
  const [query, setQueryState] = useState<DashboardQuery>({ range: '1m' });
  const requestId = useRef(0);

  const markLoadedAccount = useCallback((nextAccountId: string | undefined) => {
    loadedAccountIdRef.current = nextAccountId;
    setLoadedAccountId(nextAccountId);
  }, []);

  const reload = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!accountId) {
      markLoadedAccount(undefined);
      setState({ phase: 'idle', data: null, error: null, refreshing: false });
      return;
    }
    setState((previous) => ({ phase: 'loading', data: previous.data && loadedAccountIdRef.current === accountId ? previous.data : null, error: null, refreshing: Boolean(previous.data && loadedAccountIdRef.current === accountId) }));
    try {
      const snapshot = await dashboardApi.getSnapshot({ ...query, accountId });
      if (currentRequest !== requestId.current) return;
      const data = toDashboardVM(snapshot);
      markLoadedAccount(accountId);
      setState({ phase: data.kpis.every((item) => item.value === '0' || item.value === '¥0') ? 'empty' : 'success', data, error: null, refreshing: false });
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      const loadError = toLoadError(error);
      markLoadedAccount(accountId);
      setState((previous) => ({ phase: loadError.code === 'FORBIDDEN' ? 'forbidden' : loadError.code === 'TIMEOUT' ? 'timeout' : 'error', data: previous.data, error: loadError, refreshing: false }));
    }
  }, [accountId, dashboardApi, markLoadedAccount, query]);

  const setQuery = useCallback((nextQuery: DashboardQuery) => {
    setQueryState(nextQuery);
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { state: getVisibleDashboardState(state, loadedAccountId, accountId), query, setQuery, reload };
}
