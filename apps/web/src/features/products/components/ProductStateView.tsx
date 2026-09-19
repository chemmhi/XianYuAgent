import type { ProductDetailState, ProductsLoadError, ProductsLoadPhase } from '../types';

export function ProductListStateView({ phase, error, onRetry, accountSelectionRequired = false }: { phase: ProductsLoadPhase; error: ProductsLoadError | null; onRetry: () => void; accountSelectionRequired?: boolean }) {
  if (phase === 'idle' || phase === 'loading') return <div className="products-state" aria-live="polite"><div className="products-skeleton"/><div className="products-skeleton"/><div className="products-skeleton"/></div>;
  if (accountSelectionRequired) return <div className="products-state"><strong>请选择闲鱼账号</strong><span>当前有多个可用账号，请先选择账号后再加载商品或执行同步。</span></div>;
  if (phase === 'empty') return <div className="products-state"><strong>暂无商品</strong><span>当前账号范围内没有匹配商品，可调整筛选条件后重试。</span></div>;
  if (phase === 'forbidden') return <div className="products-state products-error" role="alert"><strong>无权查看商品</strong><span>{error?.message}</span></div>;
  if (phase === 'error' && error) return <div className="products-state products-error" role="alert"><strong>商品列表加载失败</strong><span>{error.message}</span>{error.retryable && <button className="btn ghost" type="button" onClick={onRetry}>重新加载</button>}</div>;
  return null;
}

export function ProductDetailStateView({ state, onRetry }: { state: ProductDetailState; onRetry: () => void }) {
  if (state.phase === 'loading') return <div className="products-detail-state">正在加载商品详情…</div>;
  if (state.phase === 'forbidden') return <div className="products-detail-state products-error" role="alert"><strong>无权查看商品详情</strong><span>{state.error?.message}</span></div>;
  if (state.phase === 'error') return <div className="products-detail-state products-error" role="alert"><strong>商品详情加载失败</strong><span>{state.error?.message}</span>{state.error?.retryable && <button className="btn ghost" type="button" onClick={onRetry}>重试</button>}</div>;
  return null;
}
