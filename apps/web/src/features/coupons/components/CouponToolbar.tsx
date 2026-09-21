import type { ReactNode } from 'react';
import { SelectField } from '../../../shared/ui/SelectField';
import { SearchField } from '../../../shared/ui/SearchField';
import { Button } from '../../../shared/ui/Button';
import type { CouponBatchFilters, CouponBatchVM, CouponsLoadPhase } from '../types';

const types: Array<{ value: CouponBatchVM['purpose'] | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'text', label: '文本' },
  { value: 'api', label: 'API' },
  { value: 'data', label: '批量数据' },
  { value: 'image', label: '图片' },
];

export function CouponToolbar({ filters, phase, onKeywordChange, onPurposeChange, onCreate, onRefresh, bulkActions, createDisabled = false }: { filters: CouponBatchFilters; phase: CouponsLoadPhase; onKeywordChange: (value: string) => void; onPurposeChange: (value: CouponBatchVM['purpose'] | 'all') => void; onCreate: () => void; onRefresh: () => void; bulkActions?: ReactNode; createDisabled?: boolean }) {
  return <div className="coupons-toolbar">
    <div><h2>卡券列表</h2><p>按卡券名称、描述和类型筛选配置；列表操作与参考卡券页保持一致。</p></div>
    <div className="coupons-toolbar-actions">
      <SearchField className="coupons-search" aria-label="搜索卡券名称或描述" value={filters.keyword ?? ''} onChange={(event) => onKeywordChange(event.target.value)} placeholder="搜索卡券名称或描述..." />
      <SelectField aria-label="卡券类型" className="coupons-purpose-select" value={filters.purpose ?? 'all'} onChange={(event) => onPurposeChange(event.target.value as CouponBatchVM['purpose'] | 'all')} options={types} />
      <Button variant="ghost" type="button" onClick={onRefresh} disabled={phase === 'loading'}>刷新</Button>
      {bulkActions}
      <Button variant="primary" type="button" onClick={onCreate} disabled={createDisabled}>新建卡券</Button>
    </div>
  </div>;
}
