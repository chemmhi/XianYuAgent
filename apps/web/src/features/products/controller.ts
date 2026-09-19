import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMockProductsApi, type ProductsApi } from './api';
import type { ProductDetailState, ProductFilters, ProductsLoadError, ProductsQueryState } from './types';

const defaultProductsApi = createMockProductsApi();

export function toProductsLoadError(error: unknown): ProductsLoadError {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  if (status === 403) return { code: 'FORBIDDEN', message: '当前管理员没有读取商品的权限。', retryable: false };
  if (status === 404) return { code: 'NOT_FOUND', message: '商品接口暂不可用，请确认后端商品切片已部署。', retryable: false };
  if (error instanceof TypeError) return { code: 'NETWORK_ERROR', message: '商品服务暂时不可用，请检查连接后重试。', retryable: true };
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : '商品列表加载失败，请重试。', retryable: true };
}

export interface ProductsController {
  filters: ProductFilters;
  setFilters: (filters: ProductFilters | ((previous: ProductFilters) => ProductFilters)) => void;
  setKeyword: (keyword: string) => void;
  reload: () => Promise<void>;
  openProduct: (productId: string) => Promise<void>;
  closeProduct: () => void;
  state: ProductsQueryState;
  detail: ProductDetailState;
}

export function useProductsController(options: { api?: ProductsApi; initialFilters?: ProductFilters } = {}): ProductsController {
  const productsApi = options.api ?? defaultProductsApi;
  const [filters, setFilters] = useState<ProductFilters>({ page: 1, pageSize: 20, ...options.initialFilters });
  const [state, setState] = useState<ProductsQueryState>({ phase: 'idle', data: null, error: null });
  const [detail, setDetail] = useState<ProductDetailState>({ phase: 'idle', data: null, error: null });
  const requestId = useRef(0);
  const detailRequestId = useRef(0);
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
  const setKeyword = useCallback((keyword: string) => { setFilters((previous) => ({ ...previous, keyword, page: 1 })); }, []);

  return { filters, setFilters, setKeyword, reload, openProduct, closeProduct, state, detail };
}
