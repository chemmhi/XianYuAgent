import type { AccountVM } from '../../accounts/types';

export function OrderSyncToolbar({ currentAccount, contextLoading, contextMissing, loading, onRefresh, onSync }: { currentAccount?: AccountVM; contextLoading: boolean; contextMissing: boolean; loading: boolean; onRefresh: () => void; onSync: () => void }) {
  return <div className="orders-toolbar"><div><h2>订单列表</h2><p>{contextLoading ? '正在加载账号上下文…' : currentAccount ? `当前账号：${currentAccount.displayName} · 支持按订单号、买家和商品搜索` : '请先在账号管理选择当前账号'}</p></div><div className="orders-toolbar-actions"><button className="btn ghost" type="button" data-testid="refresh-orders" onClick={onRefresh} disabled={loading || contextMissing}>刷新本地</button><button className="btn ghost" type="button" data-testid="sync-orders" onClick={onSync} disabled={loading || contextMissing}>刷新闲鱼订单</button></div></div>;
}

