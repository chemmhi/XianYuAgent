import { useEffect, useMemo } from 'react';
import { useAccountContext } from '../../../app/account-context';
import { createMockOrdersApi, type OrdersApi } from '../api';
import { useOrdersController } from '../controller';
import { OrderDetailDrawer } from './OrderDetailDrawer';
import { OrderFilters } from './OrderFilters';
import { OrderStateView } from './OrderStateView';
import { OrderSyncToolbar } from './OrderSyncToolbar';
import { OrderTable } from './OrderTable';
import './orders.css';

export function OrdersPage({ api: providedApi }: { api?: OrdersApi }) {
  const api = useMemo(() => providedApi ?? createMockOrdersApi(), [providedApi]);
  const { currentAccountId, currentAccount, accountsLoading, accountsError } = useAccountContext();
  const scopedAccountId = currentAccountId ?? '__no_active_account__';
  const controller = useOrdersController({ api, initialFilters: { accountId: scopedAccountId, sortBy: 'createdAt', sortOrder: 'desc' } });
  const { setFilters } = controller;
  useEffect(() => { setFilters((previous) => previous.accountId === scopedAccountId ? previous : { ...previous, accountId: scopedAccountId, page: 1 }); controller.closeOrder(); }, [controller.closeOrder, scopedAccountId, setFilters]);
  const pageData = controller.state.data;
  const contextMissing = !accountsLoading && !accountsError && !currentAccountId;
  const orders = pageData?.items ?? [];
  return <section className="page-stack orders-domain" data-orders-domain>
    <div className="orders-page-title"><div><p className="eyebrow">Order Center</p><h1>订单管理</h1><p>查询订单、查看支付与发货状态；订单写动作仍由 Outbox 幂等执行。</p></div><span className="orders-page-badge">{pageData ? `共 ${pageData.total} 单` : '订单中心'}</span></div>
    <article className="card panel orders-panel">
      <OrderSyncToolbar currentAccount={currentAccount} contextLoading={accountsLoading} contextMissing={contextMissing} loading={controller.state.phase === 'loading'} onRefresh={() => void controller.reload()} onSync={() => void controller.refreshFromXianyu()} />
      <div className="orders-filters-wrap"><OrderFilters filters={controller.filters} onChange={(patch) => setFilters((previous) => ({ ...previous, ...patch }))} />{accountsError && <span className="orders-context-error" role="alert">账号上下文加载失败</span>}</div>
      {controller.state.phase === 'success' && pageData && <OrderTable orders={orders} page={pageData.page} totalPages={pageData.totalPages} total={pageData.total} onPageChange={(page) => setFilters((previous) => ({ ...previous, page }))} onOpen={controller.openOrder} />}
      <OrderStateView phase={controller.state.phase} error={controller.state.error} onRetry={controller.reload} accountSelectionRequired={contextMissing} onChooseAccount={() => { window.history.pushState({}, '', '/accounts'); window.dispatchEvent(new PopStateEvent('popstate')); }} />
    </article>
    <OrderDetailDrawer order={controller.detail.data} phase={controller.detail.phase} error={controller.detail.error} onClose={controller.closeOrder} onRetry={() => controller.detail.orderNo && void controller.openOrder(controller.detail.orderNo)} />
  </section>;
}
