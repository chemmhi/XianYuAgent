import type { ProductVM } from '../types';
import { PlaceholderCell } from '../../../shared/ui/PlaceholderCell';

export function ProductTable({ products, page, totalPages, total, sortBy, sortOrder, onSortChange, onPageChange, onOpen, onOpenXianyuDetail }: {
  products: ProductVM[];
  page: number;
  totalPages: number;
  total: number;
  sortBy: 'createdAt' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
  onSortChange: (sortBy: 'createdAt' | 'updatedAt', sortOrder: 'asc' | 'desc') => void;
  onPageChange: (page: number) => void;
  onOpen: (productId: string) => void;
  onOpenXianyuDetail: (productId: string) => void;
}) {
  const pageItems = getPageItems(page, totalPages);
  const sortButton = (key: 'createdAt' | 'updatedAt', label: string) => {
    const active = sortBy === key;
    const nextOrder = active && sortOrder === 'desc' ? 'asc' : 'desc';
    return <button className="products-sort-button" type="button" data-testid={`product-sort-${key}`} aria-label={`${label}${active ? `，当前${sortOrder === 'desc' ? '降序' : '升序'}` : ''}`} aria-sort={active ? (sortOrder === 'desc' ? 'descending' : 'ascending') : 'none'} onClick={() => onSortChange(key, nextOrder)}>{label}<span aria-hidden="true">{active ? (sortOrder === 'desc' ? ' ↓' : ' ↑') : ' ↕'}</span></button>;
  };
  return <div className="products-table-region">
    <div className="products-table-scroll">
      <div className="products-table" role="table" aria-label="商品列表">
        <div className="products-row products-head" role="row"><span>商品标题</span><span>价格</span><span>关联卡券</span><span>AI提示词</span><span>{sortButton('createdAt', '创建时间')}</span><span>{sortButton('updatedAt', '更新时间')}</span><span>详情</span></div>
        {products.map((product) => <div className="products-row" role="row" key={product.id}><div className="products-title"><button className="products-title-link" type="button" onClick={() => onOpen(product.id)}><strong>{product.title}</strong></button><small>{product.externalProductRef ?? product.id}</small></div><span>{product.priceMinor === undefined ? <PlaceholderCell className="products-muted">—</PlaceholderCell> : formatPrice(product.priceMinor)}</span><span className="products-muted products-coupons">{product.couponBatches?.length ? product.couponBatches.map((coupon) => coupon.label || coupon.id).join('、') : <PlaceholderCell className="products-muted">未关联卡券</PlaceholderCell>}</span><span className="products-muted products-ai-prompt" title={product.aiPrompt ?? undefined}>{product.aiPrompt || <PlaceholderCell className="products-muted">—</PlaceholderCell>}</span><time className="products-muted">{formatDate(product.createdAt)}</time><time className="products-muted">{formatDate(product.updatedAt)}</time><span className="products-row-actions"><button className="btn ghost btn-small" type="button" data-testid={`product-detail-${product.id}`} onClick={() => onOpenXianyuDetail(product.id)}>详情</button></span></div>)}
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
