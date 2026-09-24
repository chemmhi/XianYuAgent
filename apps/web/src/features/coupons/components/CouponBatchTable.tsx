import { useState } from 'react';
import type { CouponBatchVM } from '../types';

const typeLabels: Record<CouponBatchVM['purpose'], string> = { text: '文本', data: '批量数据', api: 'API', image: '图片' };

export function CouponBatchTable({ batches, selectedIds, page, pageSize, total, totalPages, sortBy, sortOrder, togglingBatchId, onSortChange, onPageChange, onSelect, onSelectAll, onEdit, onCopy, onBind, onToggle, onDelete }: { batches: CouponBatchVM[]; selectedIds: Set<string>; page: number; pageSize: number; total: number; totalPages: number; sortBy: 'createdAt'; sortOrder: 'asc' | 'desc'; togglingBatchId?: string | null; onSortChange: (sortBy: 'createdAt', sortOrder: 'asc' | 'desc') => void; onPageChange: (page: number) => void; onSelect: (batchId: string) => void; onSelectAll: () => void; onEdit: (batch: CouponBatchVM) => void; onCopy: (batch: CouponBatchVM) => void; onBind: (batchId: string) => void; onToggle: (batch: CouponBatchVM) => void; onDelete: (batchId: string) => void }) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const allSelected = batches.length > 0 && batches.every((batch) => selectedIds.has(batch.batchId));
  const pageItems = getPageItems(page, totalPages);
  const sortButton = (key: 'createdAt', label: string) => {
    const active = sortBy === key;
    const nextOrder = active && sortOrder === 'desc' ? 'asc' : 'desc';
    return <button className="coupons-sort-button" type="button" data-testid="coupon-sort-createdAt" aria-label={`${label}${active ? `，当前${sortOrder === 'desc' ? '降序' : '升序'}` : ''}`} aria-sort={active ? (sortOrder === 'desc' ? 'descending' : 'ascending') : 'none'} onClick={() => onSortChange(key, nextOrder)}>{label}<span aria-hidden="true">{active ? (sortOrder === 'desc' ? ' ↓' : ' ↑') : ' ↕'}</span></button>;
  };

  return <div className="coupons-table-region">
    <div className="coupons-table-scroll">
      <div className="coupons-table" role="table" aria-label="卡券列表" data-coupons-table>
        <div className="coupons-row coupons-head" role="row"><button type="button" className="coupons-check" aria-label={allSelected ? '取消全选' : '全选当前页'} onClick={onSelectAll}>{allSelected ? '☑' : '□'}</button><span>ID</span><span>名称</span><span>类型</span><span>内容预览</span><span>备注信息</span><span>发货设置</span><span>状态</span><span>{sortButton('createdAt', '时间')}</span><span>操作</span></div>
        {batches.map((batch) => {
          const metadata = batch.metadata;
          const previewText = getPreviewText(batch);
          const previewImages = batch.purpose === 'image' ? (batch.contentPreview?.imageUrls ?? batch.metadata?.imageUrls ?? []).filter((url) => url && url !== '暂无图片') : [];
          const menuOpen = openMenuId === batch.batchId;
          return <div className={`coupons-row${selectedIds.has(batch.batchId) ? ' selected' : ''}`} role="row" key={batch.batchId} data-batch-id={batch.batchId}>
            <button type="button" className="coupons-check" aria-label={`选择 ${batch.label}`} onClick={() => onSelect(batch.batchId)}>{selectedIds.has(batch.batchId) ? '☑' : '□'}</button>
            <span className="coupons-muted coupons-row-number">{batch.batchId}</span>
            <div className="coupons-title"><strong title={batch.label || '未命名卡券'}>{batch.label || '未命名卡券'}</strong></div>
            <span><b className="coupons-type">{typeLabels[batch.purpose]}</b></span>
            {previewImages.length > 0
              ? <span className="coupons-preview-cell coupons-preview-images" title="点击图片查看大图">{previewImages.map((url, index) => <button className="coupons-preview-thumb" key={`${url}-${index}`} type="button" aria-label={`查看${batch.label || '卡券'}图片${index + 1}`} onClick={() => setPreviewImageUrl(url)}><img src={url} alt={`${batch.label || '卡券'}预览${index + 1}`} /></button>)}</span>
              : <span className="coupons-preview-cell" title={previewText}>{previewText}</span>}
            <span className="coupons-note" title={metadata?.description || undefined}>{metadata?.description || '—'}</span>
            <span className="coupons-delivery-setting">自动发货<small>延时 {metadata?.delaySeconds ?? 0} 秒</small></span>
            <span className="coupons-status-cell"><button className={`coupon-status-switch${batch.status === 'active' ? ' on' : ''}`} type="button" role="switch" aria-checked={batch.status === 'active'} aria-label={`${batch.label || '未命名卡券'}${batch.status === 'active' ? '已启用' : '未启用'}`} disabled={batch.status === 'voided' || batch.status === 'closed' || togglingBatchId === batch.batchId} onClick={() => onToggle(batch)}><span aria-hidden="true" /><em>{batch.status === 'active' ? '启用' : '未启用'}</em></button></span>
            <time className="coupons-muted">创建 {formatDate(batch.createdAt)}<br />更新 {formatDate(batch.updatedAt)}</time>
            <span className="coupons-row-actions" aria-label={`${batch.label} 操作`}>
              <button className="btn ghost btn-small coupons-action-button" type="button" aria-label="编辑" onClick={() => onEdit(batch)}>编辑</button>
              <button className="btn ghost btn-small coupons-action-button" type="button" aria-label="关联商品" onClick={() => onBind(batch.batchId)}>关联商品</button>
              <span className="coupons-more-actions" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpenMenuId(null); }}>
                <button className="btn ghost btn-small coupons-action-button" type="button" aria-label="更多" aria-expanded={menuOpen} onClick={() => setOpenMenuId(menuOpen ? null : batch.batchId)}>更多</button>
                {menuOpen && <span className="coupons-more-menu" role="menu">
                  <button className="btn ghost btn-small" type="button" role="menuitem" onClick={() => { setOpenMenuId(null); onCopy(batch); }}>复制</button>
                  <button className="btn danger btn-small" type="button" role="menuitem" onClick={() => { setOpenMenuId(null); onDelete(batch.batchId); }}>删除</button>
                </span>}
              </span>
            </span>
          </div>;
        })}
      </div>
    </div>
    <nav className="coupons-pagination" aria-label="卡券列表分页" data-testid="coupons-pagination">
      <span className="coupons-pagination-total">共 {total} 个批次</span>
      <div className="coupons-pagination-controls">
        <button className="coupons-page-button" type="button" data-testid="coupons-prev-page" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>上一页</button>
        {pageItems.map((item, index) => item === 'ellipsis'
          ? <span className="coupons-pagination-ellipsis" key={`ellipsis-${index}`} aria-hidden="true">…</span>
          : <button className={`coupons-page-button${item === page ? ' active' : ''}`} type="button" key={item} data-testid={`coupons-page-${item}`} aria-current={item === page ? 'page' : undefined} onClick={() => onPageChange(item)}>{item}</button>)}
        <button className="coupons-page-button" type="button" data-testid="coupons-next-page" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>下一页</button>
      </div>
      <span className="coupons-pagination-status">第 {page} / {totalPages} 页</span>
    </nav>
    {previewImageUrl && <div className="coupons-image-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewImageUrl(null); }}>
      <section className="coupons-image-preview" role="dialog" aria-modal="true" aria-label="卡券图片预览">
        <button className="icon-button coupons-image-preview-close" type="button" aria-label="关闭图片预览" onClick={() => setPreviewImageUrl(null)}>×</button>
        <img src={previewImageUrl} alt="卡券大图预览" />
      </section>
    </div>}
  </div>;
}

function getPreviewText(batch: CouponBatchVM): string {
  const preview = batch.contentPreview;
  const metadata = batch.metadata;
  if (batch.purpose === 'text') return preview?.text || metadata?.textContent || '—';
  if (batch.purpose === 'data') return metadata?.dataContent ? '已配置批量数据' : '未配置批量数据';
  if (batch.purpose === 'api') return preview?.apiUrl || metadata?.apiConfig?.url || '—';
  return preview?.imageUrls?.join('、') || metadata?.imageUrls?.join('、') || '暂无图片';
}

function formatDate(value?: string) { if (!value || value.startsWith('1970-')) return '—'; return value.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', ''); }

function getPageItems(page: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (page <= 3) return [1, 2, 3, 4, 'ellipsis', totalPages];
  if (page >= totalPages - 2) return [1, 'ellipsis', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, 'ellipsis', page - 1, page, page + 1, 'ellipsis', totalPages];
}
