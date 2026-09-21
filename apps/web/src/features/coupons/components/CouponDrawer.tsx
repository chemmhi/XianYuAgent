import { useMemo, useState } from 'react';
import { CouponDetailStateView } from './CouponStateView';
import type { CouponContentPreviewVM, CouponDetailState, CouponMutationState } from '../types';
import { InputField } from '../../../shared/ui/InputField';
import { TextAreaField } from '../../../shared/ui/TextAreaField';
import { Button } from '../../../shared/ui/Button';

export function CouponDrawer({ state, content, mutation, onClose, onRetry, onImport, onBind, onVoid, onPreview }: { state: CouponDetailState; content: CouponContentPreviewVM | null; mutation: CouponMutationState; onClose: () => void; onRetry: () => void; onImport: (items: string[]) => Promise<void>; onBind: (productId: string) => Promise<void>; onVoid: () => Promise<void>; onPreview: (couponId: string) => Promise<void> }) {
  const [itemsText, setItemsText] = useState('');
  const [productId, setProductId] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  const batch = state.data;
  const firstAvailable = useMemo(() => batch?.items?.find((item) => item.status === 'available') ?? batch?.items?.[0], [batch]);
  if (state.phase === 'idle') return null;
  return <div className="coupons-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <aside className="coupons-drawer" aria-label="卡券批次详情" data-coupon-drawer>
      <header className="coupons-drawer-header"><div><p className="eyebrow">Batch Detail</p><h2>{batch?.label ?? '卡券批次'}</h2><span>{batch?.batchId}</span></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭">×</button></header>
      <CouponDetailStateView phase={state.phase} error={state.error} onRetry={onRetry} />
      {batch && state.phase === 'success' && <div className="coupons-drawer-body">
        <div className="coupons-drawer-summary"><div><span>可用库存</span><strong>{batch.availableCount}</strong><small>/ {batch.totalCount}</small></div><div><span>预留中</span><strong>{batch.reservedCount}</strong></div><div><span>已消耗</span><strong>{batch.consumedCount}</strong></div></div>
        <section className="coupons-drawer-section"><h3>批次信息</h3><dl><div><dt>账号</dt><dd>{batch.accountId}</dd></div><div><dt>交付范围</dt><dd>{batch.deliveryScope}</dd></div><div><dt>状态</dt><dd>{batch.status}</dd></div><div><dt>版本</dt><dd>{batch.version}</dd></div></dl></section>
        <section className="coupons-drawer-section"><div className="coupons-section-title"><h3>导入库存</h3><span className="coupons-inline-note">逐项保留结果</span></div><TextAreaField rows={4} value={itemsText} onChange={(event) => setItemsText(event.target.value)} placeholder="每行一个卡券正文" aria-label="每行一个卡券正文" /><Button variant="primary" type="button" disabled={mutation.phase === 'submitting' || !itemsText.trim()} onClick={async () => { await onImport(itemsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)); setItemsText(''); }}>{mutation.phase === 'submitting' ? '提交中…' : '导入库存'}</Button></section>
        <section className="coupons-drawer-section"><div className="coupons-section-title"><h3>绑定商品</h3><span className="coupons-inline-note">校验账号一致</span></div><div className="coupons-inline-form"><InputField value={productId} onChange={(event) => setProductId(event.target.value)} placeholder="product UUID" aria-label="商品 ID" /><Button variant="ghost" type="button" disabled={mutation.phase === 'submitting' || !productId.trim()} onClick={async () => { await onBind(productId.trim()); setProductId(''); }}>绑定</Button></div>{batch.bindings.length === 0 ? <p className="coupons-empty-note">暂未绑定商品。</p> : <ul className="coupons-binding-list">{batch.bindings.map((binding) => <li key={binding.bindingId}><span>{binding.productTitle ?? binding.productId}</span><small>{binding.status}</small></li>)}</ul>}</section>
        <section className="coupons-drawer-section"><div className="coupons-section-title"><h3>受控正文预览</h3><span className="coupons-inline-note">仅管理员用途</span></div>{firstAvailable ? <Button variant="ghost" type="button" onClick={() => onPreview(firstAvailable.id)}>查看首条可用正文</Button> : <p className="coupons-empty-note">没有可预览的可用库存。</p>}{content && <div className={`coupons-content-preview ${content.access.allowed ? 'allowed' : 'denied'}`} data-coupon-content-preview>{content.access.allowed && content.content ? <><span className="coupons-preview-audit">审计 {content.access.auditRef}</span><pre>{content.content.body}</pre><div className="coupons-preview-actions"><Button variant="ghost" type="button" onClick={async () => { await navigator.clipboard?.writeText(content.content?.body ?? ''); setCopyNotice('正文已复制'); window.setTimeout(() => setCopyNotice(''), 1800); }}>复制正文</Button>{copyNotice && <span className="coupons-inline-note" role="status">{copyNotice}</span>}</div>{content.content.quarkUrl && <p>夸克链接：{content.content.quarkUrl}</p>}{content.content.extractionCode && <p>提取码：{content.content.extractionCode}</p>}</> : <p>预览被拒绝：{content.access.denialReason ?? 'policy_rejected'}</p>}</div>}</section>
        <section className="coupons-danger-zone"><div><h3>作废批次</h3><p>作废不可逆，后续只能查询历史，不会恢复库存。</p></div><Button variant="danger" type="button" disabled={mutation.phase === 'submitting' || batch.status === 'voided'} onClick={() => { if (window.confirm('确认作废该批次？作废不可逆。')) void onVoid(); }}>{mutation.phase === 'submitting' ? '处理中…' : '作废批次'}</Button></section>
      </div>}
    </aside>
  </div>;
}
