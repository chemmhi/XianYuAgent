import type { AccountVM } from '../../accounts/types';
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

export function ProductToolbar({ currentAccount, contextLoading, contextError, contextMissing, filters, phase, total, syncing, onKeywordChange, onStatusChange, onRefresh, onSync, onCreate, onChooseAccount }: {
  currentAccount?: AccountVM;
  contextLoading: boolean;
  contextError: string | null;
  contextMissing: boolean;
  filters: ProductFilters;
  phase: ProductsLoadPhase;
  total: number;
  syncing: boolean;
  onKeywordChange: (value: string) => void;
  onStatusChange: (value: ProductStatus | 'all') => void;
  onRefresh: () => void;
  onSync: () => void;
  onCreate: () => void;
  onChooseAccount: () => void;
}) {
  const actionDisabled = contextLoading || contextMissing;
  return <div className="products-toolbar">
    <div><h2>商品目录</h2><p>{contextLoading ? '正在加载账号上下文…' : currentAccount ? `当前账号：${currentAccount.displayName}` : '请先在账号管理选择当前账号'}</p></div>
    <div className="products-toolbar-actions">
      <span className="products-account-context" data-testid="product-account-context">{currentAccount ? currentAccount.displayName : '未选择账号'}</span>
      {contextMissing && <button className="btn ghost" type="button" data-testid="choose-account" onClick={onChooseAccount}>去选择账号</button>}
      {contextError && <span className="products-account-error" role="alert">账号上下文加载失败</span>}
      <label className="products-search"><span className="sr-only">搜索商品</span><input aria-label="搜索商品" value={filters.keyword ?? ''} onChange={(event) => onKeywordChange(event.target.value)} placeholder="搜索商品名称或外部编号" /></label>
      <label><span className="sr-only">商品状态</span><select aria-label="商品状态" value={filters.status ?? 'all'} onChange={(event) => onStatusChange(event.target.value as ProductStatus | 'all')}>{statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>
      <span className="products-total" data-testid="products-total">共 {total} 件</span>
      <button className="btn ghost" type="button" data-testid="refresh-products" onClick={onRefresh} disabled={phase === 'loading' || actionDisabled}>刷新本地</button>
      <button className="btn ghost" type="button" data-testid="sync-products" onClick={onSync} disabled={syncing || actionDisabled}>{syncing ? '同步中…' : '同步闲鱼'}</button>
      <button className="btn primary" type="button" data-testid="publish-product" onClick={onCreate} disabled={actionDisabled}>发布商品</button>
    </div>
  </div>;
}
