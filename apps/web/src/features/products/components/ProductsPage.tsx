import { useMemo } from 'react';
import { createMockProductsApi, type ProductsApi } from '../api';
import { useProductsController } from '../controller';
import { ProductDetailPanel } from './ProductDetailPanel';
import { ProductListStateView } from './ProductStateView';
import { ProductTable } from './ProductTable';
import { ProductToolbar } from './ProductToolbar';
import './products.css';

export interface ProductsPageProps { api?: ProductsApi; }

export function ProductsPage({ api: providedApi }: ProductsPageProps) {
  const api = useMemo(() => providedApi ?? createMockProductsApi(), [providedApi]);
  const controller = useProductsController({ api });
  const products = controller.state.data?.items ?? [];
  const total = controller.state.data?.total ?? 0;
  const published = products.filter((product) => product.status === 'published').length;
  const drafts = products.filter((product) => product.status === 'draft').length;

  return (
    <section className="page-stack products-domain" data-products-domain>
      <div className="page-title">
        <div>
          <p className="eyebrow">Product Catalog</p>
          <h1>商品管理</h1>
          <p>按账号范围查看商品、草稿和发布状态；详情读取独立走商品 API。</p>
        </div>
        <div className="page-title-actions"><span className="products-domain-scope">管理员商品范围</span></div>
      </div>
      <div className="kpi-grid three products-kpis">
        <article className="card kpi-card"><div className="kpi-label">商品总数</div><div className="kpi-value">{total}</div><div className="kpi-delta"><span className="tone-info">当前筛选结果</span></div></article>
        <article className="card kpi-card"><div className="kpi-label">已发布</div><div className="kpi-value">{published}</div><div className="kpi-delta"><span className="tone-ok">可继续进入发布校验</span></div></article>
        <article className="card kpi-card"><div className="kpi-label">草稿</div><div className="kpi-value">{drafts}</div><div className="kpi-delta"><span className="tone-warn">后续切片支持编辑</span></div></article>
      </div>
      <article className="card panel products-panel">
        <ProductToolbar filters={controller.filters} phase={controller.state.phase} total={total} onKeywordChange={controller.setKeyword} onStatusChange={(status) => controller.setFilters((previous) => ({ ...previous, status, page: 1 }))} onRefresh={controller.reload} />
        {controller.state.phase === 'success' && <ProductTable products={products} onOpen={controller.openProduct} />}
        <ProductListStateView phase={controller.state.phase} error={controller.state.error} onRetry={controller.reload} />
      </article>
      <ProductDetailPanel state={controller.detail} onClose={controller.closeProduct} onRetry={() => controller.detail.productId && controller.openProduct(controller.detail.productId)} />
    </section>
  );
}
