import type { ProductVM } from '../types';

const statusLabels: Record<ProductVM['status'], string> = { draft: '草稿', ready: '待发布', publishing: '发布中', published: '已发布', failed: '发布失败', archived: '已归档' };

export function ProductTable({ products, page, totalPages, total, onPageChange, onOpen }: {
  products: ProductVM[];
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  onOpen: (productId: string) => void;
}) {
  const pageItems = getPageItems(page, totalPages);
  return <div className="products-table-region">
    <div className="products-table-scroll">
      <div className="products-table" role="table" aria-label="商品列表">
        <div className="products-row products-head" role="row"><span>商品</span><span>账号</span><span>价格</span><span>状态</span><span>SKU / 素材</span><span>更新时间</span><span /></div>
        {products.map((product) => <div className="products-row" role="row" key={product.id}><div className="products-title"><strong>{product.title}</strong><small>{product.externalProductRef ?? product.id}</small></div><span className="products-account">{product.accountId}</span><span>{formatPrice(product.priceMinor)}</span><span><b className={`products-status products-status-${product.status}`}>{statusLabels[product.status]}</b></span><span className="products-muted">{product.skuCount} / {product.assetCount}</span><time className="products-muted">{formatDate(product.updatedAt)}</time><span className="products-row-actions"><button className="btn ghost" type="button" onClick={() => onOpen(product.id)}>查看详情</button></span></div>)}
      </div>
    </div>
    <nav className="products-pagination" aria-label="商品列表分页" data-testid="products-pagination">
      <span className="products-pagination-total">共 {total} 件</span>
      <div className="products-pagination-controls">
        <button className="products-page-button" type="button" data-testid="products-prev-page" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>上一页</button>
        {pageItems.map((item, index) => item === 'ellipsis' ? <span className="products-pagination-ellipsis" key={`ellipsis-${index}`} aria-hidden="true">…</span> : <button className={`products-page-button${item === page ? ' active' : ''}`} type="button" key={item} data-testid={`products-page-${item}`} aria-current={item === page ? 'page' : undefined} onClick={() => onPageChange(item)}>{item}</button>)}
        <button className="products-page-button" type="button" data-testid="products-next-page" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>下一页</button>
      </div>
      <span className="products-pagination-status">第 {page} / {totalPages} 页</span>
    </nav>
  </div>;
}

function formatPrice(priceMinor?: number) { return priceMinor === undefined ? '—' : `¥${(priceMinor / 100).toFixed(2)}`; }
function formatDate(value: string) { if (!value || value.startsWith('1970-')) return '—'; return value.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', ''); }

function getPageItems(page: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (page <= 3) return [1, 2, 3, 4, 'ellipsis', totalPages];
  if (page >= totalPages - 2) return [1, 'ellipsis', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, 'ellipsis', page - 1, page, page + 1, 'ellipsis', totalPages];
}
