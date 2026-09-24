import type { AccountVM } from '../../accounts/types';
import type { OrderFilters as OrderFiltersVM } from '../types';
import { OrderFilters } from './OrderFilters';

export function OrderSyncToolbar({ currentAccount, contextLoading, contextMissing, loading, syncing, filters, contextError, onFilterChange, onRefresh, onSync }: { currentAccount?: AccountVM; contextLoading: boolean; contextMissing: boolean; loading: boolean; syncing: boolean; filters: OrderFiltersVM; contextError?: string; onFilterChange: (patch: Partial<OrderFiltersVM>) => void; onRefresh: () => void; onSync: () => void }) {
  return <div className="orders-toolbar"><div><h2>订单列表</h2><p>{contextLoading ? '正在加载账号上下文…' : currentAccount ? `当前账号：${currentAccount.displayName} · 支持按订单号、买家和商品搜索` : '请先在账号管理选择当前账号'}</p></div><div className="orders-toolbar-actions"><OrderFilters filters={filters} onChange={onFilterChange} />{contextError && <span className="orders-context-error" role="alert">{contextError}</span>}<button className="btn ghost" type="button" data-testid="refresh-orders" onClick={onRefresh} disabled={loading || syncing || contextMissing}>刷新</button><button className="btn ghost" type="button" data-testid="sync-orders" onClick={onSync} disabled={loading || syncing || contextMissing}>{syncing ? '同步中…' : '同步闲鱼'}</button></div></div>;
}

