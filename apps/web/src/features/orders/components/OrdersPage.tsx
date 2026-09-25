import { useEffect, useMemo, useState } from 'react';
import { useAccountContext } from '../../../app/account-context';
import { createMockOrdersApi, type OrdersApi } from '../api';
import { resolveRuntimeApi } from '../../../api/runtime';
import { hasOrdersContextLoadFailure } from '../context-state';
import { useOrdersController } from '../controller';
import { OrderDetailDrawer } from './OrderDetailDrawer';
import { OrderStateView } from './OrderStateView';
import { OrderSyncToolbar } from './OrderSyncToolbar';
import { OrderTable } from './OrderTable';
import { Toast } from '../../../shared/ui/Toast';
import './orders.css';

export function OrdersPage({ api: providedApi }: { api?: OrdersApi }) {
  const api = useMemo(() => resolveRuntimeApi(providedApi, createMockOrdersApi, 'ORDERS_API_NOT_PROVIDED'), [providedApi]);
  const { currentAccountId, currentAccount, accountsLoading, accountsError, refreshAccounts } = useAccountContext();
  const scopedAccountId = currentAccountId ?? '__no_active_account__';
  const controller = useOrdersController({ api, initialFilters: { accountId: scopedAccountId, sortBy: 'createdAt', sortOrder: 'desc' } });
  const { setFilters } = controller;
  useEffect(() => { setFilters((previous) => previous.accountId === scopedAccountId ? previous : { ...previous, accountId: scopedAccountId, page: 1 }); controller.closeOrder(); }, [controller.closeOrder, scopedAccountId, setFilters]);
  const pageData = controller.state.data;
  const contextMissing = !accountsLoading && !accountsError && !currentAccountId;
  const contextLoadFailure = hasOrdersContextLoadFailure(accountsError, currentAccountId);
  const statePhase = contextLoadFailure ? 'error' : controller.state.phase;
  const stateError = contextLoadFailure
    ? { code: 'UNKNOWN' as const, message: '账号上下文加载失败，请重试。', retryable: true }
    : controller.state.error;
  const retry = contextLoadFailure ? () => void refreshAccounts() : controller.reload;
  const orders = pageData?.items ?? [];
  const [syncToast, setSyncToast] = useState<string | null>(null);
  useEffect(() => {
    if (!controller.syncError) return;
    setSyncToast(controller.syncError.message);
    const timeout = window.setTimeout(() => setSyncToast(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [controller.syncError]);
  return <section className="page-stack orders-domain" data-orders-domain>
    <article className="card panel orders-panel">
      <OrderSyncToolbar currentAccount={currentAccount} contextLoading={accountsLoading} contextMissing={contextMissing} loading={controller.state.phase === 'loading'} syncing={controller.syncing} filters={controller.filters} contextError={accountsError && !contextLoadFailure ? '账号上下文加载失败' : undefined} onFilterChange={(patch) => setFilters((previous) => ({ ...previous, ...patch }))} onRefresh={() => void controller.reload()} onSync={() => void controller.refreshFromXianyu()} />
      {controller.state.phase === 'success' && pageData && <OrderTable orders={orders} page={pageData.page} totalPages={pageData.totalPages} total={pageData.total} onPageChange={(page) => setFilters((previous) => ({ ...previous, page }))} onOpen={controller.openOrder} />}
      <OrderStateView phase={statePhase} error={stateError} onRetry={retry} accountSelectionRequired={contextMissing} onChooseAccount={() => { window.history.pushState({}, '', '/accounts'); window.dispatchEvent(new PopStateEvent('popstate')); }} />
    </article>
    <OrderDetailDrawer order={controller.detail.data} phase={controller.detail.phase} error={controller.detail.error} onClose={controller.closeOrder} onRetry={() => controller.detail.orderNo && void controller.openOrder(controller.detail.orderNo)} />
    {syncToast && <Toast message={syncToast} tone="error" onDismiss={() => setSyncToast(null)} />}
  </section>;
}
