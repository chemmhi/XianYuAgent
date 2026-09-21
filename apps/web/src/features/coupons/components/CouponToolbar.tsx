import type { ReactNode } from 'react';
import { SelectField } from '../../../shared/ui/SelectField';
import { SearchField } from '../../../shared/ui/SearchField';
import { Button } from '../../../shared/ui/Button';
import type { CouponBatchFilters, CouponBatchStatus, CouponBatchVM, CouponsLoadPhase, StockAlert } from '../types';

const types: Array<{ value: CouponBatchVM['purpose'] | 'all'; label: string }> = [
  { value: 'all', label: '全部类型' },
  { value: 'text', label: '文本' },
  { value: 'api', label: 'API' },
  { value: 'data', label: '批量数据' },
  { value: 'image', label: '图片' },
];

const statuses: Array<{ value: CouponBatchStatus | 'all'; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'draft', label: '草稿' },
  { value: 'active', label: '启用' },
  { value: 'paused', label: '禁用' },
  { value: 'closed', label: '已关闭' },
  { value: 'exhausted', label: '已耗尽' },
  { value: 'voided', label: '已删除' },
];

const stockAlerts: Array<{ value: StockAlert | 'all'; label: string }> = [
  { value: 'all', label: '全部库存' },
  { value: 'normal', label: '库存正常' },
  { value: 'low_stock', label: '库存偏低' },
  { value: 'exhausted', label: '库存耗尽' },
];

export function CouponToolbar({ filters, phase, onKeywordChange, onPurposeChange, onStatusChange, onStockAlertChange, onCreate, onRefresh, bulkActions, createDisabled = false }: { filters: CouponBatchFilters; phase: CouponsLoadPhase; onKeywordChange: (value: string) => void; onPurposeChange: (value: CouponBatchVM['purpose'] | 'all') => void; onStatusChange: (value: CouponBatchStatus | 'all') => void; onStockAlertChange: (value: StockAlert | 'all') => void; onCreate: () => void; onRefresh: () => void; bulkActions?: ReactNode; createDisabled?: boolean }) {
  return <div className="coupons-toolbar">
    <div><h2>卡券列表</h2><p>按卡券名称、描述、类型、状态和库存预警筛选配置；列表操作与参考卡券页保持一致。</p></div>
    <div className="coupons-toolbar-actions">
      <SearchField className="coupons-search" data-coupons-search="true" aria-label="搜索卡券名称或描述" value={filters.keyword ?? ''} onChange={(event) => onKeywordChange(event.target.value)} clearable={Boolean(filters.keyword)} onClear={() => onKeywordChange('')} placeholder="搜索卡券名称或描述" />
      <SelectField aria-label="卡券类型" data-coupons-purpose-filter="true" className="coupons-purpose-select" value={filters.purpose ?? 'all'} onChange={(event) => onPurposeChange(event.target.value as CouponBatchVM['purpose'] | 'all')} options={types} />
      <SelectField aria-label="卡券状态" data-coupons-status-filter="true" className="coupons-status-select" value={filters.status ?? 'all'} onChange={(event) => onStatusChange(event.target.value as CouponBatchStatus | 'all')} options={statuses} />
      <SelectField aria-label="库存预警" data-coupons-stock-filter="true" className="coupons-stock-alert-select" value={filters.stockAlert ?? 'all'} onChange={(event) => onStockAlertChange(event.target.value as StockAlert | 'all')} options={stockAlerts} />
      <Button variant="ghost" type="button" onClick={onRefresh} disabled={phase === 'loading'}>刷新</Button>
      {bulkActions}
      <Button variant="primary" className="coupons-create-button" type="button" onClick={onCreate} disabled={createDisabled}>新建卡券</Button>
    </div>
  </div>;
}
