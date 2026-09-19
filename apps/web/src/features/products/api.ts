import type { ProductAssetVM, ProductFilters, ProductSkuVM, ProductStatus, ProductVM, ProductsPageVM } from './types';

export interface ProductsApiTransport {
  get<T>(path: string): Promise<T>;
}

export interface ProductsApi {
  list(filters?: ProductFilters): Promise<ProductsPageVM>;
  getDetail(productId: string): Promise<ProductVM>;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  message?: string | null;
  error?: { code?: string };
}

interface ProductPayload {
  id: string;
  accountId: string;
  externalProductRef?: string;
  title: string;
  description?: string;
  categoryCode?: string;
  attributesJson?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  defaultReplyTemplate?: string;
  aiPrompt?: string;
  configVersion?: number;
  priceMinor?: number | null;
  status: ProductStatus;
  updatedAt?: string;
  skus?: ProductSkuVM[];
  assets?: ProductAssetVM[];
  skuCount?: number;
  assetCount?: number;
}

interface ProductsPayload {
  items?: ProductPayload[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}

function unwrapEnvelope<T>(payload: T | ApiEnvelope<T>): T {
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
    const envelope = payload as ApiEnvelope<T>;
    if (!envelope.success || envelope.data === null) throw new Error(envelope.message ?? envelope.error?.code ?? 'PRODUCT_REQUEST_FAILED');
    return envelope.data;
  }
  return payload as T;
}

function toProductVM(product: ProductPayload): ProductVM {
  const skus = product.skus?.map((sku) => ({ ...sku, productId: sku.productId || product.id }));
  const assets = product.assets?.map((asset) => ({ ...asset, productId: asset.productId || product.id }));
  return {
    id: product.id,
    accountId: product.accountId,
    externalProductRef: product.externalProductRef,
    title: product.title,
    description: product.description,
    categoryCode: product.categoryCode,
    attributesJson: product.attributesJson ?? product.attributes ?? {},
    defaultReplyTemplate: product.defaultReplyTemplate,
    aiPrompt: product.aiPrompt,
    configVersion: product.configVersion ?? 1,
    priceMinor: product.priceMinor ?? undefined,
    status: product.status,
    updatedAt: product.updatedAt ?? new Date(0).toISOString(),
    skuCount: product.skuCount ?? skus?.length ?? 0,
    assetCount: product.assetCount ?? assets?.length ?? 0,
    skus,
    assets,
  };
}

function toPage(payload: ProductsPayload): ProductsPageVM {
  const items = (payload.items ?? []).map(toProductVM);
  const page = payload.page ?? 1;
  const pageSize = payload.pageSize ?? 20;
  const total = payload.total ?? items.length;
  return { items, total, page, pageSize, totalPages: payload.totalPages ?? Math.max(1, Math.ceil(total / pageSize)) };
}

function queryString(filters: ProductFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.keyword?.trim()) params.set('keyword', filters.keyword.trim());
  if (filters.accountId) params.set('accountId', filters.accountId);
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  params.set('page', String(filters.page ?? 1));
  params.set('pageSize', String(filters.pageSize ?? 20));
  const value = params.toString();
  return value ? `?${value}` : '';
}

export function createProductsApi(transport: ProductsApiTransport): ProductsApi {
  return {
    async list(filters = {}) {
      const payload = await transport.get<ProductsPayload | ApiEnvelope<ProductsPayload>>(`/api/v1/products${queryString(filters)}`);
      return toPage(unwrapEnvelope(payload));
    },
    async getDetail(productId) {
      const payload = await transport.get<ProductPayload | ApiEnvelope<ProductPayload>>(`/api/v1/products/${encodeURIComponent(productId)}`);
      return toProductVM(unwrapEnvelope(payload));
    },
  };
}

export function createMockProductsApi(seed: ProductVM[] = [
  { id: 'product-001', accountId: 'account-001', externalProductRef: 'xy-1001', title: 'Python 全栈资料包', description: '课程资料与配套源码。', categoryCode: 'digital', attributesJson: {}, configVersion: 3, priceMinor: 3990, status: 'published', updatedAt: '2026-09-20T09:30:00.000Z', skuCount: 1, assetCount: 3 },
  { id: 'product-002', accountId: 'account-001', title: 'GitHub 源码下载', categoryCode: 'digital', attributesJson: {}, configVersion: 1, priceMinor: 1990, status: 'draft', updatedAt: '2026-09-19T16:20:00.000Z', skuCount: 0, assetCount: 1 },
]): ProductsApi {
  return {
    async list(filters = {}) {
      const keyword = filters.keyword?.trim().toLowerCase();
      const filtered = seed.filter((item) => (!filters.accountId || item.accountId === filters.accountId) && (!filters.status || filters.status === 'all' || item.status === filters.status) && (!keyword || `${item.title} ${item.externalProductRef ?? ''}`.toLowerCase().includes(keyword)));
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;
      const start = (page - 1) * pageSize;
      return { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) };
    },
    async getDetail(productId) {
      const product = seed.find((item) => item.id === productId);
      if (!product) throw new Error('PRODUCT_NOT_FOUND');
      return product;
    },
  };
}

export { toProductVM, unwrapEnvelope };
