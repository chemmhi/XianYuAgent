import type { CouponBatchFilters, CouponBatchVM, CouponBindingVM, CouponContentPreviewVM, CouponItemVM, CreateCouponBatchRequest, CouponsPageVM, DeliveryScope, InventoryLockVM, StockAlert, UpdateCouponBatchRequest, CouponMetadataVM } from './types';

export interface CouponsApiTransport {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  delete<T>(path: string, init?: RequestInit): Promise<T>;
}

export interface CouponsApi {
  list(filters?: CouponBatchFilters): Promise<CouponsPageVM>;
  getDetail(batchId: string): Promise<CouponBatchVM>;
  createBatch(input: CreateCouponBatchRequest): Promise<CouponBatchVM>;
  updateBatch(batchId: string, input: UpdateCouponBatchRequest): Promise<CouponBatchVM>;
  importItems(batchId: string, items: string[]): Promise<InventoryLockVM>;
  bindBatch(batchId: string, productId: string): Promise<InventoryLockVM>;
  unbindBatch(batchId: string, productId: string): Promise<InventoryLockVM>;
  voidBatch(batchId: string): Promise<InventoryLockVM>;
  deleteBatch(batchId: string): Promise<InventoryLockVM>;
  batchDelete(batchIds: string[]): Promise<InventoryLockVM[]>;
  getContent(couponId: string, options?: { purpose?: 'delivery' | 'preview' | 'audit'; deliveryScope?: DeliveryScope }): Promise<CouponContentPreviewVM>;
}

interface ApiEnvelope<T> { success: boolean; data: T | null; message?: string | null; error?: { code?: string }; }
interface CouponPayload extends Omit<Partial<CouponBatchVM>, 'bindings'> {
  id?: string;
  batchId?: string;
  total?: number;
  available?: number;
  reserved?: number;
  consumed?: number;
  items?: CouponItemVM[];
  productBindings?: Array<Partial<CouponBindingVM> & { id?: string }>;
  bindings?: Array<Partial<CouponBindingVM> & { id?: string }>;
  metadata?: CouponMetadataVM;
  contentPreview?: CouponBatchVM['contentPreview'];
}

interface CouponMutationPayload extends Partial<InventoryLockVM> {
  batch?: CouponPayload;
  binding?: { id?: string; bindingId?: string; batchId?: string; productId?: string; priority?: number; status?: string; expiresAt?: string };
  importedCount?: number;
  rejected?: Array<{ index: number; code: string; message: string }>;
  voided?: boolean;
  deleted?: boolean;
}

function unwrapEnvelope<T>(payload: T | ApiEnvelope<T>): T {
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
    const envelope = payload as ApiEnvelope<T>;
    if (!envelope.success || envelope.data === null) throw new Error(envelope.message ?? envelope.error?.code ?? 'COUPON_REQUEST_FAILED');
    return envelope.data;
  }
  return payload as T;
}

function toStockAlert(value: unknown, availableCount: number, totalCount: number): StockAlert {
  if (value === 'exhausted' || availableCount <= 0) return 'exhausted';
  if (value === 'low_stock' || availableCount <= Math.max(1, Math.ceil(totalCount * 0.1))) return 'low_stock';
  return 'normal';
}

function toBatchVM(payload: CouponPayload): CouponBatchVM {
  const batchId = String(payload.batchId ?? payload.id ?? '');
  const totalCount = Number(payload.totalCount ?? payload.total ?? 0);
  const availableCount = Number(payload.availableCount ?? payload.available ?? 0);
  const reservedCount = Number(payload.reservedCount ?? payload.reserved ?? 0);
  const consumedCount = Number(payload.consumedCount ?? payload.consumed ?? Math.max(0, totalCount - availableCount - reservedCount));
  const rawStatus = payload.status as CouponBatchVM['status'] | undefined;
  const bindings = (payload.bindings ?? payload.productBindings ?? []).map((binding) => ({
    bindingId: String(binding.bindingId ?? binding.id ?? ''),
    batchId: String(binding.batchId ?? batchId),
    productId: String(binding.productId ?? ''),
    productTitle: binding.productTitle,
    priority: Number(binding.priority ?? 0),
    status: binding.status === 'inactive' ? 'unbound' : (binding.status as CouponBindingVM['status'] | undefined) ?? 'active',
    expiresAt: binding.expiresAt,
  }));
  return {
    batchId,
    accountId: String(payload.accountId ?? ''),
    label: String(payload.label ?? payload.purpose ?? batchId),
    purpose: (payload.purpose as CouponBatchVM['purpose']) ?? 'text',
    deliveryScope: (payload.deliveryScope as DeliveryScope) ?? 'operator_only',
    status: rawStatus ?? 'draft',
    totalCount,
    availableCount,
    reservedCount,
    consumedCount,
    stockAlert: toStockAlert(payload.stockAlert, availableCount, totalCount),
    version: Number(payload.version ?? 1),
    updatedAt: payload.updatedAt ?? new Date(0).toISOString(),
    bindings,
    items: payload.items?.map((item) => ({ ...item, batchId: item.batchId || batchId })),
    quarkUrl: payload.quarkUrl,
    extractCode: payload.extractCode,
    createdAt: payload.createdAt,
    metadata: payload.metadata,
    contentPreview: payload.contentPreview,
  };
}

function toInventoryLockVM(payload: CouponMutationPayload): InventoryLockVM {
  const batch = payload.batch ? toBatchVM(payload.batch) : undefined;
  return {
    batchId: String(payload.batchId ?? batch?.batchId ?? ''),
    version: Number(payload.version ?? batch?.version ?? 0),
    totalCount: Number(payload.totalCount ?? batch?.totalCount ?? 0),
    availableCount: Number(payload.availableCount ?? batch?.availableCount ?? 0),
    reservedCount: Number(payload.reservedCount ?? batch?.reservedCount ?? 0),
    consumedCount: Number(payload.consumedCount ?? batch?.consumedCount ?? 0),
    stockAlert: (payload.stockAlert ?? batch?.stockAlert ?? 'normal') as StockAlert,
    results: payload.results,
  };
}

function toPage(payload: { items?: CouponPayload[]; total?: number; page?: number; pageSize?: number; totalPages?: number }): CouponsPageVM {
  const items = (payload.items ?? []).map(toBatchVM);
  const page = payload.page ?? 1;
  const pageSize = payload.pageSize ?? 20;
  const total = payload.total ?? items.length;
  return { items, total, page, pageSize, totalPages: payload.totalPages ?? Math.max(1, Math.ceil(total / pageSize)) };
}

function queryString(filters: CouponBatchFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.accountId) params.set('accountId', filters.accountId);
  if (filters.keyword?.trim()) params.set('keyword', filters.keyword.trim());
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.stockAlert && filters.stockAlert !== 'all') params.set('stockAlert', filters.stockAlert);
  if (filters.purpose && filters.purpose !== 'all') params.set('purpose', filters.purpose);
  params.set('page', String(filters.page ?? 1));
  params.set('pageSize', String(filters.pageSize ?? 20));
  return `?${params.toString()}`;
}

function mutationOptions(key: string): RequestInit { return { headers: { 'Idempotency-Key': key } }; }

export function createCouponsApi(transport: CouponsApiTransport): CouponsApi {
  return {
    async list(filters = {}) {
      const payload = await transport.get<{ items?: CouponPayload[]; total?: number; page?: number; pageSize?: number; totalPages?: number } | ApiEnvelope<{ items?: CouponPayload[]; total?: number; page?: number; pageSize?: number; totalPages?: number }>>(`/api/v1/coupons/batches${queryString(filters)}`);
      return toPage(unwrapEnvelope(payload));
    },
    async getDetail(batchId) {
      const payload = await transport.get<CouponPayload | ApiEnvelope<CouponPayload>>(`/api/v1/coupons/batches/${encodeURIComponent(batchId)}`);
      return toBatchVM(unwrapEnvelope(payload));
    },
    async createBatch(input) {
      const payload = await transport.post<CouponPayload | ApiEnvelope<CouponPayload>>('/api/v1/coupons/batches', input, mutationOptions(`coupons.create.${Date.now()}`));
      const created = toBatchVM(unwrapEnvelope(payload));
      if (!input.items?.length) return created;
      await this.importItems(created.batchId, input.items);
      return this.getDetail(created.batchId);
    },
    async updateBatch(batchId, input) {
      const payload = await transport.patch<CouponPayload | ApiEnvelope<CouponPayload>>(`/api/v1/coupons/batches/${encodeURIComponent(batchId)}`, input, mutationOptions(`coupons.update.${batchId}.${Date.now()}`));
      return toBatchVM(unwrapEnvelope(payload));
    },
    async importItems(batchId, items) {
      const payload = await transport.post<CouponMutationPayload | ApiEnvelope<CouponMutationPayload>>(`/api/v1/coupons/batches/${encodeURIComponent(batchId)}/items/import`, { items }, mutationOptions(`coupons.import.${batchId}.${Date.now()}`));
      return toInventoryLockVM(unwrapEnvelope(payload));
    },
    async bindBatch(batchId, productId) {
      const payload = await transport.post<CouponMutationPayload | ApiEnvelope<CouponMutationPayload>>(`/api/v1/coupons/batches/${encodeURIComponent(batchId)}/bind`, { productId }, mutationOptions(`coupons.bind.${batchId}.${productId}.${Date.now()}`));
      return toInventoryLockVM(unwrapEnvelope(payload));
    },
    async unbindBatch(batchId, productId) {
      const payload = await transport.post<CouponMutationPayload | ApiEnvelope<CouponMutationPayload>>(`/api/v1/coupons/batches/${encodeURIComponent(batchId)}/unbind`, { productId }, mutationOptions(`coupons.unbind.${batchId}.${productId}.${Date.now()}`));
      return toInventoryLockVM(unwrapEnvelope(payload));
    },
    async voidBatch(batchId) {
      const payload = await transport.post<CouponMutationPayload | ApiEnvelope<CouponMutationPayload>>(`/api/v1/coupons/batches/${encodeURIComponent(batchId)}/void`, {}, mutationOptions(`coupons.void.${batchId}.${Date.now()}`));
      return toInventoryLockVM(unwrapEnvelope(payload));
    },
    async deleteBatch(batchId) {
      const payload = await transport.delete<CouponMutationPayload | ApiEnvelope<CouponMutationPayload>>(`/api/v1/coupons/batches/${encodeURIComponent(batchId)}`, mutationOptions(`coupons.delete.${batchId}.${Date.now()}`));
      return toInventoryLockVM(unwrapEnvelope(payload));
    },
    async batchDelete(batchIds) {
      const results: InventoryLockVM[] = [];
      for (const batchId of batchIds) results.push(await this.deleteBatch(batchId));
      return results;
    },
    async getContent(couponId, options = {}) {
      const params = new URLSearchParams({ purpose: options.purpose ?? 'preview', deliveryScope: options.deliveryScope ?? 'operator_only' });
      const payload = await transport.get<CouponContentPreviewVM | ApiEnvelope<CouponContentPreviewVM>>(`/api/v1/coupons/${encodeURIComponent(couponId)}/content?${params.toString()}`);
      return unwrapEnvelope(payload);
    },
  };
}

export function createMockCouponsApi(seed: CouponBatchVM[] = [
  { batchId: 'batch-001', accountId: 'account-001', label: 'Python 全栈资料包', purpose: 'text', deliveryScope: 'buyer_deliverable', status: 'active', totalCount: 480, availableCount: 368, reservedCount: 12, consumedCount: 100, stockAlert: 'normal', version: 4, updatedAt: '2026-09-19T16:20:00.000Z', bindings: [{ bindingId: 'binding-001', batchId: 'batch-001', productId: 'product-001', productTitle: 'Python 全栈资料包', priority: 0, status: 'active' }], items: [{ id: 'coupon-001', batchId: 'batch-001', maskedLabel: 'PY-••••-0001', status: 'available' }] },
  { batchId: 'batch-002', accountId: 'account-001', label: 'GitHub 源码下载', purpose: 'data', deliveryScope: 'operator_only', status: 'active', totalCount: 40, availableCount: 3, reservedCount: 0, consumedCount: 37, stockAlert: 'low_stock', version: 2, updatedAt: '2026-09-18T11:40:00.000Z', bindings: [], items: [{ id: 'coupon-002', batchId: 'batch-002', maskedLabel: 'GH-••••-0021', status: 'available' }] },
  { batchId: 'batch-003', accountId: 'account-002', label: '设计素材合集', purpose: 'image', deliveryScope: 'operator_only', status: 'paused', totalCount: 0, availableCount: 0, reservedCount: 0, consumedCount: 0, stockAlert: 'exhausted', version: 1, updatedAt: '2026-09-17T09:05:00.000Z', bindings: [], items: [] },
]): CouponsApi {
  let batches: CouponBatchVM[] = seed.map((batch) => ({ ...batch, bindings: [...batch.bindings], items: batch.items?.map((item) => ({ ...item })) }));
  return {
    async list(filters = {}) {
      const keyword = filters.keyword?.trim().toLowerCase();
      const filtered = batches.filter((batch) => (!filters.accountId || batch.accountId === filters.accountId) && (!filters.status || filters.status === 'all' || batch.status === filters.status) && (!filters.stockAlert || filters.stockAlert === 'all' || batch.stockAlert === filters.stockAlert) && (!filters.purpose || filters.purpose === 'all' || batch.purpose === filters.purpose) && (!keyword || `${batch.label} ${batch.batchId} ${batch.metadata?.description ?? ''}`.toLowerCase().includes(keyword)));
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;
      const start = (page - 1) * pageSize;
      return { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)) };
    },
    async getDetail(batchId) { const batch = batches.find((item) => item.batchId === batchId); if (!batch) throw Object.assign(new Error('BATCH_NOT_FOUND'), { status: 404 }); return { ...batch, items: batch.items?.map((item) => ({ ...item })) }; },
    async createBatch(input) {
      const now = new Date().toISOString();
      const items = (input.items ?? []).filter(Boolean).map((body, index) => ({ id: `coupon-${Date.now()}-${index}`, batchId: `batch-${Date.now()}`, maskedLabel: body.length > 6 ? `${body.slice(0, 3)}••••${body.slice(-2)}` : '••••••', status: 'available' as const }));
      const batchId = items[0]?.batchId ?? `batch-${Date.now()}`;
      const batch: CouponBatchVM = { batchId, accountId: input.accountId, label: input.label, purpose: input.purpose, deliveryScope: input.deliveryScope, status: 'draft', totalCount: items.length, availableCount: items.length, reservedCount: 0, consumedCount: 0, stockAlert: items.length ? 'normal' : 'exhausted', version: 1, updatedAt: now, createdAt: now, bindings: [], items, metadata: input.metadata, contentPreview: { text: input.metadata?.textContent?.slice(0, 140), dataRemaining: items.length, apiUrl: input.metadata?.apiConfig?.url, imageUrls: input.metadata?.imageUrls ?? [] } };
      batches = [batch, ...batches];
      return batch;
    },
    async updateBatch(batchId, input) { const batch = batches.find((item) => item.batchId === batchId); if (!batch) throw Object.assign(new Error('BATCH_NOT_FOUND'), { status: 404 }); Object.assign(batch, input); if (input.metadata !== undefined) batch.metadata = input.metadata; batch.updatedAt = new Date().toISOString(); batch.version += 1; batch.contentPreview = { text: batch.metadata?.textContent?.slice(0, 140), dataRemaining: batch.availableCount, apiUrl: batch.metadata?.apiConfig?.url, imageUrls: batch.metadata?.imageUrls ?? [] }; return { ...batch, bindings: [...batch.bindings] }; },
    async importItems(batchId, items) {
      const batch = batches.find((item) => item.batchId === batchId); if (!batch) throw Object.assign(new Error('BATCH_NOT_FOUND'), { status: 404 });
      const nextItems = items.filter(Boolean).map((body, index) => ({ id: `coupon-${Date.now()}-${index}`, batchId, maskedLabel: body.length > 6 ? `${body.slice(0, 3)}••••${body.slice(-2)}` : '••••••', status: 'available' as const }));
      batch.items = [...(batch.items ?? []), ...nextItems]; batch.totalCount += nextItems.length; batch.availableCount += nextItems.length; batch.version += 1; batch.updatedAt = new Date().toISOString(); batch.stockAlert = toStockAlert(batch.stockAlert, batch.availableCount, batch.totalCount); return batch;
    },
    async bindBatch(batchId, productId) { const batch = batches.find((item) => item.batchId === batchId); if (!batch) throw Object.assign(new Error('BATCH_NOT_FOUND'), { status: 404 }); batch.bindings = [{ bindingId: `binding-${Date.now()}`, batchId, productId, priority: 0, status: 'active' }, ...batch.bindings.filter((item) => item.productId !== productId)]; batch.version += 1; batch.updatedAt = new Date().toISOString(); return batch; },
    async unbindBatch(batchId, productId) { const batch = batches.find((item) => item.batchId === batchId); if (!batch) throw Object.assign(new Error('BATCH_NOT_FOUND'), { status: 404 }); batch.bindings = batch.bindings.map((binding) => binding.productId === productId ? { ...binding, status: 'unbound' as const } : binding); batch.version += 1; batch.updatedAt = new Date().toISOString(); return batch; },
    async voidBatch(batchId) { const batch = batches.find((item) => item.batchId === batchId); if (!batch) throw Object.assign(new Error('BATCH_NOT_FOUND'), { status: 404 }); batch.status = 'voided'; batch.availableCount = 0; batch.stockAlert = 'exhausted'; batch.version += 1; batch.updatedAt = new Date().toISOString(); return batch; },
    async deleteBatch(batchId) { const batch = batches.find((item) => item.batchId === batchId); if (!batch) throw Object.assign(new Error('BATCH_NOT_FOUND'), { status: 404 }); batch.status = 'voided'; batch.availableCount = 0; batch.stockAlert = 'exhausted'; batch.version += 1; batch.updatedAt = new Date().toISOString(); return batch; },
    async batchDelete(batchIds) { return Promise.all(batchIds.map((batchId) => this.deleteBatch(batchId))); },
    async getContent(couponId, options = {}) { return { couponId, batchId: 'batch-001', purpose: options.purpose ?? 'preview', deliveryScope: options.deliveryScope ?? 'operator_only', accountIds: ['account-001'], content: { body: 'preview-only coupon content', quarkUrl: 'https://pan.quark.cn/s/example', extractionCode: 'AB12' }, access: { allowed: true, purpose: options.purpose ?? 'preview', auditRef: `AUD-${Date.now()}` }, inventoryStatus: 'available' }; },
  };
}

export { toBatchVM, unwrapEnvelope };
