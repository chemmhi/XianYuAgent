import type { CouponBatchFilters, CouponBatchVM, CouponsLoadPhase } from '../types';

const types: Array<{ value: CouponBatchVM['purpose'] | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'text', label: '文本' },
  { value: 'api', label: 'API' },
  { value: 'data', label: '批量数据' },
  { value: 'image', label: '图片' },
];

export function CouponToolbar({ filters, phase, total, onKeywordChange, onPurposeChange, onSearch, onReset }: { filters: CouponBatchFilters; phase: CouponsLoadPhase; total: number; onKeywordChange: (value: string) => void; onPurposeChange: (value: CouponBatchVM['purpose'] | 'all') => void; onSearch: () => void; onReset: () => void }) {
  return <div className="coupons-toolbar">
    <div><h2>卡券列表</h2><p>按卡券名称、描述和类型筛选配置；列表操作与参考卡券页保持一致。</p></div>
    <div className="coupons-toolbar-actions">
      <label className="coupons-search"><span className="sr-only">搜索卡券</span><input aria-label="搜索卡券名称或描述" value={filters.keyword ?? ''} onChange={(event) => onKeywordChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSearch(); }} placeholder="搜索卡券名称或描述..." /></label>
      <label><span className="sr-only">卡券类型</span><select aria-label="卡券类型" value={filters.purpose ?? 'all'} onChange={(event) => onPurposeChange(event.target.value as CouponBatchVM['purpose'] | 'all')}>{types.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
      <button className="btn primary" type="button" onClick={onSearch} disabled={phase === 'loading'}>查询</button>
      <button className="btn ghost" type="button" onClick={onReset}>重置筛选</button>
      <span className="coupons-total">共 {total} 张</span>
    </div>
  </div>;
}
