import type { ProductFilters, ProductStatus, ProductsLoadPhase } from '../types';

const statuses: Array<{ value: ProductStatus | 'all'; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'published', label: '已发布' },
  { value: 'ready', label: '待发布' },
  { value: 'draft', label: '草稿' },
  { value: 'publishing', label: '发布中' },
  { value: 'failed', label: '发布失败' },
  { value: 'archived', label: '已归档' },
];

export function ProductToolbar({ filters, phase, total, syncing, onKeywordChange, onStatusChange, onRefresh, onSync, onCreate }: {
  filters: ProductFilters;
  phase: ProductsLoadPhase;
  total: number;
  syncing: boolean;
  onKeywordChange: (value: string) => void;
  onStatusChange: (value: ProductStatus | 'all') => void;
  onRefresh: () => void;
  onSync: () => void;
  onCreate: () => void;
}) {
  return <div className="products-toolbar">
    <div><h2>商品目录</h2><p>当前账号范围内的商品与发布状态</p></div>
    <div className="products-toolbar-actions">
      <label className="products-search"><span className="sr-only">搜索商品</span><input aria-label="搜索商品" value={filters.keyword ?? ''} onChange={(event) => onKeywordChange(event.target.value)} placeholder="搜索商品名称或外部编号" /></label>
      <label><span className="sr-only">商品状态</span><select aria-label="商品状态" value={filters.status ?? 'all'} onChange={(event) => onStatusChange(event.target.value as ProductStatus | 'all')}>{statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>
      <span className="products-total">共 {total} 件</span>
      <button className="btn ghost" type="button" onClick={onRefresh} disabled={phase === 'loading'}>刷新</button>
      <button className="btn ghost" type="button" data-testid="sync-products" onClick={onSync} disabled={syncing || !filters.accountId}>{syncing ? '同步中…' : '从闲鱼同步'}</button>
      <button className="btn primary" type="button" onClick={onCreate}>新建商品</button>
    </div>
  </div>;
}
