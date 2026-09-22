export type CouponBatchStatus = 'draft' | 'active' | 'paused' | 'closed' | 'exhausted' | 'voided';
export type DeliveryScope = 'system_only' | 'operator_only' | 'buyer_deliverable';
export type CouponItemStatus = 'available' | 'reserved' | 'consumed' | 'delivered' | 'void' | 'exhausted';
export type StockAlert = 'normal' | 'low_stock' | 'exhausted';

export interface CouponApiConfigVM { url: string; method: 'GET' | 'POST'; timeout?: number; headers?: string; params?: string; responseField?: string; }
export interface CouponMetadataVM {
  description?: string;
  delaySeconds?: number;
  deliveryCount?: number;
  useNoLogisticsForm?: boolean;
  dockable?: boolean;
  price?: string;
  feePayer?: 'distributor' | 'dealer';
  minPrice?: string;
  dockVisibility?: 'public' | 'dealer_only';
  multiSpec?: boolean;
  specName?: string;
  specValue?: string;
  textContent?: string;
  dataContent?: string;
  apiConfig?: CouponApiConfigVM;
  imageUrls?: string[];
}

export interface CouponItemVM {
  id: string;
  batchId: string;
  maskedLabel?: string;
  status: CouponItemStatus;
  reservedUntil?: string;
  consumedAt?: string;
}

export interface CouponBindingVM {
  bindingId: string;
  batchId: string;
  productId: string;
  productTitle?: string;
  priority: number;
  status: 'active' | 'unbound' | 'inactive' | 'expired';
  expiresAt?: string;
}

export interface CouponBatchVM {
  batchId: string;
  accountId: string;
  label: string;
  purpose: 'text' | 'data' | 'image' | 'api';
  deliveryScope: DeliveryScope;
  status: CouponBatchStatus;
  totalCount: number;
  availableCount: number;
  reservedCount: number;
  consumedCount: number;
  stockAlert: StockAlert;
  version: number;
  updatedAt: string;
  bindings: CouponBindingVM[];
  items?: CouponItemVM[];
  quarkUrl?: string;
  extractCode?: string;
  createdAt?: string;
  metadata?: CouponMetadataVM;
  contentPreview?: { text?: string; dataRemaining?: number; apiUrl?: string; imageUrls?: string[] };
}

export interface InventoryLockVM {
  batchId: string;
  version: number;
  totalCount: number;
  availableCount: number;
  reservedCount: number;
  consumedCount: number;
  stockAlert: StockAlert;
  results?: Array<{ itemId?: string; ok: boolean; errorCode?: string }>;
}

export interface CouponBatchFilters {
  accountId?: string;
  keyword?: string;
  status?: CouponBatchStatus | 'all';
  stockAlert?: StockAlert | 'all';
  purpose?: CouponBatchVM['purpose'] | 'all';
  sortBy?: 'createdAt';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface CouponsPageVM {
  items: CouponBatchVM[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type CouponsLoadPhase = 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'forbidden';
export interface CouponsLoadError { code: 'FORBIDDEN' | 'NOT_FOUND' | 'NETWORK_ERROR' | 'CONFLICT' | 'UNKNOWN'; message: string; retryable: boolean; }
export interface CouponsQueryState { phase: CouponsLoadPhase; data: CouponsPageVM | null; error: CouponsLoadError | null; }
export interface CouponMutationState { phase: 'idle' | 'submitting' | 'success' | 'error'; error: CouponsLoadError | null; }

export interface CreateCouponBatchRequest {
  accountId: string;
  label: string;
  purpose: CouponBatchVM['purpose'];
  deliveryScope: DeliveryScope;
  quarkUrl?: string;
  extractionCode?: string;
  items?: string[];
  metadata?: CouponMetadataVM;
}

export type UpdateCouponBatchRequest = Partial<Omit<CreateCouponBatchRequest, 'items'>> & { status?: CouponBatchStatus };
