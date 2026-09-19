import type { CouponBatchVM } from '../types';

const typeLabels: Record<CouponBatchVM['purpose'], string> = { text: '文本', data: '批量数据', api: 'API', image: '图片' };
const statusLabels: Record<CouponBatchVM['status'], string> = { draft: '草稿', active: '启用', paused: '禁用', closed: '已关闭', exhausted: '已耗尽', voided: '已删除' };

export function CouponBatchTable({ batches, selectedIds, onSelect, onSelectAll, onOpen, onEdit, onCopy, onBind, onToggle, onDelete, onImagePreview }: { batches: CouponBatchVM[]; selectedIds: Set<string>; onSelect: (batchId: string) => void; onSelectAll: () => void; onOpen: (batchId: string) => void; onEdit: (batch: CouponBatchVM) => void; onCopy: (batch: CouponBatchVM) => void; onBind: (batchId: string) => void; onToggle: (batch: CouponBatchVM) => void; onDelete: (batchId: string) => void; onImagePreview: (url: string) => void }) {
  const allSelected = batches.length > 0 && batches.every((batch) => selectedIds.has(batch.batchId));
  return <div className="coupons-table" role="table" aria-label="卡券列表" data-coupons-table>
    <div className="coupons-row coupons-head" role="row"><button type="button" className="coupons-check" aria-label={allSelected ? '取消全选' : '全选当前页'} onClick={onSelectAll}>{allSelected ? '☑' : '□'}</button><span>ID</span><span>名称</span><span>类型</span><span>内容预览</span><span>发货设置</span><span>对接信息</span><span>状态</span><span>时间</span><span>操作</span></div>
    {batches.map((batch) => {
      const preview = batch.contentPreview;
      const metadata = batch.metadata;
      return <div className={`coupons-row${selectedIds.has(batch.batchId) ? ' selected' : ''}`} role="row" key={batch.batchId} data-batch-id={batch.batchId}>
        <button type="button" className="coupons-check" aria-label={`选择 ${batch.label}`} onClick={() => onSelect(batch.batchId)}>{selectedIds.has(batch.batchId) ? '☑' : '□'}</button>
        <span className="coupons-muted">{batch.batchId.replace(/^batch-/, '')}</span>
        <div className="coupons-title"><strong>{batch.label || '未命名卡券'}</strong>{metadata?.multiSpec && <small>规格：{metadata.specName || '-'} = {metadata.specValue || '-'}</small>}<small>{metadata?.description || batch.accountId}</small></div>
        <span><b className="coupons-type">{typeLabels[batch.purpose]}</b></span>
        <span className="coupons-preview-cell">{batch.purpose === 'image' ? (preview?.imageUrls?.[0] ? <button type="button" className="btn ghost btn-small" onClick={() => onImagePreview(preview.imageUrls![0])}>查看原图</button> : '暂无图片') : <code className="coupons-preview-code">{batch.purpose === 'text' ? (preview?.text || '-') : batch.purpose === 'data' ? `剩余 ${preview?.dataRemaining ?? batch.availableCount} 条` : (preview?.apiUrl || '-')}</code>}</span>
        <span className="coupons-delivery-setting">已发货 {metadata?.deliveryCount ?? batch.consumedCount} 次<small>延时 {metadata?.delaySeconds ?? 0} 秒</small></span>
        <span className="coupons-binding-info">{metadata?.dockable ? <><span>对接价：¥{metadata.price || '-'}</span><small>最低价：¥{metadata.minPrice || '-'} · {metadata.feePayer === 'dealer' ? '分销商承担' : '分销主承担'}</small></> : '不对接'}</span>
        <span><b className={`coupons-status coupons-status-${batch.status}`}>{statusLabels[batch.status]}</b><small className="coupons-alert-dot">库存 {batch.availableCount}</small></span>
        <time className="coupons-muted">创建 {formatDate(batch.createdAt)}<br />更新 {formatDate(batch.updatedAt)}</time>
        <span className="coupons-row-actions" aria-label={`${batch.label} 操作`}>
          <ActionButton label="查看明细" onClick={() => onOpen(batch.batchId)} path="M4 12a8 8 0 0 1 16 0a8 8 0 0 1-16 0Zm8-3a3 3 0 1 0 0 6a3 3 0 0 0 0-6Z" />
          <ActionButton label="编辑" onClick={() => onEdit(batch)} path="m4 16 9.6-9.6 4 4L8 20H4v-4Zm10.6-10.6 2-2 4 4-2 2" />
          <ActionButton label="复制" onClick={() => onCopy(batch)} path="M8 8h10v10H8zM6 16H4V4h12v2" />
          <ActionButton label="管理关联商品" onClick={() => onBind(batch.batchId)} path="M10 13.5 8.5 15a3 3 0 0 1-4.2-4.2l2-2A3 3 0 0 1 10.5 9m3.5 1.5 1.5-1.5a3 3 0 0 1 4.2 4.2l-2 2a3 3 0 0 1-4.2-.2" />
          <ActionButton label={batch.status === 'active' ? '禁用' : '启用'} onClick={() => onToggle(batch)} path={batch.status === 'active' ? 'M8 5v14M16 5v14' : 'M5 12h14M12 5v14'} />
          <ActionButton label="删除" danger onClick={() => onDelete(batch.batchId)} path="M5 7h14M10 11v6m4-6v6M9 7V4h6v3m-8 0 1 14h8l1-14" />
        </span>
      </div>;
    })}
  </div>;
}

function ActionButton({ label, path, onClick, danger = false }: { label: string; path: string; onClick: () => void; danger?: boolean }) {
  return <button className={`coupons-action-icon${danger ? ' danger' : ''}`} type="button" aria-label={label} title={label} onClick={onClick}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg></button>;
}

function formatDate(value?: string) { if (!value || value.startsWith('1970-')) return '—'; return value.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', ''); }
