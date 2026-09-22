import { useEffect, useMemo, useState } from 'react';
import type { AccountsApi } from '../../accounts/api';
import { useAccountContext } from '../../../app/account-context';
import { createMockProductsApi, type ProductsApi } from '../api';
import { useProductsController } from '../controller';
import { ProductDetailPanel } from './ProductDetailPanel';
import { ProductDrawer } from './ProductDrawer';
import { ProductListStateView } from './ProductStateView';
import { ProductTable } from './ProductTable';
import { ProductToolbar } from './ProductToolbar';
import { XianyuDetailDrawer } from './XianyuDetailDrawer';
import './products.css';

export interface ProductsPageProps { api?: ProductsApi; accountsApi?: AccountsApi; }

export function ProductsPage({ api: providedApi }: ProductsPageProps) {
  const api = useMemo(() => providedApi ?? createMockProductsApi(), [providedApi]);
  const { currentAccountId, currentAccount, accountsLoading, accountsError } = useAccountContext();
  const scopedAccountId = currentAccountId ?? '__no_active_account__';
  const controller = useProductsController({ api, initialFilters: { accountId: scopedAccountId, sortBy: 'xianyuOrder', sortOrder: 'asc' } });
  const [drawer, setDrawer] = useState<{ mode: 'create' | 'edit'; product?: NonNullable<typeof controller.detail.data> } | null>(null);
  const { setFilters } = controller;

  useEffect(() => {
    setFilters((previous) => previous.accountId === scopedAccountId ? previous : { ...previous, accountId: scopedAccountId, page: 1 });
    setDrawer(null);
  }, [scopedAccountId, setFilters]);

  const products = controller.state.data?.items ?? [];
  const pageData = controller.state.data;
  const contextMissing = !accountsLoading && !accountsError && !currentAccountId;

  return (
    <section className="page-stack products-domain" data-products-domain>
      <article className="card panel products-panel">
        <ProductToolbar currentAccount={currentAccount} contextLoading={accountsLoading} contextError={accountsError} contextMissing={contextMissing} filters={controller.filters} phase={controller.state.phase} syncing={controller.mutation.phase === 'saving'} onKeywordChange={controller.setKeyword} onStatusChange={(status) => controller.setFilters((previous) => ({ ...previous, status, page: 1 }))} onRefresh={controller.reload} onSync={() => { if (currentAccountId) void controller.syncFromXianyu(currentAccountId); }} onCreate={() => { if (!currentAccountId) return; controller.clearMutation(); setDrawer({ mode: 'create' }); }} onChooseAccount={() => { window.history.pushState({}, '', '/accounts'); window.dispatchEvent(new PopStateEvent('popstate')); }} />
        {controller.mutation.error && <div className="products-inline-error" role="alert">{controller.mutation.error.message}</div>}
        {controller.state.phase === 'success' && pageData && <ProductTable products={products} page={pageData.page} totalPages={pageData.totalPages} total={pageData.total} sortBy={controller.filters.sortBy ?? 'xianyuOrder'} sortOrder={controller.filters.sortOrder ?? 'asc'} onSortChange={(sortBy, sortOrder) => controller.setFilters((previous) => ({ ...previous, sortBy, sortOrder, page: 1 }))} onPageChange={(page) => controller.setFilters((previous) => ({ ...previous, page }))} onOpen={controller.openProduct} onOpenXianyuDetail={controller.openXianyuDetail} />}
        <ProductListStateView phase={controller.state.phase} error={controller.state.error} onRetry={controller.reload} accountSelectionRequired={contextMissing} />
      </article>
      <ProductDetailPanel state={controller.detail} onClose={controller.closeProduct} onRetry={() => controller.detail.productId && controller.openProduct(controller.detail.productId)} onEdit={(product) => { controller.closeProduct(); controller.clearMutation(); setDrawer({ mode: 'edit', product }); }} />
      <XianyuDetailDrawer state={controller.xianyuDetail} onClose={controller.closeXianyuDetail} onRetry={() => controller.xianyuDetail.productId && controller.openXianyuDetail(controller.xianyuDetail.productId)} onSync={() => controller.xianyuDetail.productId && controller.syncXianyuDetail(controller.xianyuDetail.productId)} />
      {drawer && <ProductDrawer mode={drawer.mode} accountId={currentAccountId} product={drawer.product} error={controller.mutation.error} saving={controller.mutation.phase === 'saving'} onClose={() => setDrawer(null)} onCreate={async (values) => Boolean(await controller.createDraft(values))} onUpdate={async (productId, patch, configVersion) => Boolean(await controller.updateDraft(productId, patch, configVersion))} />}
      {accountsError && <div className="products-inline-error" role="alert">账号上下文加载失败：{accountsError}</div>}
    </section>
  );
}
