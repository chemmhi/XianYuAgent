import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type { CouponBatchVM, CouponMetadataVM, CreateCouponBatchRequest, UpdateCouponBatchRequest } from '../types';
import { SelectField } from '../../../shared/ui/SelectField';
import { InputField } from '../../../shared/ui/InputField';
import { TextAreaField } from '../../../shared/ui/TextAreaField';
import { Button } from '../../../shared/ui/Button';

const postParams = [
  { name: 'order_id', desc: '订单编号' },
  { name: 'item_id', desc: '商品编号' },
  { name: 'item_detail', desc: '商品详情' },
  { name: 'order_amount', desc: '订单金额' },
  { name: 'order_quantity', desc: '订单数量' },
  { name: 'spec_name', desc: '规格名称' },
  { name: 'spec_value', desc: '规格值' },
  { name: 'cookie_id', desc: 'cookies账号id' },
  { name: 'buyer_id', desc: '买家id' },
] as const;

export type CouponCreateFormState = {
  accountId: string; label: string; purpose: CouponBatchVM['purpose']; deliveryScope: CreateCouponBatchRequest['deliveryScope'];
  textContent: string; dataContent: string; apiUrl: string; apiMethod: 'GET' | 'POST'; apiTimeout: number; apiHeaders: string; apiParams: string; apiResponseField: string; imageUrls: string[]; delaySeconds: number; useNoLogisticsForm: boolean; deliveryCount: number; description: string; feePayer: '' | 'distributor' | 'dealer'; minPrice: string; dockVisibility: 'public' | 'dealer_only'; multiSpec: boolean; specName: string; specValue: string;
};

function fromBatch(batch?: CouponBatchVM, accountId?: string): CouponCreateFormState {
  const metadata = batch?.metadata;
  return { accountId: batch?.accountId ?? accountId ?? '', label: batch?.label ?? '', purpose: batch?.purpose ?? 'text', deliveryScope: batch?.deliveryScope ?? 'operator_only', textContent: metadata?.textContent ?? '', dataContent: metadata?.dataContent ?? '', apiUrl: metadata?.apiConfig?.url ?? '', apiMethod: metadata?.apiConfig?.method ?? 'GET', apiTimeout: metadata?.apiConfig?.timeout ?? 60, apiHeaders: metadata?.apiConfig?.headers ?? '', apiParams: metadata?.apiConfig?.params ?? '', apiResponseField: metadata?.apiConfig?.responseField ?? '', imageUrls: metadata?.imageUrls ?? [], delaySeconds: metadata?.delaySeconds ?? 0, useNoLogisticsForm: metadata?.useNoLogisticsForm ?? false, deliveryCount: metadata?.deliveryCount ?? batch?.consumedCount ?? 0, description: metadata?.description ?? '', feePayer: metadata?.feePayer ?? '', minPrice: metadata?.minPrice ?? '', dockVisibility: metadata?.dockVisibility ?? 'public', multiSpec: metadata?.multiSpec ?? false, specName: metadata?.specName ?? '', specValue: metadata?.specValue ?? '' };
}

function parseJson(value: string): boolean { if (!value.trim()) return true; try { JSON.parse(value); return true; } catch { return false; } }
function readImageAsDataUrl(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('IMAGE_READ_FAILED')); reader.onerror = () => reject(new Error('IMAGE_READ_FAILED')); reader.readAsDataURL(file); }); }

export function validateCouponForm(form: CouponCreateFormState, mode: 'create' | 'edit' | 'copy' = 'create'): string {
  if (!form.label.trim()) return '请输入卡券名称。';
  if (!form.accountId.trim()) return '当前没有可用账号，请先选择或创建一个账号。';
  if (!form.purpose) return '请选择卡券类型。';
  if (form.purpose === 'api' && !form.apiUrl.trim()) return '请输入API地址。';
  if (mode === 'create' && form.purpose === 'text' && !form.textContent.trim()) return '请输入固定文字内容。';
  if (mode === 'create' && form.purpose === 'data' && !form.dataContent.trim()) return '请输入批量数据。';
  if (form.multiSpec && (!form.specName.trim() || !form.specValue.trim())) return '多规格卡券必须填写规格名称和规格值。';
  if (mode === 'create' && form.purpose !== 'image' && form.description.trim() && !form.description.includes('{DELIVERY_CONTENT}')) return '非图片类型卡券的备注中必须包含 {DELIVERY_CONTENT} 变量。';
  if (!parseJson(form.apiHeaders)) return '请求头格式错误，请输入有效的JSON。';
  if (!parseJson(form.apiParams)) return '请求参数格式错误，请输入有效的JSON。';
  if (form.minPrice.trim()) { const minPrice = Number(form.minPrice.trim()); if (!Number.isFinite(minPrice) || minPrice <= 0) return '最低售价必须是大于0的数字。'; if (!/^\d+(\.\d{1,2})?$/.test(form.minPrice.trim())) return '最低售价最多保留两位小数。'; }
  return '';
}

export function buildCouponPayload(form: CouponCreateFormState, baseMetadata?: CouponMetadataVM): CreateCouponBatchRequest {
  const metadata: CouponMetadataVM = { ...baseMetadata, description: form.description.trim() || undefined, delaySeconds: Math.max(0, form.delaySeconds), deliveryCount: Math.max(0, form.deliveryCount), useNoLogisticsForm: form.purpose === 'text' && form.useNoLogisticsForm, feePayer: form.feePayer || undefined, minPrice: form.minPrice.trim() || undefined, dockVisibility: form.dockVisibility, multiSpec: form.multiSpec, specName: form.multiSpec ? form.specName.trim() : undefined, specValue: form.multiSpec ? form.specValue.trim() : undefined, textContent: form.purpose === 'text' ? form.textContent.trim() : undefined, dataContent: form.purpose === 'data' ? form.dataContent.trim() : undefined, apiConfig: form.purpose === 'api' ? { url: form.apiUrl.trim(), method: form.apiMethod, timeout: form.apiTimeout, headers: form.apiHeaders.trim() || undefined, params: form.apiParams.trim() || undefined, responseField: form.apiResponseField.trim() || undefined } : undefined, imageUrls: form.imageUrls.slice(0, 3) };
  return { accountId: form.accountId.trim(), label: form.label.trim(), purpose: form.purpose, deliveryScope: form.deliveryScope, metadata };
}

export function CouponCreateModal({ submitting, mode = 'create', batch, accountId, onClose, onSubmit }: { submitting: boolean; mode?: 'create' | 'edit' | 'copy'; batch?: CouponBatchVM; accountId?: string; onClose: () => void; onSubmit: (input: CreateCouponBatchRequest | UpdateCouponBatchRequest) => Promise<void> }) {
  const [form, setForm] = useState<CouponCreateFormState>(() => fromBatch(batch, accountId));
  const [error, setError] = useState('');
  const title = mode === 'edit' ? '编辑卡券' : mode === 'copy' ? '复制卡券' : '新建卡券';
  const set = <K extends keyof CouponCreateFormState>(key: K, value: CouponCreateFormState[K]) => setForm((previous) => ({ ...previous, [key]: value }));
  const payload = useMemo(() => buildCouponPayload(form, batch?.metadata), [batch?.metadata, form]);

  useEffect(() => {
    if (mode === 'create' && !form.accountId && accountId) set('accountId', accountId);
  }, [accountId, form.accountId, mode]);

  function insertParam(paramName: string) {
    let json: Record<string, string> = {};
    if (form.apiParams.trim() && form.apiParams.trim() !== '{}') { try { json = JSON.parse(form.apiParams) as Record<string, string>; } catch { json = {}; } }
    json[paramName] = `{${paramName}}`;
    set('apiParams', JSON.stringify(json, null, 2));
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('图片大小不能超过5MB。'); return; }
    try { set('imageUrls', [...form.imageUrls, await readImageAsDataUrl(file)].slice(0, 3)); setError(''); } catch { setError('图片读取失败，请重试。'); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateCouponForm(form, mode);
    if (validationError) { setError(validationError); return; }
    setError('');
    const next = mode === 'edit' ? { ...payload, items: undefined } : payload;
    try {
      await onSubmit(next);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存失败，请稍后重试。');
    }
  }

  return <div className="coupons-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <form className="coupons-modal card coupons-editor-modal" onSubmit={submit} aria-label={title}>
      <header className="coupons-modal-header"><div><p className="eyebrow">Coupon Configuration</p><h2>{title}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭">×</button></header>
      <div className="coupons-modal-scroll">
      <div className="coupons-form-grid">
        <InputField label={<span className="coupons-field-label">卡券名称</span>} required value={form.label} onChange={(event) => set('label', event.target.value)} placeholder="例如：游戏点卡、会员卡等" />
        <SelectField label="卡券类型" className="coupons-purpose-field" data-coupons-purpose-select="true" required value={form.purpose} onChange={(event) => { const purpose = event.target.value as CouponBatchVM['purpose']; set('purpose', purpose); if (purpose !== 'text') set('useNoLogisticsForm', false); }} options={[{ value: 'text', label: '固定文字' }, { value: 'data', label: '批量数据' }, { value: 'api', label: 'API接口' }, { value: 'image', label: '图片' }]} />
        {form.purpose === 'text' && <div className="coupons-form-section coupons-form-full"><strong>固定文字配置</strong><TextAreaField label="固定文字内容" rows={6} value={form.textContent} onChange={(event) => set('textContent', event.target.value)} placeholder="请输入要发送的固定文字内容..." /><label className="coupons-checkbox-row"><input type="checkbox" checked={form.useNoLogisticsForm} onChange={(event) => set('useNoLogisticsForm', event.target.checked)} /><span className="coupons-checkbox-content"><strong>填写到无需邮寄凭证</strong><small>开启后不再向买家发送卡券聊天消息</small></span></label></div>}
        {form.purpose === 'data' && <div className="coupons-form-section coupons-form-full"><strong>批量数据配置</strong><TextAreaField label="数据内容 (一行一个)" rows={8} value={form.dataContent} onChange={(event) => set('dataContent', event.target.value)} placeholder={'请输入数据，每行一个：\n卡号1:密码1\n卡号2:密码2\n或者\n兑换码1\n兑换码2'} /><p className="coupons-form-hint">支持格式：卡号:密码 或 单独的兑换码</p></div>}
        {form.purpose === 'api' && <div className="coupons-form-section coupons-form-full"><strong>API配置</strong><InputField label="API地址" type="url" value={form.apiUrl} onChange={(event) => set('apiUrl', event.target.value)} placeholder="https://api.example.com/get-card" /><div className="coupons-form-grid nested"><SelectField label="请求方法" value={form.apiMethod} onChange={(event) => set('apiMethod', event.target.value as 'GET' | 'POST')} options={[{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }]} /><InputField label="超时时间(秒)" type="number" min={1} value={form.apiTimeout} onChange={(event) => set('apiTimeout', Number(event.target.value) || 60)} /></div><TextAreaField label="请求头 (JSON格式)" rows={4} value={form.apiHeaders} onChange={(event) => set('apiHeaders', event.target.value)} placeholder={'{"Authorization": "Bearer token"}'} /><TextAreaField label="请求参数 (JSON格式)" rows={4} value={form.apiParams} onChange={(event) => set('apiParams', event.target.value)} placeholder={'{"type": "card", "count": 1}'} />{form.apiMethod === 'POST' && <div className="coupons-param-picker"><p>POST请求可用参数（点击添加）：</p><div>{postParams.map((param) => <Button key={param.name} variant="ghost" size="small" type="button" onClick={() => insertParam(param.name)} title={param.desc}><code>{param.name}</code></Button>)}</div></div>}<InputField label="响应取值字段（选填）" value={form.apiResponseField} onChange={(event) => set('apiResponseField', event.target.value)} placeholder="data.cards[0].key" /><div className="coupons-form-hint coupons-api-help"><p>当卡密藏在 JSON 的某一层里时，填写路径精确取出该值。</p><p>写法：用点号进入对象、用中括号取数组下标，例如 <code>data.cards[0].key</code>、<code>result.card</code>。数组下标只能用 <code>[0]</code>，区分大小写。</p><p><strong>以下情况请留空：</strong>接口直接返回纯文本卡密、或想要整个返回内容。留空时会自动按 <code>data → content → card</code> 取值，取不到则返回整个内容。</p><p className="coupons-form-warning">注意：接口返回纯文本时若填写本字段，会因无法解析而取值失败，请务必留空。</p></div></div>}
        <div className="coupons-form-section coupons-form-full"><strong>图片配置（可选，最多3张）</strong><div className="coupons-image-picker">{form.imageUrls.map((url, index) => <div className="coupons-image-thumb" key={url + '-' + index}><img src={url} alt={'图片' + (index + 1)} /><button type="button" className="coupons-image-remove" onClick={() => set('imageUrls', form.imageUrls.filter((_, imageIndex) => imageIndex !== index))} aria-label={'删除图片' + (index + 1)}>×</button><span>{index + 1}</span></div>)}{form.imageUrls.length < 3 && <label className="coupons-image-add"><input type="file" accept="image/*" onChange={(event) => void handleImageChange(event)} /><span aria-hidden="true">⌁</span><small>添加图片</small></label>}</div><p className="coupons-form-hint">支持JPG、PNG、GIF格式，最大5MB，最多上传3张图片（可选）</p></div>
        <InputField label="延时发货时间" type="number" min={0} max={3600} value={form.delaySeconds} onChange={(event) => set('delaySeconds', Number(event.target.value) || 0)} hint="设置自动发货的延时时间，0表示立即发货，最大3600秒(1小时)" />
        <TextAreaField fieldClassName="coupons-form-full" label="备注信息" rows={5} value={form.description} onChange={(event) => set('description', event.target.value)} placeholder={form.purpose === 'image' ? '可选的备注信息，图片发送后会发送此内容\n支持变量：{order_id} {item_id} {item_title} {buyer_name} {buyer_id} {seller_name}\n使用 ###### 分隔符可拆分为多条消息发送' : '可选的备注信息，填写后必须包含 {DELIVERY_CONTENT} 变量（必填）\n可选变量：{order_id} {item_id} {item_title} {buyer_name} {buyer_id} {seller_name}\n使用 ###### 分隔符可拆分为多条消息发送'} hint={form.purpose === 'image' ? '图片类型卡券的备注会在图片发送后作为文字内容发送。注意：图片类型不支持 {DELIVERY_CONTENT} 变量替换。支持变量：{order_id}、{item_id}、{item_title}、{buyer_name}、{buyer_id}、{seller_name}。' : '备注内容会与发货内容一起发送。非图片类型卡券填写备注时，必须包含 {DELIVERY_CONTENT} 变量。可选变量：{order_id}、{item_id}、{item_title}、{buyer_name}、{buyer_id}、{seller_name}。'} />
        <div className="coupons-form-section coupons-form-full"><label className="coupons-checkbox-row"><input type="checkbox" checked={form.multiSpec} onChange={(event) => set('multiSpec', event.target.checked)} /><span className="coupons-checkbox-content"><strong>多规格卡券</strong></span></label><p className="coupons-form-hint">开启后可以为同一商品的不同规格创建不同的卡券。<span className="coupons-form-link">不知道怎么填写？先下一单，在订单管理中可以看到规格信息。</span></p>{form.multiSpec && <><div className="coupons-form-grid nested"><InputField label="规格名称" required value={form.specName} onChange={(event) => set('specName', event.target.value)} placeholder="例如：套餐类型、颜色、尺寸" /><InputField label="规格值" required value={form.specValue} onChange={(event) => set('specValue', event.target.value)} placeholder="例如：30天、红色、XL" /></div><div className="coupons-form-note"><strong>多规格说明：</strong><ul><li>同一卡券名称可以创建多个不同规格的卡券</li><li>卡券名称+规格名称+规格值必须唯一</li><li>自动发货时会精确匹配订单规格，规格不匹配则不发货</li></ul></div></>}</div>
      </div>
      {error && <p className="coupons-form-error" role="alert">{error}</p>}
      </div>
      <footer className="coupons-modal-footer"><Button variant="ghost" type="button" onClick={onClose}>取消</Button><Button variant="primary" type="submit" disabled={submitting}>{submitting ? '保存中…' : '保存'}</Button></footer>
    </form>
  </div>;
}
