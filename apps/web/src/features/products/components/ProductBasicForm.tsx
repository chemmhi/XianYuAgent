import type { ProductFormErrors, ProductFormValues } from '../validation';

export function ProductBasicForm({ values, errors, disabled, onChange }: { values: ProductFormValues; errors: ProductFormErrors; disabled?: boolean; onChange: (field: keyof ProductFormValues, value: string) => void }) {
  return <div className="product-basic-form">
    <label><span>所属账号</span><input value={values.accountId} readOnly disabled={disabled} aria-label="所属账号" /><small>{values.accountId ? '来自当前账号上下文，商品创建不会再次选择账号。' : '请先在账号管理选择当前账号。'}</small>{errors.accountId && <em>{errors.accountId}</em>}</label>
    <label><span>商品标题</span><input value={values.title} maxLength={200} disabled={disabled} onChange={(event) => onChange('title', event.target.value)} aria-label="商品标题" />{errors.title && <em>{errors.title}</em>}</label>
    <label><span>分类编码</span><input value={values.categoryCode} maxLength={64} disabled={disabled} onChange={(event) => onChange('categoryCode', event.target.value)} aria-label="分类编码" placeholder="例如 digital" />{errors.categoryCode && <em>{errors.categoryCode}</em>}</label>
    <label><span>价格（分）</span><input value={values.priceMinor} inputMode="numeric" disabled={disabled} onChange={(event) => onChange('priceMinor', event.target.value)} aria-label="价格（分）" placeholder="例如 3990" />{errors.priceMinor && <em>{errors.priceMinor}</em>}</label>
    <label className="product-basic-form-wide"><span>商品描述</span><textarea value={values.description} maxLength={5000} disabled={disabled} onChange={(event) => onChange('description', event.target.value)} aria-label="商品描述" rows={6} />{errors.description && <em>{errors.description}</em>}</label>
  </div>;
}
