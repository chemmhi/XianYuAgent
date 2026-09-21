import type { OrderFilters as OrderFiltersVM } from '../types';
import { SelectField } from '../../../shared/ui/SelectField';
import { filtersForStatus, orderListStatusOptions, statusFilterFromFilters } from '../order-status';

export function OrderFilters({ filters, onChange }: { filters: OrderFiltersVM; onChange: (patch: Partial<OrderFiltersVM>) => void }) {
  return <div className="orders-filter-row" aria-label="订单筛选条件">
    <label className="orders-search"><span className="sr-only">搜索订单</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 20-4.2-4.2m1.2-5.3a6.5 6.5 0 1 1-13 0Z" /></svg><input aria-label="搜索订单" value={filters.keyword ?? ''} onChange={(event) => onChange({ keyword: event.target.value, page: 1 })} placeholder="订单号、买家昵称或商品名称" /></label>
    <SelectField aria-label="订单状态" className="orders-status-select" value={statusFilterFromFilters(filters)} onChange={(event) => onChange({ ...filtersForStatus(event.target.value as Parameters<typeof filtersForStatus>[0]), page: 1 })} options={orderListStatusOptions} />
  </div>;
}
