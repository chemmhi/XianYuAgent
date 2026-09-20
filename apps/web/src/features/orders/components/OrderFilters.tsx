import type { AfterSalesStatus, DeliveryStatus, OrderFilters as OrderFiltersVM, OrderStatus, PaymentStatus } from '../types';

const paymentOptions: Array<{ value: PaymentStatus | 'all'; label: string }> = [
  { value: 'all', label: '支付状态：全部' }, { value: 'unpaid', label: '待付款' }, { value: 'paid', label: '已付款' }, { value: 'closed', label: '已关闭' }, { value: 'unknown', label: '未知' },
];
const orderOptions: Array<{ value: OrderStatus | 'all'; label: string }> = [
  { value: 'all', label: '订单状态：全部' }, { value: 'open', label: '进行中' }, { value: 'completed', label: '已完成' }, { value: 'closed', label: '已关闭' }, { value: 'cancelled', label: '已取消' }, { value: 'failed', label: '处理失败' },
];
const deliveryOptions: Array<{ value: DeliveryStatus | 'all'; label: string }> = [
  { value: 'all', label: '发货状态：全部' }, { value: 'pending', label: '待发货' }, { value: 'reserving', label: '锁库存' }, { value: 'delivered', label: '已发货' }, { value: 'partially_delivered', label: '部分发货' }, { value: 'failed', label: '发货失败' }, { value: 'cancelled', label: '未发货' },
];
const afterSalesOptions: Array<{ value: AfterSalesStatus | 'all'; label: string }> = [
  { value: 'all', label: '售后状态：全部' }, { value: 'none', label: '无售后' }, { value: 'requested', label: '售后申请' }, { value: 'refunding', label: '退款中' }, { value: 'refunded', label: '已退款' }, { value: 'closed', label: '售后关闭' },
];

export function OrderFilters({ filters, onChange }: { filters: OrderFiltersVM; onChange: (patch: Partial<OrderFiltersVM>) => void }) {
  return <div className="orders-filter-row" aria-label="订单筛选条件">
    <label className="orders-search"><span className="sr-only">搜索订单</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 20-4.2-4.2m1.2-5.3a6.5 6.5 0 1 1-13 0a6.5 6.5 0 0 1 13 0Z" /></svg><input aria-label="搜索订单" value={filters.keyword ?? ''} onChange={(event) => onChange({ keyword: event.target.value, page: 1 })} placeholder="订单号、买家或商品" /></label>
    <label><span className="sr-only">支付状态</span><select aria-label="支付状态" value={filters.paymentStatus ?? 'all'} onChange={(event) => onChange({ paymentStatus: event.target.value as PaymentStatus | 'all', page: 1 })}>{paymentOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
    <label><span className="sr-only">订单状态</span><select aria-label="订单状态" value={filters.orderStatus ?? 'all'} onChange={(event) => onChange({ orderStatus: event.target.value as OrderStatus | 'all', page: 1 })}>{orderOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
    <label><span className="sr-only">发货状态</span><select aria-label="发货状态" value={filters.deliveryStatus ?? 'all'} onChange={(event) => onChange({ deliveryStatus: event.target.value as DeliveryStatus | 'all', page: 1 })}>{deliveryOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
    <label><span className="sr-only">售后状态</span><select aria-label="售后状态" value={filters.afterSalesStatus ?? 'all'} onChange={(event) => onChange({ afterSalesStatus: event.target.value as AfterSalesStatus | 'all', page: 1 })}>{afterSalesOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
  </div>;
}

