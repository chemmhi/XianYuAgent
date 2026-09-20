import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMockOrdersApi, type OrdersApi } from './api';
import type { OrderDetailState, OrderFilters, OrdersLoadError, OrderQueryState } from './types';

const defaultApi = createMockOrdersApi();

export function toOrdersLoadError(error: unknown): OrdersLoadError {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  if (status === 403) return { code: 'FORBIDDEN', message: '当前管理员没有读取订单的权限。', retryable: false };
  if (status === 404) return { code: 'NOT_FOUND', message: '订单不存在或已被归档。', retryable: false };
  if (error instanceof TypeError) return { code: 'NETWORK_ERROR', message: '订单服务暂时不可用，请检查连接后重试。', retryable: true };
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : '订单列表加载失败，请重试。', retryable: true };
}

export interface OrdersController {
  filters: OrderFilters;
  setFilters: (filters: OrderFilters | ((previous: OrderFilters) => OrderFilters)) => void;
  setKeyword: (keyword: string) => void;
  reload: () => Promise<void>;
  refreshFromXianyu: () => Promise<void>;
  openOrder: (orderNo: string) => Promise<void>;
  closeOrder: () => void;
  state: OrderQueryState;
  detail: OrderDetailState;
}

export function useOrdersController(options: { api?: OrdersApi; initialFilters?: OrderFilters } = {}): OrdersController {
  const api = options.api ?? defaultApi;
  const [filters, setFilters] = useState<OrderFilters>({ page: 1, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc', ...options.initialFilters });
  const [state, setState] = useState<OrderQueryState>({ phase: 'idle', data: null, error: null });
  const [detail, setDetail] = useState<OrderDetailState>({ phase: 'idle', data: null, error: null });
  const requestId = useRef(0);
  const detailRequestId = useRef(0);
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);

  const reload = useCallback(async () => {
    const current = ++requestId.current;
    setState((previous) => ({ ...previous, phase: 'loading', error: null }));
    try {
      const data = await api.list(filters);
      if (current !== requestId.current) return;
      setState({ phase: data.items.length ? 'success' : 'empty', data, error: null });
    } catch (error) {
      if (current !== requestId.current) return;
      const mapped = toOrdersLoadError(error);
      setState({ phase: mapped.code === 'FORBIDDEN' ? 'forbidden' : 'error', data: null, error: mapped });
    }
  }, [api, filters]);

  useEffect(() => {
    // AccountContext uses a sentinel while accounts are still loading or none is selected.
    // Do not send that UI-only value to the scoped API and surface a misleading 403 state.
    if (filters.accountId === '__no_active_account__') {
      requestId.current += 1;
      setState({ phase: 'idle', data: null, error: null });
      return;
    }
    void reload();
  }, [filters.accountId, filtersKey, reload]);

  const refreshFromXianyu = useCallback(async () => { await api.refresh(filters.accountId); await reload(); }, [api, filters.accountId, reload]);
  const openOrder = useCallback(async (orderNo: string) => {
    const current = ++detailRequestId.current;
    setDetail({ phase: 'loading', orderNo, data: null, error: null });
    try {
      const data = await api.getDetail(orderNo, filters.accountId);
      if (current !== detailRequestId.current) return;
      setDetail({ phase: 'success', orderNo, data, error: null });
    } catch (error) {
      if (current !== detailRequestId.current) return;
      const mapped = toOrdersLoadError(error);
      setDetail({ phase: mapped.code === 'FORBIDDEN' ? 'forbidden' : 'error', orderNo, data: null, error: mapped });
    }
  }, [api, filters.accountId]);
  const closeOrder = useCallback(() => { detailRequestId.current += 1; setDetail({ phase: 'idle', data: null, error: null }); }, []);
  const setKeyword = useCallback((keyword: string) => setFilters((previous) => ({ ...previous, keyword, page: 1 })), []);

  return { filters, setFilters, setKeyword, reload, refreshFromXianyu, openOrder, closeOrder, state, detail };
}
