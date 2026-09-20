import type { OrderFilters, OrderVM } from './types';

export type OrderListStatusFilter = 'all' | 'pending_payment' | 'pending_delivery' | 'pending_receipt' | 'pending_review' | 'refunding';
export type OrderDisplayStatus = OrderListStatusFilter | 'processing' | 'failed' | 'completed' | 'closed';

export const orderListStatusOptions: Array<{ value: OrderListStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'pending_payment', label: '待付款' },
  { value: 'pending_delivery', label: '待发货' },
  { value: 'pending_receipt', label: '待收货' },
  { value: 'pending_review', label: '待评价' },
  { value: 'refunding', label: '退款中' },
];

export function filtersForStatus(value: OrderListStatusFilter): Partial<OrderFilters> {
  const base: Partial<OrderFilters> = {
    paymentStatus: 'all',
    orderStatus: 'all',
    deliveryStatus: 'all',
    afterSalesStatus: 'all',
  };
  if (value === 'pending_payment') return { ...base, paymentStatus: 'unpaid' };
  if (value === 'pending_delivery') return { ...base, deliveryStatus: 'pending' };
  if (value === 'pending_receipt') return { ...base, orderStatus: 'open', deliveryStatus: 'delivered' };
  if (value === 'pending_review') return { ...base, orderStatus: 'completed', deliveryStatus: 'delivered' };
  if (value === 'refunding') return { ...base, afterSalesStatus: 'refunding' };
  return base;
}

export function statusFilterFromFilters(filters: Pick<OrderFilters, 'paymentStatus' | 'orderStatus' | 'deliveryStatus' | 'afterSalesStatus'>): OrderListStatusFilter {
  if (filters.paymentStatus === 'unpaid') return 'pending_payment';
  if (filters.deliveryStatus === 'pending') return 'pending_delivery';
  if (filters.deliveryStatus === 'delivered' && filters.orderStatus === 'open') return 'pending_receipt';
  if (filters.orderStatus === 'completed') return 'pending_review';
  if (filters.afterSalesStatus === 'refunding') return 'refunding';
  return 'all';
}

export function getOrderDisplayStatus(order: Pick<OrderVM, 'paymentStatus' | 'orderStatus' | 'deliveryStatus' | 'afterSalesStatus'>): OrderDisplayStatus {
  if (order.paymentStatus === 'unpaid') return 'pending_payment';
  if (order.afterSalesStatus === 'refunding') return 'refunding';
  if (order.deliveryStatus === 'pending') return 'pending_delivery';
  if (order.deliveryStatus === 'delivered' && order.orderStatus === 'open') return 'pending_receipt';
  if (order.deliveryStatus === 'delivered' && order.orderStatus === 'completed') return 'pending_review';
  if (order.deliveryStatus === 'failed' || order.orderStatus === 'failed') return 'failed';
  if (order.orderStatus === 'completed') return 'completed';
  if (order.orderStatus === 'closed' || order.orderStatus === 'cancelled') return 'closed';
  return 'processing';
}

export function orderDisplayStatusLabel(status: OrderDisplayStatus): string {
  const labels: Record<OrderDisplayStatus, string> = {
    all: '全部', pending_payment: '待付款', pending_delivery: '待发货', pending_receipt: '待收货', pending_review: '待评价', refunding: '退款中',
    processing: '处理中', failed: '处理失败', completed: '已完成', closed: '已关闭',
  };
  return labels[status];
}

export function orderDisplayStatusTone(status: OrderDisplayStatus): 'success' | 'warn' | 'danger' | 'neutral' | 'info' {
  if (status === 'pending_payment' || status === 'pending_delivery' || status === 'pending_receipt' || status === 'pending_review' || status === 'refunding') return 'warn';
  if (status === 'failed') return 'danger';
  if (status === 'completed') return 'success';
  if (status === 'closed') return 'neutral';
  return 'info';
}
