import { useState } from 'react';
import type { CreateCouponBatchRequest, DeliveryScope } from '../types';

export function CouponCreateModal({ submitting, onClose, onSubmit }: { submitting: boolean; onClose: () => void; onSubmit: (input: CreateCouponBatchRequest) => Promise<void> }) {
  const [accountId, setAccountId] = useState('account-001');
  const [label, setLabel] = useState('');
  const [purpose, setPurpose] = useState<CreateCouponBatchRequest['purpose']>('text');
  const [deliveryScope, setDeliveryScope] = useState<DeliveryScope>('operator_only');
  const [quarkUrl, setQuarkUrl] = useState('');
  const [extractionCode, setExtractionCode] = useState('');
  const [itemsText, setItemsText] = useState('');
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!accountId.trim() || !label.trim()) { setError('请填写账号和批次名称。'); return; }
    setError('');
    try { await onSubmit({ accountId: accountId.trim(), label: label.trim(), purpose, deliveryScope, quarkUrl: quarkUrl.trim() || undefined, extractionCode: extractionCode.trim() || undefined, items: itemsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }); onClose(); }
    catch (submitError) { setError(submitError instanceof Error ? submitError.message : '创建失败，请重试。'); }
  }

  return <div className="coupons-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <form className="coupons-modal card" onSubmit={submit} aria-label="新建卡券批次">
      <header><div><p className="eyebrow">Coupon Batch</p><h2>新建卡券批次</h2><p>先创建批次，再从详情抽屉导入或批量编辑库存。</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭">×</button></header>
      <div className="coupons-form-grid">
        <label>账号<input value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="account UUID" /></label>
        <label>批次名称<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：Python 资料包" /></label>
        <label>卡券类型<select value={purpose} onChange={(event) => setPurpose(event.target.value as CreateCouponBatchRequest['purpose'])}><option value="text">文本</option><option value="data">数据</option><option value="image">图片</option><option value="api">API</option></select></label>
        <label>交付范围<select value={deliveryScope} onChange={(event) => setDeliveryScope(event.target.value as DeliveryScope)}><option value="operator_only">仅管理员</option><option value="buyer_deliverable">可交付买家</option><option value="system_only">仅系统</option></select></label>
        <label>夸克链接<input value={quarkUrl} onChange={(event) => setQuarkUrl(event.target.value)} placeholder="可选，批次级资源链接" /></label>
        <label>提取码<input value={extractionCode} onChange={(event) => setExtractionCode(event.target.value)} placeholder="可选" /></label>
        <label className="coupons-form-full">首批库存（每行一条，可留空）<textarea value={itemsText} onChange={(event) => setItemsText(event.target.value)} rows={5} placeholder="一行一个卡券正文；正文不会出现在批次列表或日志中。" /></label>
      </div>
      {error && <p className="coupons-form-error" role="alert">{error}</p>}
      <footer><button className="btn ghost" type="button" onClick={onClose}>取消</button><button className="btn primary" type="submit" disabled={submitting}>{submitting ? '创建中…' : '创建批次'}</button></footer>
    </form>
  </div>;
}
