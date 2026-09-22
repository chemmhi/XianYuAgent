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
import { buildAccountsReauthorizePath } from '../../accounts/reauthorize-intent';
import { createMockProductAutomationApi, type ProductAutomationApi } from '../../product-automation/api';
import { useProductAutomationController } from '../../product-automation/controller';
import { AutomationDrawer } from '../../product-automation/components/AutomationDrawer';
import { BatchAutomationDialog } from '../../product-automation/components/BatchAutomationDialog';
import './products.css';
import '../../product-automation/product-automation.css';

export interface ProductsPageProps { api?: ProductsApi; accountsApi?: AccountsApi; automationApi?: ProductAutomationApi; }

export function ProductsPage({ api: providedApi, automationApi: providedAutomationApi }: ProductsPageProps) {
  const api = useMemo(() => providedApi ?? createMockProductsApi(), [providedApi]);
  const automationApi = useMemo(() => providedAutomationApi ?? createMockProductAutomationApi(), [providedAutomationApi]);
  const { currentAccountId, currentAccount, accountsLoading, accountsError } = useAccountContext();
  const scopedAccountId = currentAccountId ?? '__no_active_account__';
  const controller = useProductsController({ api, initialFilters: { accountId: scopedAccountId, sortBy: 'xianyuOrder', sortOrder: 'asc' } });
  const [drawer, setDrawer] = useState<{ mode: 'create' | 'edit'; product?: NonNullable<typeof controller.detail.data> } | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [automationProductId, setAutomationProductId] = useState<string | undefined>();
  const [batchOpen, setBatchOpen] = useState(false);
  const [automationNotice, setAutomationNotice] = useState<string | null>(null);
  const [automationSummaries, setAutomationSummaries] = useState<Record<string, { label: string; detail: string; tone: 'ok' | 'warn' | 'muted' }>>({});
  const { setFilters } = controller;
  const automationController = useProductAutomationController({ api: automationApi, accountId: currentAccountId ?? undefined, productId: automationProductId });

  useEffect(() => {
    setFilters((previous) => previous.accountId === scopedAccountId ? previous : { ...previous, accountId: scopedAccountId, page: 1 });
    setDrawer(null);
    setAutomationProductId(undefined);
    setSelectedProductIds([]);
  }, [scopedAccountId, setFilters]);

  const products = controller.state.data?.items ?? [];
  const pageData = controller.state.data;
  const contextMissing = !accountsLoading && !accountsError && !currentAccountId;

  useEffect(() => {
    let cancelled = false;
    if (!currentAccountId || products.length === 0) {
      setAutomationSummaries({});
      return () => { cancelled = true; };
    }
    void Promise.all(products.map(async (product) => {
      try {
        const config = await automationApi.getConfig(product.id);
        const enabled = [config.delivery, config.reprice, config.gift, config.review].filter((rule) => rule.enabled).length;
        const detail = `${config.delivery.enabled ? '发货 ✓' : '发货 —'}　${config.reprice.enabled ? '改价 ✓' : '改价 —'}　${config.gift.enabled ? '赠品 ✓' : '赠品 —'}　${config.review.enabled ? `求评 ${config.review.reviewInitialHours ?? 72}h/${config.review.reviewMaxCount ?? 1}次` : '求评 —'}`;
        return [product.id, { label: enabled ? `${enabled}/4 已启用` : '未配置', detail, tone: enabled > 0 ? 'ok' : 'muted' }] as const;
      } catch {
        return [product.id, { label: '读取失败', detail: '自动化配置暂不可用', tone: 'warn' }] as const;
      }
    })).then((entries) => { if (!cancelled) setAutomationSummaries(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [automationApi, currentAccountId, products]);

  return (
    <section className="page-stack products-domain" data-products-domain>
      <article className="card panel products-panel">
        <ProductToolbar currentAccount={currentAccount} contextLoading={accountsLoading} contextError={accountsError} contextMissing={contextMissing} filters={controller.filters} phase={controller.state.phase} syncing={controller.mutation.phase === 'saving'} selectedCount={selectedProductIds.length} onKeywordChange={controller.setKeyword} onStatusChange={(status) => controller.setFilters((previous) => ({ ...previous, status, page: 1 }))} onRefresh={controller.reload} onSync={() => { if (currentAccountId) void controller.syncFromXianyu(currentAccountId); }} onCreate={() => { if (!currentAccountId) return; controller.clearMutation(); setDrawer({ mode: 'create' }); }} onChooseAccount={() => { window.history.pushState({}, '', buildAccountsReauthorizePath()); window.dispatchEvent(new PopStateEvent('popstate')); }} onBatchConfigure={() => setBatchOpen(true)} />
        {controller.mutation.error && <div className="products-inline-error" role="alert">{controller.mutation.error.message}</div>}
        {controller.state.phase === 'success' && pageData && <ProductTable products={products} page={pageData.page} totalPages={pageData.totalPages} total={pageData.total} sortBy={controller.filters.sortBy ?? 'xianyuOrder'} sortOrder={controller.filters.sortOrder ?? 'asc'} onSortChange={(sortBy, sortOrder) => controller.setFilters((previous) => ({ ...previous, sortBy, sortOrder, page: 1 }))} onPageChange={(page) => controller.setFilters((previous) => ({ ...previous, page }))} onOpen={controller.openProduct} onOpenXianyuDetail={controller.openXianyuDetail} selectedIds={selectedProductIds} onToggleSelected={(productId) => setSelectedProductIds((previous) => previous.includes(productId) ? previous.filter((id) => id !== productId) : [...previous, productId])} onToggleAll={(checked) => setSelectedProductIds(checked ? products.map((product) => product.id) : [])} onOpenAutomation={(productId) => { setAutomationNotice(null); setAutomationProductId(productId); }} automationSummary={(product) => automationSummaries[product.id] ?? { label: '读取中…', detail: '正在读取规则', tone: 'muted' }} />}
        <ProductListStateView phase={controller.state.phase} error={controller.state.error} onRetry={controller.reload} accountSelectionRequired={contextMissing} />
      </article>
      <ProductDetailPanel state={controller.detail} onClose={controller.closeProduct} onRetry={() => controller.detail.productId && controller.openProduct(controller.detail.productId)} onEdit={(product) => { controller.closeProduct(); controller.clearMutation(); setDrawer({ mode: 'edit', product }); }} />
      <XianyuDetailDrawer state={controller.xianyuDetail} onClose={controller.closeXianyuDetail} onRetry={() => controller.xianyuDetail.productId && controller.openXianyuDetail(controller.xianyuDetail.productId)} onSync={() => controller.xianyuDetail.productId && controller.syncXianyuDetail(controller.xianyuDetail.productId)} onChooseAccount={() => { window.history.pushState({}, '', buildAccountsReauthorizePath(currentAccountId)); window.dispatchEvent(new PopStateEvent('popstate')); }} />
      {drawer && <ProductDrawer mode={drawer.mode} accountId={currentAccountId} product={drawer.product} error={controller.mutation.error} saving={controller.mutation.phase === 'saving'} onClose={() => setDrawer(null)} onCreate={async (values) => Boolean(await controller.createDraft(values))} onUpdate={async (productId, patch, configVersion) => Boolean(await controller.updateDraft(productId, patch, configVersion))} />}
      {automationNotice && <div className="automation-toast" role="status">{automationNotice}</div>}
      <AutomationDrawer open={Boolean(automationProductId)} product={products.find((product) => product.id === automationProductId) ?? null} accountLabel={currentAccount?.displayName ?? '当前账号'} config={automationController.config} coupons={automationController.coupons} loadPhase={automationController.loadPhase} savePhase={automationController.savePhase} error={automationController.error} onClose={() => setAutomationProductId(undefined)} onSave={async (input) => { const result = await automationController.save(input); if (result) { setAutomationNotice('商品自动化配置已保存'); setAutomationProductId(undefined); } return result; }} />
      <BatchAutomationDialog open={batchOpen} productIds={selectedProductIds} error={automationController.error} onCancel={() => setBatchOpen(false)} onSave={async (input) => { const result = await automationController.saveBatch(input); if (result) { setAutomationNotice(`已保存 ${result.updatedCount} 件商品的自动化规则`); setBatchOpen(false); setSelectedProductIds([]); } return result; }} />
      {accountsError && <div className="products-inline-error" role="alert">账号上下文加载失败：{accountsError}</div>}
    </section>
  );
}
