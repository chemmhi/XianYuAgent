import type { ProductVM } from '../types';

const statusLabels: Record<ProductVM['status'], string> = { draft: '草稿', ready: '待发布', publishing: '发布中', published: '已发布', failed: '发布失败', archived: '已归档' };

export function ProductTable({ products, onOpen }: { products: ProductVM[]; onOpen: (productId: string) => void }) {
  return <div className="products-table" role="table" aria-label="商品列表"><div className="products-row products-head" role="row"><span>商品</span><span>账号</span><span>价格</span><span>状态</span><span>SKU / 素材</span><span>更新时间</span><span /></div>{products.map((product) => <div className="products-row" role="row" key={product.id}><div className="products-title"><strong>{product.title}</strong><small>{product.externalProductRef ?? product.id}</small></div><span className="products-account">{product.accountId}</span><span>{formatPrice(product.priceMinor)}</span><span><b className={`products-status products-status-${product.status}`}>{statusLabels[product.status]}</b></span><span className="products-muted">{product.skuCount} / {product.assetCount}</span><time className="products-muted">{formatDate(product.updatedAt)}</time><span className="products-row-actions"><button className="btn ghost" type="button" onClick={() => onOpen(product.id)}>查看详情</button></span></div>)}</div>;
}

function formatPrice(priceMinor?: number) { return priceMinor === undefined ? '—' : `¥${(priceMinor / 100).toFixed(2)}`; }
function formatDate(value: string) { if (!value || value.startsWith('1970-')) return '—'; return value.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', ''); }
