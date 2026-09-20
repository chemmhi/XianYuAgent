import type { ProductAssetVM, ProductCouponVM, ProductDraftInput, ProductDraftPatch, ProductFilters, ProductSkuVM, ProductStatus, ProductSyncResultVM, ProductVM, ProductsPageVM } from './types';

export interface ProductsApiTransport {
  get<T>(path: string): Promise<T>;
  post?<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  patch?<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
}

export interface ProductsApi {
  list(filters?: ProductFilters): Promise<ProductsPageVM>;
  getDetail(productId: string): Promise<ProductVM>;
  createDraft(input: ProductDraftInput, options?: { idempotencyKey?: string }): Promise<ProductVM>;
  updateDraft(productId: string, patch: ProductDraftPatch, options: { configVersion: number; idempotencyKey?: string }): Promise<ProductVM>;
  syncFromXianyu(accountId: string, options?: { pageSize?: number; maxPages?: number; idempotencyKey?: string }): Promise<ProductSyncResultVM>;
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
  source?: 'local' | 'xianyu';
  lastSyncedAt?: string;
  sourcePayloadDigest?: string;
  createdAt?: string;
  updatedAt?: string;
  couponBatches?: ProductCouponVM[];
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
    source: product.source,
    lastSyncedAt: product.lastSyncedAt,
    sourcePayloadDigest: product.sourcePayloadDigest,
    createdAt: product.createdAt ?? product.updatedAt ?? new Date(0).toISOString(),
    updatedAt: product.updatedAt ?? new Date(0).toISOString(),
    couponBatches: product.couponBatches ?? [],
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
  if (filters.sortBy) params.set('sortBy', filters.sortBy);
  if (filters.sortOrder) params.set('sortOrder', filters.sortOrder);
  params.set('page', String(filters.page ?? 1));
  params.set('pageSize', String(filters.pageSize ?? 20));
  const value = params.toString();
  return value ? `?${value}` : '';
}

function idempotencyKey(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function requireTransportMethod<T extends 'post' | 'patch'>(transport: ProductsApiTransport, method: T): NonNullable<ProductsApiTransport[T]> {
  const handler = transport[method];
  if (!handler) throw new Error(`PRODUCT_${method.toUpperCase()}_TRANSPORT_UNAVAILABLE`);
  return handler as NonNullable<ProductsApiTransport[T]>;
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
    async createDraft(input, options = {}) {
      const post = requireTransportMethod(transport, 'post');
      const payload = await post<ProductPayload | ApiEnvelope<ProductPayload>>('/api/v1/products', {
        accountId: input.accountId,
        title: input.title,
        description: input.description ?? null,
        categoryCode: input.categoryCode ?? null,
        priceMinor: input.priceMinor ?? null,
      }, { headers: { 'Idempotency-Key': options.idempotencyKey ?? idempotencyKey('product-create') } });
      return toProductVM(unwrapEnvelope(payload));
    },
    async updateDraft(productId, patch, options) {
      const patchRequest = requireTransportMethod(transport, 'patch');
      const payload = await patchRequest<ProductPayload | ApiEnvelope<ProductPayload>>(`/api/v1/products/${encodeURIComponent(productId)}`, patch, {
        headers: {
          'Idempotency-Key': options.idempotencyKey ?? idempotencyKey('product-update'),
          'If-Match-Version': String(options.configVersion),
        },
      });
      return toProductVM(unwrapEnvelope(payload));
    },
    async syncFromXianyu(accountId, options = {}) {
      const post = requireTransportMethod(transport, 'post');
      const payload = await post<{ syncRunId: string; accountId: string; fetchedCount: number; createdCount: number; updatedCount: number; skippedLocalDraftCount: number; hasMore: boolean; nextPageNumber?: number; items: ProductPayload[] } | ApiEnvelope<{ syncRunId: string; accountId: string; fetchedCount: number; createdCount: number; updatedCount: number; skippedLocalDraftCount: number; hasMore: boolean; nextPageNumber?: number; items: ProductPayload[] }>>('/api/v1/products/sync', {
        accountId,
        pageSize: options.pageSize,
        maxPages: options.maxPages,
      }, { headers: { 'Idempotency-Key': options.idempotencyKey ?? idempotencyKey('product-sync') } });
      const result = unwrapEnvelope(payload);
      return { ...result, items: result.items.map(toProductVM) };
    },
  };
}

export function createMockProductsApi(seed: ProductVM[] = [
  { id: 'product-001', accountId: 'account-001', externalProductRef: 'xy-1001', title: 'Python 全栈资料包', description: '课程资料与配套源码。', categoryCode: 'digital', attributesJson: {}, configVersion: 3, priceMinor: 3990, status: 'published', createdAt: '2026-09-18T09:30:00.000Z', updatedAt: '2026-09-20T09:30:00.000Z', couponBatches: [{ id: 'batch-001', label: 'Python 全栈资料包' }], aiPrompt: '用简洁中文回答买家问题。', skuCount: 1, assetCount: 3 },
  { id: 'product-002', accountId: 'account-001', title: 'GitHub 源码下载', categoryCode: 'digital', attributesJson: {}, configVersion: 1, priceMinor: 1990, status: 'draft', createdAt: '2026-09-19T10:20:00.000Z', updatedAt: '2026-09-19T16:20:00.000Z', skuCount: 0, assetCount: 1 },
]): ProductsApi {
  return {
    async list(filters = {}) {
      const keyword = filters.keyword?.trim().toLowerCase();
      const filtered = seed.filter((item) => (!filters.accountId || item.accountId === filters.accountId) && (!filters.status || filters.status === 'all' || item.status === filters.status) && (!keyword || `${item.title} ${item.externalProductRef ?? ''}`.toLowerCase().includes(keyword)));
      const sortBy = filters.sortBy ?? 'updatedAt';
      const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;
      filtered.sort((left, right) => {
        const leftValue = sortBy === 'createdAt' ? left.createdAt : left.updatedAt;
        const rightValue = sortBy === 'createdAt' ? right.createdAt : right.updatedAt;
        return (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0) * sortOrder;
      });
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
    async createDraft(input) {
      const product: ProductVM = {
        id: `draft-${seed.length + 1}`,
        accountId: input.accountId,
        title: input.title,
        description: input.description,
        categoryCode: input.categoryCode,
        attributesJson: {},
        configVersion: 1,
        priceMinor: input.priceMinor,
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        skuCount: 0,
        assetCount: 0,
      };
      seed.push(product);
      return product;
    },
    async updateDraft(productId, patch, options) {
      const product = seed.find((item) => item.id === productId);
      if (!product) throw new Error('PRODUCT_NOT_FOUND');
      if (product.configVersion !== options.configVersion) {
        const error = new Error('PRODUCT_VERSION_CONFLICT') as Error & { status?: number };
        error.status = 409;
        throw error;
      }
      Object.assign(product, patch, { configVersion: product.configVersion + 1, updatedAt: new Date().toISOString() });
      return product;
    },
    async syncFromXianyu(accountId) {
      const items = seed.filter((item) => item.accountId === accountId);
      return { syncRunId: `mock-sync-${Date.now()}`, accountId, fetchedCount: items.length, createdCount: 0, updatedCount: items.length, skippedLocalDraftCount: 0, hasMore: false, items };
    },
  };
}

export { toProductVM, unwrapEnvelope };
