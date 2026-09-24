import { useEffect, useMemo, useState } from 'react';
import type { ProductMutationError, ProductVM } from '../types';
import { toDraftInput, toDraftPatch, type ProductFormErrors } from '../validation';
import { createInitialProductPublishValues, inferProductCategory, serializeAttachments, type ProductPublishFormValues } from '../product-publish';
import { ProductPublishForm } from './ProductPublishForm';
import { ProductFormStateBoundary } from './ProductFormStateBoundary';

export function ProductDrawer({ mode, accountId, product, error, saving, onClose, onCreate, onUpdate }: { mode: 'create' | 'edit'; accountId?: string; product?: ProductVM | null; error: ProductMutationError | null; saving: boolean; onClose: () => void; onCreate: (values: ReturnType<typeof toDraftInput>) => Promise<boolean>; onUpdate: (productId: string, patch: ReturnType<typeof toDraftPatch>, version: number) => Promise<boolean> }) {
  const initialValues = useMemo<ProductPublishFormValues>(() => createInitialProductPublishValues(accountId, product), [accountId, product]);
  const [values, setValues] = useState<ProductPublishFormValues>(initialValues);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [queueState, setQueueState] = useState<'draft' | 'publishing'>('draft');
  const [optimizing, setOptimizing] = useState(false);

  useEffect(() => { setValues(initialValues); setErrors({}); setConfirmationOpen(false); setQueueState('draft'); }, [initialValues]);

  function update(field: keyof ProductPublishFormValues, value: string) {
    setValues((previous) => {
      const next = { ...previous, [field]: value } as ProductPublishFormValues;
      if (field === 'title' || field === 'description') next.categoryCode = inferProductCategory(next.title, next.description).code;
      return next;
    });
    if (errors[field as keyof ProductFormErrors]) setErrors((previous) => ({ ...previous, [field]: undefined }));
  }

  function draftInput() {
    return toDraftInput({ ...values, publishImages: serializeAttachments(values.attachments) });
  }

  function draftPatch() {
    return toDraftPatch({ ...values, publishImages: serializeAttachments(values.attachments) });
  }

  function validate(): boolean {
    const nextErrors: ProductFormErrors = {};
    if (!values.accountId.trim()) nextErrors.accountId = '缺少账号上下文，请先在账号管理选择当前账号。';
    if (!values.title.trim()) nextErrors.title = '商品标题不能为空。';
    if (values.description.length > 2000) nextErrors.description = '商品描述不能超过 2000 个字符。';
    if (!values.priceYuan.trim() || !/^\d+(?:\.\d{1,2})?$/.test(values.priceYuan.trim())) nextErrors.priceYuan = '请填写有效售价。';
    if (!values.quantity.trim() || !/^\d+$/.test(values.quantity.trim()) || Number(values.quantity) < 1) nextErrors.quantity = '库存数量必须是大于 0 的整数。';
    if (!values.location.trim()) nextErrors.location = '请填写发货地。';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function saveDraft(closeAfterSave: boolean) {
    if (!validate() || saving) return false;
    const ok = mode === 'create' ? await onCreate(draftInput()) : await onUpdate(product!.id, draftPatch(), product!.configVersion);
    if (ok && closeAfterSave) onClose();
    return ok;
  }

  async function confirmPublish() {
    setConfirmationOpen(false);
    if (!await saveDraft(false)) return;
    setQueueState('publishing');
  }

  function optimizeDescription() {
    setOptimizing(true);
    window.setTimeout(() => {
      setValues((previous) => ({ ...previous, description: previous.description.trim() ? `全新${previous.description.trim().replace(/^全新/u, '')}\n\n• 主动降噪，通勤与居家办公都更安静\n• 长效续航，支持 Type-C 充电与双设备连接\n• 成色全新未拆封，24 小时内发货，默认包邮` : '请补充商品卖点、成色、发货时效与售后说明。' }));
      setOptimizing(false);
    }, 240);
  }

  return <div className="products-detail-backdrop product-publish-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="products-detail-panel product-publish-drawer" role="dialog" aria-modal="true" aria-label={mode === 'create' ? '发布商品' : '编辑商品'}>
    <header className="product-publish-header"><div><p className="eyebrow">商品发布 / Draft</p><h2>{mode === 'create' ? '发布商品' : '编辑商品'}</h2><p>填写商品信息后，检查附件与物流并提交到当前闲鱼账号。</p></div><div className="product-publish-header-actions"><span className={`products-status products-status-${queueState === 'publishing' ? 'publishing' : 'draft'}`}>{queueState === 'publishing' ? '发布队列中' : '草稿 · 未发布'}</span><button className="icon-button" type="button" aria-label="关闭发布商品" onClick={onClose} disabled={saving}>×</button></div></header>
    <div className="product-publish-body"><ProductFormStateBoundary error={error}><ProductPublishForm values={values} errors={errors} disabled={saving} optimizing={optimizing} onChange={update} onAttachmentsChange={(attachments) => setValues((previous) => ({ ...previous, attachments }))} onOptimize={optimizeDescription} /></ProductFormStateBoundary></div>
    <footer className="product-publish-footer"><div className="product-publish-footer-hint"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v5c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6Z" /><path d="M12 8v4m0 3h.01" /></svg><span>发布后会立即同步到闲鱼，建议先检查图片、价格和描述。</span></div><div className="product-publish-footer-actions"><button className="btn ghost" type="button" onClick={() => void saveDraft(true)} disabled={saving}>{saving ? '保存中…' : '保存草稿'}</button><button className="btn primary" type="button" onClick={() => { if (validate()) setConfirmationOpen(true); }} disabled={saving}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>发布到闲鱼</button></div></footer>
    {confirmationOpen && <div className="product-publish-confirmation"><h3>确认发布到闲鱼？</h3><p>将使用当前账号发布 1 个商品，价格 ¥{values.priceYuan || '0'}，库存 {values.quantity || '0'} 件。确认后会进入服务端发布队列。</p><div className="product-publish-confirmation-actions"><button className="btn ghost" type="button" onClick={() => setConfirmationOpen(false)}>返回修改</button><button className="btn warning" type="button" onClick={() => void confirmPublish()}>确认发布</button></div></div>}
  </aside></div>;
}
