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

export function useDashboardController(options: { api?: DashboardApi } = {}): DashboardController {
  const dashboardApi = options.api ?? defaultMockDashboardApi;
  const [state, setState] = useState<DashboardState>({ phase: 'idle', data: null, error: null, refreshing: false });
  const [query, setQueryState] = useState<DashboardQuery>({ range: '7d' });
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setState((previous) => ({ ...previous, phase: previous.data ? previous.phase : 'loading', error: null, refreshing: Boolean(previous.data) }));
    try {
      const snapshot = await dashboardApi.getSnapshot(query);
      if (currentRequest !== requestId.current) return;
      const data = toDashboardVM(snapshot);
      setState({ phase: data.kpis.every((item) => item.value === '0' || item.value === '¥0') ? 'empty' : 'success', data, error: null, refreshing: false });
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      const loadError = toLoadError(error);
      setState((previous) => ({ phase: loadError.code === 'FORBIDDEN' ? 'forbidden' : loadError.code === 'TIMEOUT' ? 'timeout' : 'error', data: previous.data, error: loadError, refreshing: false }));
    }
  }, [dashboardApi, query]);

  const setQuery = useCallback((nextQuery: DashboardQuery) => {
    setQueryState(nextQuery);
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { state, query, setQuery, reload };
}
