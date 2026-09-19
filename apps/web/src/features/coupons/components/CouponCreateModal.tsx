import { useMemo, useState } from 'react';
import type { CouponBatchVM, CreateCouponBatchRequest, UpdateCouponBatchRequest } from '../types';

type FormState = {
  accountId: string; label: string; purpose: CouponBatchVM['purpose']; deliveryScope: CreateCouponBatchRequest['deliveryScope'];
  quarkUrl: string; extractionCode: string; textContent: string; dataContent: string; apiUrl: string; apiMethod: 'GET' | 'POST'; apiTimeout: number; apiHeaders: string; apiParams: string; apiResponseField: string; imageUrls: string; delaySeconds: number; deliveryCount: number; description: string; dockable: boolean; price: string; minPrice: string; feePayer: 'distributor' | 'dealer'; dockVisibility: 'public' | 'dealer_only'; multiSpec: boolean; specName: string; specValue: string; itemsText: string;
};

function fromBatch(batch?: CouponBatchVM): FormState {
  const metadata = batch?.metadata;
  return { accountId: batch?.accountId ?? 'account-001', label: batch?.label ?? '', purpose: batch?.purpose ?? 'text', deliveryScope: batch?.deliveryScope ?? 'operator_only', quarkUrl: batch?.quarkUrl ?? '', extractionCode: batch?.extractCode ?? '', textContent: metadata?.textContent ?? '', dataContent: metadata?.dataContent ?? '', apiUrl: metadata?.apiConfig?.url ?? '', apiMethod: metadata?.apiConfig?.method ?? 'GET', apiTimeout: metadata?.apiConfig?.timeout ?? 60, apiHeaders: metadata?.apiConfig?.headers ?? '', apiParams: metadata?.apiConfig?.params ?? '', apiResponseField: metadata?.apiConfig?.responseField ?? '', imageUrls: (metadata?.imageUrls ?? []).join('\n'), delaySeconds: metadata?.delaySeconds ?? 0, deliveryCount: metadata?.deliveryCount ?? batch?.consumedCount ?? 0, description: metadata?.description ?? '', dockable: metadata?.dockable ?? false, price: metadata?.price ?? '', minPrice: metadata?.minPrice ?? '', feePayer: metadata?.feePayer ?? 'distributor', dockVisibility: metadata?.dockVisibility ?? 'public', multiSpec: metadata?.multiSpec ?? false, specName: metadata?.specName ?? '', specValue: metadata?.specValue ?? '', itemsText: '' };
}

export function CouponCreateModal({ submitting, mode = 'create', batch, onClose, onSubmit }: { submitting: boolean; mode?: 'create' | 'edit' | 'copy'; batch?: CouponBatchVM; onClose: () => void; onSubmit: (input: CreateCouponBatchRequest | UpdateCouponBatchRequest) => Promise<void> }) {
  const [form, setForm] = useState<FormState>(() => fromBatch(batch));
  const [error, setError] = useState('');
  const title = mode === 'edit' ? '编辑卡券' : mode === 'copy' ? '复制卡券' : '新建卡券';
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((previous) => ({ ...previous, [key]: value }));
  const payload = useMemo(() => {
    const metadata = { description: form.description.trim() || undefined, delaySeconds: Math.max(0, form.delaySeconds), deliveryCount: Math.max(0, form.deliveryCount), dockable: form.dockable, price: form.price.trim() || undefined, minPrice: form.minPrice.trim() || undefined, feePayer: form.dockable ? form.feePayer : undefined, dockVisibility: form.dockable ? form.dockVisibility : undefined, multiSpec: form.multiSpec, specName: form.multiSpec ? form.specName.trim() : undefined, specValue: form.multiSpec ? form.specValue.trim() : undefined, textContent: form.purpose === 'text' ? form.textContent.trim() : undefined, dataContent: form.purpose === 'data' ? form.dataContent.trim() : undefined, apiConfig: form.purpose === 'api' ? { url: form.apiUrl.trim(), method: form.apiMethod, timeout: form.apiTimeout, headers: form.apiHeaders.trim() || undefined, params: form.apiParams.trim() || undefined, responseField: form.apiResponseField.trim() || undefined } : undefined, imageUrls: form.imageUrls.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean).slice(0, 3) };
    return { accountId: form.accountId.trim(), label: form.label.trim(), purpose: form.purpose, deliveryScope: form.deliveryScope, quarkUrl: form.quarkUrl.trim() || undefined, extractionCode: form.extractionCode.trim() || undefined, metadata, items: form.itemsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) };
  }, [form]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.accountId.trim() || !form.label.trim()) { setError('请填写账号和卡券名称。'); return; }
    if (form.purpose === 'api' && !form.apiUrl.trim()) { setError('API 卡券必须填写接口地址。'); return; }
    if (form.purpose === 'text' && !form.textContent.trim() && mode === 'create') { setError('文本卡券必须填写文本内容。'); return; }
    if (form.purpose === 'data' && !form.dataContent.trim() && mode === 'create') { setError('批量数据卡券必须填写数据内容。'); return; }
    if (form.multiSpec && (!form.specName.trim() || !form.specValue.trim())) { setError('多规格卡券必须填写规格名称和规格值。'); return; }
    setError('');
    const next = mode === 'edit' ? { ...payload, items: undefined } : payload;
    await onSubmit(next);
    onClose();
  }
  return <div className="coupons-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <form className="coupons-modal card coupons-editor-modal" onSubmit={submit} aria-label={title}>
      <header><div><p className="eyebrow">Coupon Configuration</p><h2>{title}</h2><p>字段和操作与参考卡券页一致，页面视觉继续沿用当前平台风格。</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭">×</button></header>
      <div className="coupons-form-grid">
        <label>账号<input value={form.accountId} onChange={(event) => set('accountId', event.target.value)} disabled={mode === 'edit'} /></label>
        <label>卡券名称<input value={form.label} onChange={(event) => set('label', event.target.value)} placeholder="例如：会员兑换码" /></label>
        <label>卡券类型<select value={form.purpose} onChange={(event) => set('purpose', event.target.value as CouponBatchVM['purpose'])}><option value="text">文本</option><option value="data">批量数据</option><option value="api">API</option><option value="image">图片</option></select></label>
        <label>交付范围<select value={form.deliveryScope} onChange={(event) => set('deliveryScope', event.target.value as FormState['deliveryScope'])}><option value="operator_only">仅管理员</option><option value="buyer_deliverable">可交付买家</option><option value="system_only">仅系统</option></select></label>
        <label>夸克链接<input value={form.quarkUrl} onChange={(event) => set('quarkUrl', event.target.value)} /></label>
        <label>提取码<input value={form.extractionCode} onChange={(event) => set('extractionCode', event.target.value)} /></label>
        {form.purpose === 'text' && <label className="coupons-form-full">文本内容<textarea rows={5} value={form.textContent} onChange={(event) => set('textContent', event.target.value)} /></label>}
        {form.purpose === 'data' && <label className="coupons-form-full">批量数据（一行一条）<textarea rows={6} value={form.dataContent} onChange={(event) => set('dataContent', event.target.value)} /></label>}
        {form.purpose === 'api' && <div className="coupons-form-section coupons-form-full"><strong>API 配置</strong><label>接口地址<input type="url" value={form.apiUrl} onChange={(event) => set('apiUrl', event.target.value)} /></label><div className="coupons-form-grid nested"><label>请求方法<select value={form.apiMethod} onChange={(event) => set('apiMethod', event.target.value as 'GET' | 'POST')}><option value="GET">GET</option><option value="POST">POST</option></select></label><label>超时（秒）<input type="number" min={1} value={form.apiTimeout} onChange={(event) => set('apiTimeout', Number(event.target.value) || 60)} /></label></div><label>请求头（JSON）<textarea rows={3} value={form.apiHeaders} onChange={(event) => set('apiHeaders', event.target.value)} /></label><label>请求参数（JSON）<textarea rows={3} value={form.apiParams} onChange={(event) => set('apiParams', event.target.value)} /></label><label>响应取值字段<input value={form.apiResponseField} onChange={(event) => set('apiResponseField', event.target.value)} placeholder="data.cards[0].key" /></label></div>}
        {form.purpose === 'image' && <label className="coupons-form-full">图片地址（每行一个，最多 3 张）<textarea rows={4} value={form.imageUrls} onChange={(event) => set('imageUrls', event.target.value)} placeholder="https://..." /></label>}
        <label>延时发货（秒）<input type="number" min={0} max={3600} value={form.delaySeconds} onChange={(event) => set('delaySeconds', Number(event.target.value) || 0)} /></label>
        <label>已发货次数<input type="number" min={0} value={form.deliveryCount} onChange={(event) => set('deliveryCount', Number(event.target.value) || 0)} /></label>
        <label className="coupons-form-full">备注信息<textarea rows={3} value={form.description} onChange={(event) => set('description', event.target.value)} /></label>
        <label className="coupons-inline-checkbox"><input type="checkbox" checked={form.dockable} onChange={(event) => set('dockable', event.target.checked)} />可对接</label>
        {form.dockable && <><label>对接价格<input value={form.price} onChange={(event) => set('price', event.target.value)} /></label><label>最低售价<input value={form.minPrice} onChange={(event) => set('minPrice', event.target.value)} /></label><label>手续费承担方<select value={form.feePayer} onChange={(event) => set('feePayer', event.target.value as FormState['feePayer'])}><option value="distributor">分销主承担</option><option value="dealer">分销商承担</option></select></label><label>对接类型<select value={form.dockVisibility} onChange={(event) => set('dockVisibility', event.target.value as FormState['dockVisibility'])}><option value="public">所有人可见</option><option value="dealer_only">仅分销商可见</option></select></label></>}
        <label className="coupons-inline-checkbox coupons-form-full"><input type="checkbox" checked={form.multiSpec} onChange={(event) => set('multiSpec', event.target.checked)} />多规格卡券</label>
        {form.multiSpec && <><label>规格名称<input value={form.specName} onChange={(event) => set('specName', event.target.value)} /></label><label>规格值<input value={form.specValue} onChange={(event) => set('specValue', event.target.value)} /></label></>}
        {mode !== 'edit' && <label className="coupons-form-full">首批库存（每行一条）<textarea rows={4} value={form.itemsText} onChange={(event) => set('itemsText', event.target.value)} /></label>}
      </div>
      {error && <p className="coupons-form-error" role="alert">{error}</p>}
      <footer><button className="btn ghost" type="button" onClick={onClose}>取消</button><button className="btn primary" type="submit" disabled={submitting}>{submitting ? '保存中…' : '保存'}</button></footer>
    </form>
  </div>;
}
