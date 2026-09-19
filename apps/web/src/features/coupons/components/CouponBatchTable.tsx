import type { CouponBatchVM } from '../types';

const statusLabels: Record<CouponBatchVM['status'], string> = { draft: '草稿', active: '启用中', paused: '已暂停', closed: '已关闭', exhausted: '已耗尽', voided: '已作废' };
const alertLabels: Record<CouponBatchVM['stockAlert'], string> = { normal: '正常', low_stock: '低库存', exhausted: '已耗尽' };

export function CouponBatchTable({ batches, onOpen, onCopy, onBind, onVoid, onDelete }: { batches: CouponBatchVM[]; onOpen: (batchId: string) => void; onCopy: (batch: CouponBatchVM) => void; onBind: (batchId: string) => void; onVoid: (batchId: string) => void; onDelete: (batchId: string) => void }) {
  return <div className="coupons-table" role="table" aria-label="卡券批次列表" data-coupons-table>
    <div className="coupons-row coupons-head" role="row"><span>ID</span><span>名称</span><span>类型</span><span>内容预览</span><span>发货设置</span><span>对接信息</span><span>状态</span><span>时间</span><span /></div>
    {batches.map((batch) => <div className="coupons-row" role="row" key={batch.batchId} data-batch-id={batch.batchId}>
      <span className="coupons-muted">{batch.batchId.replace(/^batch-/, '')}</span>
      <div className="coupons-title"><strong>{batch.label}</strong><small>{batch.accountId}</small></div>
      <span><b className="coupons-type">{batch.purpose === 'text' ? '文本' : batch.purpose === 'data' ? '批量' : batch.purpose === 'image' ? '图片' : 'API'}</b></span>
      <code className="coupons-preview-code">受控正文 · {batch.totalCount} 条</code>
      <span className="coupons-delivery-setting">已发货 {batch.consumedCount} 次<small>可用 {batch.availableCount} · 预留 {batch.reservedCount}</small></span>
      <span className="coupons-binding-info">{batch.bindings.filter((item) => item.status === 'active').length ? `${batch.bindings.filter((item) => item.status === 'active').length} 个商品` : '不对接'}</span>
      <span><b className={`coupons-status coupons-status-${batch.status}`}>{statusLabels[batch.status]}</b><small className={`coupons-alert-dot coupons-alert-dot-${batch.stockAlert}`}>{alertLabels[batch.stockAlert]}</small></span>
      <time className="coupons-muted">{formatDate(batch.updatedAt)}</time>
      <span className="coupons-row-actions" aria-label={`${batch.label} 操作`}>
        <ActionButton label="查看" onClick={() => onOpen(batch.batchId)} path="M4 12a8 8 0 0 1 16 0a8 8 0 0 1-16 0Zm8-3a3 3 0 1 0 0 6a3 3 0 0 0 0-6Z" />
        <ActionButton label="编辑" onClick={() => onOpen(batch.batchId)} path="m4 16 9.6-9.6 4 4L8 20H4v-4Zm10.6-10.6 2-2 4 4-2 2" />
        <ActionButton label="复制批次编号" onClick={() => onCopy(batch)} path="M8 8h10v10H8zM6 16H4V4h12v2" />
        <ActionButton label="绑定商品" onClick={() => onBind(batch.batchId)} path="M10 13.5 8.5 15a3 3 0 0 1-4.2-4.2l2-2A3 3 0 0 1 10.5 9m3.5 1.5 1.5-1.5a3 3 0 0 1 4.2 4.2l-2 2a3 3 0 0 1-4.2-.2" />
        <ActionButton label="作废批次" danger onClick={() => onVoid(batch.batchId)} path="M12 3v18M5 7h14M7 7l1 14h8l1-14" />
        <ActionButton label="删除批次" danger onClick={() => onDelete(batch.batchId)} path="M5 7h14M10 11v6m4-6v6M9 7V4h6v3m-8 0 1 14h8l1-14" />
      </span>
    </div>)}
  </div>;
}

function ActionButton({ label, path, onClick, danger = false }: { label: string; path: string; onClick: () => void; danger?: boolean }) {
  return <button className={`coupons-action-icon${danger ? ' danger' : ''}`} type="button" aria-label={label} title={label} onClick={onClick}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg></button>;
}

function formatDate(value: string) { if (!value || value.startsWith('1970-')) return '—'; return value.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', ''); }
