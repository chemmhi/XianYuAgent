import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMockProductsApi, type ProductsApi } from './api';
import type { ProductDetailState, ProductDraftInput, ProductDraftPatch, ProductFilters, ProductMutationError, ProductsLoadError, ProductsQueryState, ProductVM, XianyuDetailState } from './types';

const defaultProductsApi = createMockProductsApi();

export function toProductsLoadError(error: unknown): ProductsLoadError {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  if (status === 403) return { code: 'FORBIDDEN', message: '当前管理员没有读取商品的权限。', retryable: false };
  if (status === 404) return { code: 'NOT_FOUND', message: '商品接口暂不可用，请确认后端商品切片已部署。', retryable: false };
  if (error instanceof TypeError) return { code: 'NETWORK_ERROR', message: '商品服务暂时不可用，请检查连接后重试。', retryable: true };
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : '商品列表加载失败，请重试。', retryable: true };
}

export function toProductsMutationError(error: unknown): ProductMutationError {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  const payload = typeof error === 'object' && error && 'payload' in error ? (error as { payload?: unknown }).payload : undefined;
  const code = typeof payload === 'object' && payload && 'error' in payload && typeof (payload as { error?: unknown }).error === 'object'
    ? String(((payload as { error?: { code?: string } }).error?.code) ?? '')
    : '';
  if (status === 409 && code === 'ACCOUNT_REAUTH_REQUIRED') return { code: 'ACCOUNT_REAUTH_REQUIRED', message: '闲鱼账号登录态已失效，请先重新登录账号。', retryable: false };
  if (status === 502 || code === 'XIANYU_SYNC_FAILED') return { code: 'SYNC_FAILED', message: '闲鱼商品同步失败，请稍后重试。', retryable: true };
  if (status === 403) return { code: 'FORBIDDEN', message: '当前管理员没有写入商品的权限。', retryable: false };
  if (status === 409 || code === 'PRODUCT_VERSION_CONFLICT') return { code: 'VERSION_CONFLICT', message: '商品已被其他操作更新，请保留本地草稿后重新加载。', retryable: false };
  if (status === 422) return { code: 'VALIDATION_FAILED', message: '商品字段校验失败，请检查输入。', retryable: false };
  if (error instanceof TypeError) return { code: 'NETWORK_ERROR', message: '商品服务暂时不可用，请检查连接后重试。', retryable: true };
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : '商品保存失败，请重试。', retryable: true };
}

export interface ProductsMutationState {
  phase: 'idle' | 'saving' | 'success' | 'error';
  error: ProductMutationError | null;
}

export interface ProductsController {
  filters: ProductFilters;
  setFilters: (filters: ProductFilters | ((previous: ProductFilters) => ProductFilters)) => void;
  setKeyword: (keyword: string) => void;
  reload: () => Promise<void>;
  openProduct: (productId: string) => Promise<void>;
  closeProduct: () => void;
  openXianyuDetail: (productId: string) => Promise<void>;
  syncXianyuDetail: (productId: string) => Promise<void>;
  closeXianyuDetail: () => void;
  createDraft: (input: ProductDraftInput) => Promise<ProductVM | null>;
  updateDraft: (productId: string, patch: ProductDraftPatch, configVersion: number) => Promise<ProductVM | null>;
  syncFromXianyu: (accountId: string) => Promise<boolean>;
  clearMutation: () => void;
  state: ProductsQueryState;
  detail: ProductDetailState;
  xianyuDetail: XianyuDetailState;
  mutation: ProductsMutationState;
}

export function useProductsController(options: { api?: ProductsApi; initialFilters?: ProductFilters } = {}): ProductsController {
  const productsApi = options.api ?? defaultProductsApi;
  const [filters, setFilters] = useState<ProductFilters>({ page: 1, pageSize: 20, sortBy: 'xianyuOrder', sortOrder: 'asc', ...options.initialFilters });
  const [state, setState] = useState<ProductsQueryState>({ phase: 'idle', data: null, error: null });
  const [detail, setDetail] = useState<ProductDetailState>({ phase: 'idle', data: null, error: null });
  const [xianyuDetail, setXianyuDetail] = useState<XianyuDetailState>({ phase: 'idle', data: null, error: null });
  const [mutation, setMutation] = useState<ProductsMutationState>({ phase: 'idle', error: null });
  const requestId = useRef(0);
  const detailRequestId = useRef(0);
  const xianyuDetailRequestId = useRef(0);
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);

  const reload = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setState((previous) => ({ ...previous, phase: 'loading', error: null }));
    try {
      const data = await productsApi.list(filters);
      if (currentRequest !== requestId.current) return;
      setState({ phase: data.items.length === 0 ? 'empty' : 'success', data, error: null });
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      const normalized = toProductsLoadError(error);
      setState({ phase: normalized.code === 'FORBIDDEN' ? 'forbidden' : 'error', data: null, error: normalized });
    }
  }, [filters, productsApi]);

  useEffect(() => { void reload(); }, [filtersKey, reload]);

  const openProduct = useCallback(async (productId: string) => {
    const currentRequest = ++detailRequestId.current;
    setDetail({ phase: 'loading', productId, data: null, error: null });
    try {
      const data = await productsApi.getDetail(productId);
      if (currentRequest !== detailRequestId.current) return;
      setDetail({ phase: 'success', productId, data, error: null });
    } catch (error) {
      if (currentRequest !== detailRequestId.current) return;
      const normalized = toProductsLoadError(error);
      setDetail({ phase: normalized.code === 'FORBIDDEN' ? 'forbidden' : 'error', productId, data: null, error: normalized });
    }
  }, [productsApi]);

  const closeProduct = useCallback(() => { detailRequestId.current += 1; setDetail({ phase: 'idle', data: null, error: null }); }, []);
  const openXianyuDetail = useCallback(async (productId: string) => {
    const currentRequest = ++xianyuDetailRequestId.current;
    setXianyuDetail({ phase: 'loading', loadingMode: 'read', productId, data: null, error: null });
    try {
      // GET reads the persisted snapshot; the backend only fetches live data when
      // no snapshot exists yet.
      const data = await productsApi.getXianyuDetail(productId);
      if (currentRequest !== xianyuDetailRequestId.current) return;
      setXianyuDetail({ phase: 'success', productId, data, error: null });
    } catch (error) {
      if (currentRequest !== xianyuDetailRequestId.current) return;
      const normalized = toProductsLoadError(error);
      setXianyuDetail({ phase: normalized.code === 'FORBIDDEN' ? 'forbidden' : 'error', productId, data: null, error: normalized });
    }
  }, [productsApi]);
  const syncXianyuDetail = useCallback(async (productId: string) => {
    const currentRequest = ++xianyuDetailRequestId.current;
    setXianyuDetail({ phase: 'loading', loadingMode: 'sync', productId, data: null, error: null });
    try {
      const data = await productsApi.syncXianyuDetail(productId);
      if (currentRequest !== xianyuDetailRequestId.current) return;
      setXianyuDetail({ phase: 'success', productId, data, error: null });
    } catch (error) {
      if (currentRequest !== xianyuDetailRequestId.current) return;
      const normalized = toProductsLoadError(error);
      setXianyuDetail({ phase: normalized.code === 'FORBIDDEN' ? 'forbidden' : 'error', productId, data: null, error: normalized });
    }
  }, [productsApi]);
  const closeXianyuDetail = useCallback(() => { xianyuDetailRequestId.current += 1; setXianyuDetail({ phase: 'idle', data: null, error: null }); }, []);
  const setKeyword = useCallback((keyword: string) => { setFilters((previous) => ({ ...previous, keyword, page: 1 })); }, []);

  const createDraft = useCallback(async (input: ProductDraftInput) => {
    setMutation({ phase: 'saving', error: null });
    try {
      const product = await productsApi.createDraft(input);
      setMutation({ phase: 'success', error: null });
      await reload();
      return product;
    } catch (error) {
      setMutation({ phase: 'error', error: toProductsMutationError(error) });
      return null;
    }
  }, [productsApi, reload]);

  const updateDraft = useCallback(async (productId: string, patch: ProductDraftPatch, configVersion: number) => {
    setMutation({ phase: 'saving', error: null });
    try {
      const product = await productsApi.updateDraft(productId, patch, { configVersion });
      setMutation({ phase: 'success', error: null });
      await reload();
      setDetail({ phase: 'success', productId, data: product, error: null });
      return product;
    } catch (error) {
      const normalized = toProductsMutationError(error);
      if (normalized.code === 'VERSION_CONFLICT') {
        try { normalized.conflict = { server: await productsApi.getDetail(productId), local: patch }; } catch { normalized.conflict = { local: patch }; }
      }
      setMutation({ phase: 'error', error: normalized });
      return null;
    }
  }, [productsApi, reload]);
  const syncFromXianyu = useCallback(async (accountId: string) => {
    setMutation({ phase: 'saving', error: null });
    try {
      await productsApi.syncFromXianyu(accountId);
      setMutation({ phase: 'success', error: null });
      await reload();
      return true;
    } catch (error) {
      setMutation({ phase: 'error', error: toProductsMutationError(error) });
      return false;
    }
  }, [productsApi, reload]);
  const clearMutation = useCallback(() => setMutation({ phase: 'idle', error: null }), []);

  return { filters, setFilters, setKeyword, reload, openProduct, closeProduct, openXianyuDetail, syncXianyuDetail, closeXianyuDetail, createDraft, updateDraft, syncFromXianyu, clearMutation, state, detail, xianyuDetail, mutation };
}
