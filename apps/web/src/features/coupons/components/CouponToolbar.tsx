import type { CouponBatchFilters, CouponBatchStatus, CouponsLoadPhase, StockAlert } from '../types';

const statuses: Array<{ value: CouponBatchStatus | 'all'; label: string }> = [
  { value: 'all', label: '全部状态' }, { value: 'active', label: '启用中' }, { value: 'draft', label: '草稿' }, { value: 'paused', label: '已暂停' }, { value: 'closed', label: '已关闭' }, { value: 'exhausted', label: '已耗尽' }, { value: 'voided', label: '已作废' },
];
const alerts: Array<{ value: StockAlert | 'all'; label: string }> = [
  { value: 'all', label: '全部库存' }, { value: 'normal', label: '库存正常' }, { value: 'low_stock', label: '低库存' }, { value: 'exhausted', label: '已耗尽' },
];

export function CouponToolbar({ filters, phase, total, onKeywordChange, onStatusChange, onAlertChange, onRefresh, onCreate }: { filters: CouponBatchFilters; phase: CouponsLoadPhase; total: number; onKeywordChange: (value: string) => void; onStatusChange: (value: CouponBatchStatus | 'all') => void; onAlertChange: (value: StockAlert | 'all') => void; onRefresh: () => void; onCreate: () => void }) {
  return <div className="coupons-toolbar">
    <div><h2>卡券批次</h2><p>按当前账号范围管理库存、绑定关系与受控正文预览。</p></div>
    <div className="coupons-toolbar-actions">
      <label className="coupons-search"><span className="sr-only">搜索卡券批次</span><input aria-label="搜索卡券批次" value={filters.keyword ?? ''} onChange={(event) => onKeywordChange(event.target.value)} placeholder="搜索批次名称或编号" /></label>
      <label><span className="sr-only">批次状态</span><select aria-label="批次状态" value={filters.status ?? 'all'} onChange={(event) => onStatusChange(event.target.value as CouponBatchStatus | 'all')}>{statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>
      <label><span className="sr-only">库存告警</span><select aria-label="库存告警" value={filters.stockAlert ?? 'all'} onChange={(event) => onAlertChange(event.target.value as StockAlert | 'all')}>{alerts.map((alert) => <option key={alert.value} value={alert.value}>{alert.label}</option>)}</select></label>
      <span className="coupons-total">共 {total} 批</span>
      <button className="btn ghost" type="button" onClick={onRefresh} disabled={phase === 'loading'}>刷新</button>
      <button className="btn primary" type="button" onClick={onCreate}>新建批次</button>
    </div>
  </div>;
}
