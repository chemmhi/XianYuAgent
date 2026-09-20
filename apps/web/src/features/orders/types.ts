export type PaymentStatus = 'unpaid' | 'paid' | 'closed' | 'unknown';
export type OrderStatus = 'open' | 'cancelling' | 'cancelled' | 'completed' | 'closed' | 'failed';
export type DeliveryStatus = 'pending' | 'reserving' | 'delivered' | 'partially_delivered' | 'failed' | 'cancelled';
export type AfterSalesStatus = 'none' | 'requested' | 'refunding' | 'refunded' | 'rejected' | 'closed';

export interface OrderVM {
  orderNo: string;
  accountId: string;
  accountName?: string;
  buyerId: string;
  buyerName: string;
  buyerNickname?: string;
  buyerAvatarUrl?: string;
  itemId: string;
  itemTitle: string;
  itemImageUrl?: string;
  amountMinor: number;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  deliveryStatus: DeliveryStatus;
  afterSalesStatus: AfterSalesStatus;
  deliveryType: 'manual' | 'no_logistics' | 'coupon_only' | 'mixed';
  createdAt: string;
  updatedAt?: string;
  deliveryFailReason?: string;
  conversationId?: string;
  productId?: string;
  configVersion: number;
}

export interface OrderFilters {
  accountId?: string;
  keyword?: string;
  paymentStatus?: PaymentStatus | 'all';
  orderStatus?: OrderStatus | 'all';
  deliveryStatus?: DeliveryStatus | 'all';
  afterSalesStatus?: AfterSalesStatus | 'all';
  sortBy?: 'createdAt' | 'amountMinor';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface OrdersPageVM {
  items: OrderVM[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type OrdersLoadPhase = 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'forbidden';

export interface OrdersLoadError {
  code: 'FORBIDDEN' | 'NOT_FOUND' | 'NETWORK_ERROR' | 'UNKNOWN';
  message: string;
  retryable: boolean;
}

export interface OrderQueryState {
  phase: OrdersLoadPhase;
  data: OrdersPageVM | null;
  error: OrdersLoadError | null;
}

export interface OrderDetailState {
  phase: 'idle' | 'loading' | 'success' | 'error' | 'forbidden';
  orderNo?: string;
  data: OrderVM | null;
  error: OrdersLoadError | null;
}

