import type { ProductVM } from '../types';
import { PlaceholderCell } from '../../../shared/ui/PlaceholderCell';

export function ProductTable({ products, page, totalPages, total, sortBy, sortOrder, onSortChange, onPageChange, onOpen, onOpenXianyuDetail, selectedIds = [], onToggleSelected, onToggleAll, onOpenAutomation, automationSummary }: {
  products: ProductVM[];
  page: number;
  totalPages: number;
  total: number;
  sortBy: 'createdAt' | 'updatedAt' | 'xianyuOrder';
  sortOrder: 'asc' | 'desc';
  onSortChange: (sortBy: 'createdAt' | 'updatedAt' | 'xianyuOrder', sortOrder: 'asc' | 'desc') => void;
  onPageChange: (page: number) => void;
  onOpen: (productId: string) => void;
  onOpenXianyuDetail: (productId: string) => void;
  selectedIds?: string[];
  onToggleSelected?: (productId: string) => void;
  onToggleAll?: (checked: boolean) => void;
  onOpenAutomation?: (productId: string) => void;
  automationSummary?: (product: ProductVM) => { label: string; detail: string; tone: 'ok' | 'warn' | 'muted' };
}) {
  const automationEnabled = Boolean(onToggleSelected && onOpenAutomation);
  const pageItems = getPageItems(page, totalPages);
  const sortButton = (key: 'createdAt' | 'updatedAt', label: string) => {
    const active = sortBy === key;
    const nextOrder = active && sortOrder === 'desc' ? 'asc' : 'desc';
    return <button className="products-sort-button" type="button" data-testid={`product-sort-${key}`} aria-label={`${label}${active ? `，当前${sortOrder === 'desc' ? '降序' : '升序'}` : ''}`} aria-sort={active ? (sortOrder === 'desc' ? 'descending' : 'ascending') : 'none'} onClick={() => onSortChange(key, nextOrder)}>{label}<span aria-hidden="true">{active ? (sortOrder === 'desc' ? ' ↓' : ' ↑') : ' ↕'}</span></button>;
  };
  return <div className="products-table-region">
    <div className="products-table-scroll">
      <div className={`products-table${automationEnabled ? ' products-table-automation' : ''}`} role="table" aria-label="商品列表">
        <div className="products-row products-head" role="row">{automationEnabled && <span className="products-check-cell"><input type="checkbox" aria-label="选择全部商品" checked={products.length > 0 && products.every((product) => selectedIds.includes(product.id))} onChange={(event) => onToggleAll?.(event.target.checked)} /></span>}<span>商品标题</span><span>价格</span><span>关联卡券</span>{automationEnabled && <span>自动化</span>}<span>知识库</span><span>{sortButton('createdAt', '创建时间')}</span><span>{automationEnabled ? '操作' : sortButton('updatedAt', '闲鱼更新时间')}</span>{!automationEnabled && <span>详情</span>}</div>
        {products.map((product) => <div className="products-row" role="row" key={product.id}>{automationEnabled && <span className="products-check-cell"><input type="checkbox" aria-label={`选择${product.title}`} checked={selectedIds.includes(product.id)} onChange={() => onToggleSelected?.(product.id)} /></span>}<div className="products-title"><button className="products-title-link" type="button" onClick={() => onOpen(product.id)}><strong>{product.title}</strong></button><small>{product.externalProductRef ?? product.id}</small></div><span>{product.priceMinor === undefined ? <PlaceholderCell className="products-placeholder">—</PlaceholderCell> : formatPrice(product.priceMinor)}</span><span className="products-coupons">{product.couponBatches?.length ? product.couponBatches.map((coupon) => coupon.label || coupon.id).join('、') : <PlaceholderCell className="products-placeholder">未关联卡券</PlaceholderCell>}</span>{automationEnabled && (() => { const summary = automationSummary?.(product) ?? { label: '读取中...', detail: '正在读取规则', tone: 'muted' as const }; return <span className="products-automation-status"><em className={`products-status products-status-${summary.tone}`}>{summary.label}</em><small>{summary.detail || '\u00a0'}</small></span>; })()}<span className="products-knowledge-base" title={product.knowledgeBase ?? undefined}>{product.knowledgeBase || <PlaceholderCell className="products-placeholder">—</PlaceholderCell>}</span><time className="products-meta">{formatDate(product.createdAt)}</time>{automationEnabled ? <span className="products-row-actions"><button className="btn ghost btn-small" type="button" data-testid={`product-detail-${product.id}`} onClick={() => onOpenXianyuDetail(product.id)}>详情</button><button className="btn primary btn-small" type="button" data-testid={`product-automation-${product.id}`} onClick={() => onOpenAutomation?.(product.id)}>自动化</button></span> : <time className="products-meta">{product.xianyuUpdatedAt ? formatDate(product.xianyuUpdatedAt) : '未获取'}</time>}{!automationEnabled && <span className="products-row-actions"><button className="btn ghost btn-small" type="button" data-testid={`product-detail-${product.id}`} onClick={() => onOpenXianyuDetail(product.id)}>详情</button></span>}</div>)}
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
