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
  knowledgeBase?: string;
  configVersion: number;
  priceMinor?: number;
  status: ProductStatus;
  source?: 'local' | 'xianyu';
  lastSyncedAt?: string;
  xianyuUpdatedAt?: string;
  /** Position returned by the Xianyu seller page; lower ranks appear first. */
  xianyuListRank?: number;
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
  /** Structured publish-only fields kept in the product attributes envelope until publish API lands. */
  publishMeta?: ProductPublishMeta;
}

export interface ProductDraftPatch {
  title?: string;
  description?: string;
  categoryCode?: string;
  priceMinor?: number;
  knowledgeBase?: string | null;
  publishMeta?: ProductPublishMeta;
}

export interface ProductPublishImageMeta {
  name: string;
  mimeType: string;
  size?: number;
}

export interface ProductPublishMeta {
  originalPriceMinor?: number;
  postageMode?: 'free' | 'distance' | 'fixed' | 'none' | 'seller' | 'buyer';
  postageMinor?: number;
  location?: string;
  images?: ProductPublishImageMeta[];
}

export interface ProductMutationError {
  code: 'FORBIDDEN' | 'VERSION_CONFLICT' | 'VALIDATION_FAILED' | 'NETWORK_ERROR' | 'ACCOUNT_REAUTH_REQUIRED' | 'SYNC_FAILED' | 'UNKNOWN';
  message: string;
  retryable: boolean;
  reason?: 'SLIDER_VALIDATION' | 'REAUTH';
  conflict?: {
    server?: ProductVM;
    local: ProductDraftPatch;
  };
}

export interface ProductFilters {
  accountId?: string;
  keyword?: string;
  status?: ProductStatus | 'all';
  sortBy?: 'createdAt' | 'updatedAt' | 'xianyuOrder';
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
  code: 'FORBIDDEN' | 'NOT_FOUND' | 'NETWORK_ERROR' | 'ACCOUNT_REAUTH_REQUIRED' | 'UNKNOWN';
  message: string;
  retryable: boolean;
  reason?: 'SLIDER_VALIDATION' | 'REAUTH';
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

/** A reference to an image persisted in object storage, never the binary payload. */
export interface XianyuItemImageVM {
  id?: string;
  url: string;
  thumbnailUrl?: string;
  storageKey?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  alt?: string;
}

export interface XianyuItemSellerVM {
  sellerId?: string;
  nickname?: string;
  city?: string;
  avatarUrl?: string;
  soldCount?: number;
  itemCount?: number;
  goodRemarkCount?: number;
  badRemarkCount?: number;
}

export interface XianyuItemDetailVM {
  productId: string;
  itemId?: string;
  categoryId?: string;
  xianyuUpdatedAt?: string;
  title?: string;
  description?: string;
  richTextDescription?: string;
  priceText?: string;
  priceMinor?: number;
  browseCount?: number;
  wantCount?: number;
  collectCount?: number;
  favoriteCount?: number;
  interactFavoriteCount?: number;
  soldCount?: number;
  quantity?: number;
  seller?: XianyuItemSellerVM;
  images: XianyuItemImageVM[];
  detailSyncedAt?: string;
  sourcePayloadDigest?: string;
  cached?: boolean;
  assetUploadErrors?: Array<{ sourceUrl: string; message: string }>;
  /** Optional redacted/normalized source payload for audit inspection. */
  rawPayload?: Record<string, unknown>;
}

export interface XianyuDetailState {
  phase: 'idle' | 'loading' | 'success' | 'error' | 'forbidden';
  loadingMode?: 'read' | 'sync';
  productId?: string;
  data: XianyuItemDetailVM | null;
  error: ProductsLoadError | null;
}
