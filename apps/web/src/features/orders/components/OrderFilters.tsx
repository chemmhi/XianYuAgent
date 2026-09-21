import type { OrderFilters as OrderFiltersVM } from '../types';
import { SelectField } from '../../../shared/ui/SelectField';
import { SearchField } from '../../../shared/ui/SearchField';
import { filtersForStatus, orderListStatusOptions, statusFilterFromFilters } from '../order-status';

export function OrderFilters({ filters, onChange }: { filters: OrderFiltersVM; onChange: (patch: Partial<OrderFiltersVM>) => void }) {
  return <div className="orders-filter-row" aria-label="订单筛选条件">
    <SearchField className="orders-search" aria-label="搜索订单" value={filters.keyword ?? ''} onChange={(event) => onChange({ keyword: event.target.value, page: 1 })} onClear={() => onChange({ keyword: '', page: 1 })} clearable placeholder="搜索订单号、买家或商品" />
    <SelectField aria-label="订单状态" className="orders-status-select" value={statusFilterFromFilters(filters)} onChange={(event) => onChange({ ...filtersForStatus(event.target.value as Parameters<typeof filtersForStatus>[0]), page: 1 })} options={orderListStatusOptions} />
  </div>;
}
