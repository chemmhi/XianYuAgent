import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMockCouponsApi, type CouponsApi } from './api';
import type { CouponBatchFilters, CouponContentPreviewVM, CouponDetailState, CouponMutationState, CouponsLoadError, CouponsQueryState, CreateCouponBatchRequest, InventoryLockVM } from './types';

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
  openBatch: (batchId: string) => Promise<void>;
  closeBatch: () => void;
  createBatch: (input: CreateCouponBatchRequest) => Promise<void>;
  importItems: (batchId: string, items: string[]) => Promise<void>;
  bindBatch: (batchId: string, productId: string) => Promise<void>;
  voidBatch: (batchId: string) => Promise<void>;
  deleteBatch: (batchId: string) => Promise<void>;
  previewContent: (couponId: string) => Promise<void>;
  state: CouponsQueryState;
  detail: CouponDetailState;
  content: CouponContentPreviewVM | null;
  mutation: CouponMutationState;
}

export function useCouponsController(options: { api?: CouponsApi; initialFilters?: CouponBatchFilters } = {}): CouponsController {
  const api = options.api ?? defaultCouponsApi;
  const [filters, setFilters] = useState<CouponBatchFilters>({ page: 1, pageSize: 20, ...options.initialFilters });
  const [state, setState] = useState<CouponsQueryState>({ phase: 'idle', data: null, error: null });
  const [detail, setDetail] = useState<CouponDetailState>({ phase: 'idle', data: null, error: null });
  const [content, setContent] = useState<CouponContentPreviewVM | null>(null);
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

  const openBatch = useCallback(async (batchId: string) => {
    setDetail({ phase: 'loading', batchId, data: null, error: null });
    setContent(null);
    try { setDetail({ phase: 'success', batchId, data: await api.getDetail(batchId), error: null }); }
    catch (error) { const mapped = toCouponsLoadError(error); setDetail({ phase: mapped.code === 'FORBIDDEN' ? 'forbidden' : 'error', batchId, data: null, error: mapped }); }
  }, [api]);

  const closeBatch = useCallback(() => { setDetail({ phase: 'idle', data: null, error: null }); setContent(null); }, []);
  const setKeyword = useCallback((keyword: string) => setFilters((previous) => ({ ...previous, keyword, page: 1 })), []);

  const runMutation = useCallback(async (action: () => Promise<InventoryLockVM | unknown>, batchId?: string) => {
    setMutation({ phase: 'submitting', error: null });
    try {
      await action();
      setMutation({ phase: 'success', error: null });
      await reload();
      if (batchId) await openBatch(batchId);
    } catch (error) {
      setMutation({ phase: 'error', error: toCouponsLoadError(error) });
      throw error;
    }
  }, [openBatch, reload]);

  const createBatch = useCallback(async (input: CreateCouponBatchRequest) => { await runMutation(() => api.createBatch(input)); }, [api, runMutation]);
  const importItems = useCallback(async (batchId: string, items: string[]) => { await runMutation(() => api.importItems(batchId, items), batchId); }, [api, runMutation]);
  const bindBatch = useCallback(async (batchId: string, productId: string) => { await runMutation(() => api.bindBatch(batchId, productId), batchId); }, [api, runMutation]);
  const voidBatch = useCallback(async (batchId: string) => { await runMutation(() => api.voidBatch(batchId), batchId); }, [api, runMutation]);
  const deleteBatch = useCallback(async (batchId: string) => { await runMutation(() => api.deleteBatch(batchId)); }, [api, runMutation]);
  const previewContent = useCallback(async (couponId: string) => {
    setContent(null);
    try {
      const scope = detail.data?.deliveryScope ?? 'operator_only';
      setContent(await api.getContent(couponId, { purpose: 'preview', deliveryScope: scope }));
    } catch (error) {
      setMutation({ phase: 'error', error: toCouponsLoadError(error) });
    }
  }, [api, detail.data?.deliveryScope]);

  return useMemo(() => ({ filters, setFilters, setKeyword, reload, openBatch, closeBatch, createBatch, importItems, bindBatch, voidBatch, deleteBatch, previewContent, state, detail, content, mutation }), [bindBatch, closeBatch, content, createBatch, deleteBatch, detail, filters, importItems, mutation, openBatch, previewContent, reload, setKeyword, state, voidBatch]);
}
