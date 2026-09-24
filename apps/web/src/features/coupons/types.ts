export type CouponBatchStatus = 'draft' | 'active' | 'paused' | 'closed' | 'voided';
export type CouponItemStatus = 'available' | 'reserved';

export interface CouponApiConfigVM { url: string; method: 'GET' | 'POST'; timeout?: number; headers?: string; params?: string; responseField?: string; }
export interface CouponMetadataVM {
  description?: string;
  delaySeconds?: number;
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
  status: CouponBatchStatus;
  version: number;
  updatedAt: string;
  bindings: CouponBindingVM[];
  items?: CouponItemVM[];
  createdAt?: string;
  metadata?: CouponMetadataVM;
  contentPreview?: { text?: string; apiUrl?: string; imageUrls?: string[] };
}

export interface CouponMutationVM {
  batchId: string;
  version: number;
  results?: Array<{ itemId?: string; ok: boolean; errorCode?: string }>;
}

export interface CouponBatchFilters {
  accountId?: string;
  keyword?: string;
  status?: CouponBatchStatus | 'all';
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
  items?: string[];
  metadata?: CouponMetadataVM;
}

export type UpdateCouponBatchRequest = Partial<Omit<CreateCouponBatchRequest, 'items'>> & { status?: CouponBatchStatus };
