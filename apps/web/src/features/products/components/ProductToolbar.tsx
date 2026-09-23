import type { AccountVM } from '../../accounts/types';
import { SelectField } from '../../../shared/ui/SelectField';
import { SearchField } from '../../../shared/ui/SearchField';
import { Button } from '../../../shared/ui/Button';
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

export function ProductToolbar({ currentAccount, contextLoading, contextError, contextMissing, filters, phase, syncing, selectedCount = 0, onKeywordChange, onStatusChange, onRefresh, onSync, onCreate, onChooseAccount, onBatchConfigure }: {
  currentAccount?: AccountVM;
  contextLoading: boolean;
  contextError: string | null;
  contextMissing: boolean;
  filters: ProductFilters;
  phase: ProductsLoadPhase;
  syncing: boolean;
  selectedCount?: number;
  onKeywordChange: (value: string) => void;
  onStatusChange: (value: ProductStatus | 'all') => void;
  onRefresh: () => void;
  onSync: () => void;
  onCreate: () => void;
  onChooseAccount: () => void;
  onBatchConfigure?: () => void;
}) {
  const actionDisabled = contextLoading || contextMissing;
  return <div className="products-toolbar">
    <div><h2>商品目录</h2><p>{contextLoading ? '正在加载账号上下文…' : currentAccount ? `当前账号：${currentAccount.displayName} · 勾选商品后可批量配置自动化规则` : '请先在账号管理选择当前账号'}</p></div>
    <div className="products-toolbar-actions">
      {contextMissing && <Button variant="ghost" type="button" data-testid="choose-account" onClick={onChooseAccount}>去选择账号</Button>}
      {contextError && <span className="products-account-error" role="alert">账号上下文加载失败</span>}
      <SearchField className="products-search" aria-label="搜索商品" value={filters.keyword ?? ''} onChange={(event) => onKeywordChange(event.target.value)} onClear={() => onKeywordChange('')} clearable placeholder="搜索商品名称或外部编号" />
      <SelectField aria-label="商品状态" className="products-status-select" value={filters.status ?? 'all'} onChange={(event) => onStatusChange(event.target.value as ProductStatus | 'all')} options={statuses} />
      {onBatchConfigure && <Button variant="ghost" className="products-batch-button" type="button" data-testid="batch-automation" onClick={onBatchConfigure} disabled={actionDisabled || selectedCount === 0}>批量配置自动化{selectedCount > 0 ? ` ${selectedCount}件` : ''}</Button>}
      <Button variant="ghost" type="button" data-testid="refresh-products" onClick={onRefresh} disabled={phase === 'loading' || actionDisabled}>刷新本地</Button>
      <Button variant="ghost" type="button" data-testid="sync-products" onClick={onSync} disabled={syncing || actionDisabled}>{syncing ? '同步中…' : '同步闲鱼'}</Button>
      <Button variant="primary" type="button" data-testid="publish-product" onClick={onCreate} disabled={actionDisabled}>发布商品</Button>
    </div>
  </div>;
}
