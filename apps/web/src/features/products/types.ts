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
  updatedAt: string;
  skuCount: number;
  assetCount: number;
  skus?: ProductSkuVM[];
  assets?: ProductAssetVM[];
}

export interface ProductFilters {
  accountId?: string;
  keyword?: string;
  status?: ProductStatus | 'all';
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
