import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMockCouponsApi, type CouponsApi } from './api';
import type { CouponBatchFilters, CouponMutationState, CouponsLoadError, CouponsQueryState, CreateCouponBatchRequest, UpdateCouponBatchRequest } from './types';

const defaultCouponsApi = createMockCouponsApi();

export function toCouponsLoadError(error: unknown): CouponsLoadError {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  if (status === 403) return { code: 'FORBIDDEN', message: '当前管理员没有读取卡券的权限。', retryable: false };
  if (status === 404) return { code: 'NOT_FOUND', message: '卡券批次不存在或已被归档。', retryable: false };
  if (status === 409) return { code: 'CONFLICT', message: '批次版本已变化，请刷新后重试。', retryable: true };
  if (error instanceof TypeError) return { code: 'NETWORK_ERROR', message: '卡券服务暂时不可用，请检查连接后重试。', retryable: true };
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : '卡券请求失败，请重试。', retryable: true };
}

export interface CouponsController {
  filters: CouponBatchFilters;
  setFilters: (filters: CouponBatchFilters | ((previous: CouponBatchFilters) => CouponBatchFilters)) => void;
  setKeyword: (keyword: string) => void;
  reload: () => Promise<void>;
  createBatch: (input: CreateCouponBatchRequest) => Promise<void>;
  updateBatch: (batchId: string, input: UpdateCouponBatchRequest) => Promise<void>;
  bindBatch: (batchId: string, productId: string) => Promise<void>;
  unbindBatch: (batchId: string, productId: string) => Promise<void>;
  deleteBatch: (batchId: string) => Promise<void>;
  batchDelete: (batchIds: string[]) => Promise<void>;
  state: CouponsQueryState;
  mutation: CouponMutationState;
}

export function useCouponsController(options: { api?: CouponsApi; initialFilters?: CouponBatchFilters } = {}): CouponsController {
  const api = options.api ?? defaultCouponsApi;
  const [filters, setFilters] = useState<CouponBatchFilters>({ page: 1, pageSize: 20, ...options.initialFilters });
  const [state, setState] = useState<CouponsQueryState>({ phase: 'idle', data: null, error: null });
  const [mutation, setMutation] = useState<CouponMutationState>({ phase: 'idle', error: null });
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const current = ++requestId.current;
    setState((previous) => ({ ...previous, phase: 'loading', error: null }));
    try {
      const data = await api.list(filters);
      if (current !== requestId.current) return;
      setState({ phase: data.items.length ? 'success' : 'empty', data, error: null });
    } catch (error) {
      if (current !== requestId.current) return;
      const mapped = toCouponsLoadError(error);
      setState({ phase: mapped.code === 'FORBIDDEN' ? 'forbidden' : 'error', data: null, error: mapped });
    }
  }, [api, filters]);

  useEffect(() => { void reload(); }, [reload]);

  const setKeyword = useCallback((keyword: string) => setFilters((previous) => ({ ...previous, keyword, page: 1 })), []);
  const runMutation = useCallback(async (action: () => Promise<unknown>) => {
    setMutation({ phase: 'submitting', error: null });
    try {
      await action();
      setMutation({ phase: 'success', error: null });
      await reload();
    } catch (error) {
      setMutation({ phase: 'error', error: toCouponsLoadError(error) });
      throw error;
    }
  }, [reload]);

  const createBatch = useCallback(async (input: CreateCouponBatchRequest) => { await runMutation(() => api.createBatch(input)); }, [api, runMutation]);
  const updateBatch = useCallback(async (batchId: string, input: UpdateCouponBatchRequest) => { await runMutation(() => api.updateBatch(batchId, input)); }, [api, runMutation]);
  const bindBatch = useCallback(async (batchId: string, productId: string) => { await runMutation(() => api.bindBatch(batchId, productId)); }, [api, runMutation]);
  const unbindBatch = useCallback(async (batchId: string, productId: string) => { await runMutation(() => api.unbindBatch(batchId, productId)); }, [api, runMutation]);
  const deleteBatch = useCallback(async (batchId: string) => { await runMutation(() => api.deleteBatch(batchId)); }, [api, runMutation]);
  const batchDelete = useCallback(async (batchIds: string[]) => { await runMutation(() => api.batchDelete(batchIds)); }, [api, runMutation]);

  return useMemo(() => ({ filters, setFilters, setKeyword, reload, createBatch, updateBatch, bindBatch, unbindBatch, deleteBatch, batchDelete, state, mutation }), [batchDelete, bindBatch, createBatch, deleteBatch, filters, mutation, reload, setKeyword, state, unbindBatch, updateBatch]);
}
