export type ProductStatus = 'draft' | 'ready' | 'publishing' | 'published' | 'failed' | 'archived';

export interface ProductSkuVM {
  id: string;
  productId: string;
  skuCode: string;
  externalSkuRef?: string;
  priceMinor: number;
  status: 'active' | 'sold_out' | 'archived';
}

export interface ProductAssetVM {
  id: string;
  productId: string;
  storageKey: string;
  mimeType: string;
  checksum?: string;
  status: 'active' | 'failed' | 'archived';
}

export interface ProductCouponVM {
  id: string;
  label?: string;
}

export interface ProductVM {
  id: string;
  accountId: string;
  externalProductRef?: string;
  title: string;
  description?: string;
  categoryCode?: string;
  attributesJson: Record<string, unknown>;
  defaultReplyTemplate?: string;
  aiPrompt?: string;
  configVersion: number;
  priceMinor?: number;
  status: ProductStatus;
  source?: 'local' | 'xianyu';
  lastSyncedAt?: string;
  sourcePayloadDigest?: string;
  createdAt: string;
  updatedAt: string;
  couponBatches?: ProductCouponVM[];
  skuCount: number;
  assetCount: number;
  skus?: ProductSkuVM[];
  assets?: ProductAssetVM[];
}

export interface ProductSyncResultVM {
  syncRunId: string;
  accountId: string;
  fetchedCount: number;
  createdCount: number;
  updatedCount: number;
  skippedLocalDraftCount: number;
  hasMore: boolean;
  nextPageNumber?: number;
  items: ProductVM[];
}

export interface ProductDraftInput {
  accountId: string;
  title: string;
  description?: string;
  categoryCode?: string;
  priceMinor?: number;
}

export interface ProductDraftPatch {
  title?: string;
  description?: string;
  categoryCode?: string;
  priceMinor?: number;
}

export interface ProductMutationError {
  code: 'FORBIDDEN' | 'VERSION_CONFLICT' | 'VALIDATION_FAILED' | 'NETWORK_ERROR' | 'ACCOUNT_REAUTH_REQUIRED' | 'SYNC_FAILED' | 'UNKNOWN';
  message: string;
  retryable: boolean;
  conflict?: {
    server?: ProductVM;
    local: ProductDraftPatch;
  };
}

export interface ProductFilters {
  accountId?: string;
  keyword?: string;
  status?: ProductStatus | 'all';
  sortBy?: 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface ProductsPageVM {
  items: ProductVM[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type ProductsLoadPhase = 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'forbidden';

export interface ProductsLoadError {
  code: 'FORBIDDEN' | 'NOT_FOUND' | 'NETWORK_ERROR' | 'UNKNOWN';
  message: string;
  retryable: boolean;
}

export interface ProductsQueryState {
  phase: ProductsLoadPhase;
  data: ProductsPageVM | null;
  error: ProductsLoadError | null;
}

export interface ProductDetailState {
  phase: 'idle' | 'loading' | 'success' | 'error' | 'forbidden';
  productId?: string;
  data: ProductVM | null;
  error: ProductsLoadError | null;
}
