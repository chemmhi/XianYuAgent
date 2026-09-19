import { useEffect, useMemo, useState } from 'react';
import type { ProductMutationError, ProductVM } from '../types';
import { toDraftInput, toDraftPatch, type ProductFormErrors, type ProductFormValues, validateProductForm } from '../validation';
import { ProductBasicForm } from './ProductBasicForm';
import { ProductFormStateBoundary } from './ProductFormStateBoundary';

export function ProductDrawer({ mode, accountId, product, error, saving, onClose, onCreate, onUpdate }: { mode: 'create' | 'edit'; accountId?: string; product?: ProductVM | null; error: ProductMutationError | null; saving: boolean; onClose: () => void; onCreate: (values: ReturnType<typeof toDraftInput>) => Promise<boolean>; onUpdate: (productId: string, patch: ReturnType<typeof toDraftPatch>, version: number) => Promise<boolean> }) {
  const initialValues = useMemo<ProductFormValues>(() => ({ accountId: product?.accountId ?? accountId ?? '', title: product?.title ?? '', description: product?.description ?? '', categoryCode: product?.categoryCode ?? '', priceMinor: product?.priceMinor === undefined ? '' : String(product.priceMinor) }), [accountId, product]);
  const [values, setValues] = useState<ProductFormValues>(initialValues);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  useEffect(() => { setValues(initialValues); setErrors({}); }, [initialValues]);

  function update(field: keyof ProductFormValues, value: string) { setValues((previous) => ({ ...previous, [field]: value })); if (errors[field]) setErrors((previous) => ({ ...previous, [field]: undefined })); }
  async function submit() {
    const nextErrors = validateProductForm(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || saving) return;
    const ok = mode === 'create' ? await onCreate(toDraftInput(values)) : await onUpdate(product!.id, toDraftPatch(values), product!.configVersion);
    if (ok) onClose();
  }

  return <div className="products-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="products-detail-panel product-drawer" role="dialog" aria-modal="true" aria-label={mode === 'create' ? '新建商品草稿' : '编辑商品草稿'}><header><div><p className="eyebrow">{mode === 'create' ? 'Create Draft' : 'Edit Draft'}</p><h2>{mode === 'create' ? '新建商品草稿' : '编辑商品草稿'}</h2></div><button className="icon-button" type="button" aria-label="关闭商品编辑" onClick={onClose}>×</button></header><ProductFormStateBoundary error={error}><ProductBasicForm values={values} errors={errors} disabled={saving} onChange={update} /></ProductFormStateBoundary><div className="product-drawer-note">仅编辑基础字段；状态固定为草稿，SKU、素材、发布和回复策略在后续切片接入。</div><footer className="modal-actions"><button className="btn ghost" type="button" onClick={onClose} disabled={saving}>取消</button><button className="btn primary" type="button" onClick={() => void submit()} disabled={saving || !values.accountId.trim()}>{saving ? '保存中…' : '保存草稿'}</button></footer></aside></div>;
}

