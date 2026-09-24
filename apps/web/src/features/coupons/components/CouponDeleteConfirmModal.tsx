import type { CouponBatchVM } from '../types';

export interface CouponDeleteConfirmModalProps {
  batches: CouponBatchVM[];
  submitting?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function CouponDeleteConfirmModal({ batches, submitting = false, error, onClose, onConfirm }: CouponDeleteConfirmModalProps) {
  const boundBatches = batches.filter((batch) => batch.bindings.some((binding) => binding.status === 'active'));
  const batchCount = batches.length;
  const boundProductCount = boundBatches.reduce((total, batch) => total + batch.bindings.filter((binding) => binding.status === 'active').length, 0);
  const isBulk = batchCount > 1;

  return <div className="coupons-modal-backdrop coupon-delete-modal-backdrop" role="presentation" onMouseDown={(event) => { if (!submitting && event.target === event.currentTarget) onClose(); }}>
    <section className="coupons-modal card coupon-delete-modal" role="dialog" aria-modal="true" aria-labelledby="coupon-delete-title" aria-describedby="coupon-delete-description" data-testid="coupon-delete-confirm-modal">
      <header className="coupons-modal-header">
        <div><p className="eyebrow">Coupon Configuration</p><h2 id="coupon-delete-title">删除卡券</h2><p id="coupon-delete-description">请确认是否删除{isBulk ? `选中的 ${batchCount} 张卡券` : '这张卡券'}。</p></div>
        <button className="icon-button" type="button" aria-label="关闭删除卡券弹窗" onClick={onClose} disabled={submitting}>×</button>
      </header>
      <div className="coupon-delete-content">
        {boundBatches.length > 0 ? <div className="coupon-delete-warning" role="note">
          <div className="coupon-delete-warning-icon" aria-hidden="true">!</div>
          <div><strong>已有卡券关联商品</strong><p>{boundBatches.length} 张卡券当前关联 {boundProductCount} 个商品。删除后，商品列表和商品自动化配置中将不再显示这些卡券；历史订单与审计记录仍会保留。</p></div>
        </div> : <div className="coupon-delete-warning coupon-delete-warning-neutral" role="note">
          <div className="coupon-delete-warning-icon" aria-hidden="true">i</div>
          <div><strong>删除后不可在卡券列表继续使用</strong><p>历史订单与审计记录会保留。</p></div>
        </div>}
        <div className="coupon-delete-summary">
          <strong>{isBulk ? '待删除卡券' : '卡券名称'}</strong>
          <ul>{batches.map((batch) => <li key={batch.batchId}><span>{batch.label || '未命名卡券'}</span>{boundBatches.includes(batch) && <small>已关联商品</small>}</li>)}</ul>
        </div>
        {error && <div className="coupon-delete-error" role="alert">{error}</div>}
      </div>
      <footer className="coupons-modal-footer">
        <button className="btn ghost" type="button" data-testid="coupon-delete-cancel" onClick={onClose} disabled={submitting}>取消</button>
        <button className="btn danger" type="button" data-testid="coupon-delete-confirm" onClick={onConfirm} disabled={submitting}>{submitting ? '删除中…' : '确认删除'}</button>
      </footer>
    </section>
  </div>;
}
