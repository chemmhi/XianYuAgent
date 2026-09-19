import type { ProductDetailState } from '../types';
import { ProductDetailStateView } from './ProductStateView';

export function ProductDetailPanel({ state, onClose, onRetry }: { state: ProductDetailState; onClose: () => void; onRetry: () => void }) {
  if (state.phase === 'idle') return null;
  const product = state.data;
  return <div className="products-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="products-detail-panel" role="dialog" aria-modal="true" aria-label="商品详情"><header><div><p className="eyebrow">Product Detail</p><h2>{product?.title ?? '商品详情'}</h2></div><button className="icon-button" type="button" aria-label="关闭商品详情" onClick={onClose}>×</button></header><ProductDetailStateView state={state} onRetry={onRetry}/>{product && <div className="products-detail-body"><dl><div><dt>商品编号</dt><dd>{product.externalProductRef ?? product.id}</dd></div><div><dt>所属账号</dt><dd>{product.accountId}</dd></div><div><dt>状态</dt><dd>{product.status}</dd></div><div><dt>价格</dt><dd>{product.priceMinor === undefined ? '—' : `¥${(product.priceMinor / 100).toFixed(2)}`}</dd></div><div><dt>配置版本</dt><dd>{product.configVersion}</dd></div><div><dt>SKU / 素材</dt><dd>{product.skuCount} / {product.assetCount}</dd></div></dl><section><h3>描述</h3><p>{product.description || '暂无商品描述'}</p></section></div>}</aside></div>;
}
