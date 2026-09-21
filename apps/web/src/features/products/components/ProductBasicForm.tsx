import type { ProductFormErrors, ProductFormValues } from '../validation';
import { InputField } from '../../../shared/ui/InputField';
import { TextAreaField } from '../../../shared/ui/TextAreaField';

export function ProductBasicForm({ values, errors, disabled, onChange }: { values: ProductFormValues; errors: ProductFormErrors; disabled?: boolean; onChange: (field: keyof ProductFormValues, value: string) => void }) {
  return <div className="product-basic-form">
    <InputField label="所属账号" value={values.accountId} readOnly disabled={disabled} hint={values.accountId ? '来自当前账号上下文，商品创建不会再次选择账号。' : '请先在账号管理选择当前账号。'} error={errors.accountId} />
    <InputField label="商品标题" value={values.title} maxLength={200} disabled={disabled} onChange={(event) => onChange('title', event.target.value)} error={errors.title} />
    <InputField label="分类编码" value={values.categoryCode} maxLength={64} disabled={disabled} onChange={(event) => onChange('categoryCode', event.target.value)} placeholder="例如 digital" error={errors.categoryCode} />
    <InputField label="价格（分）" value={values.priceMinor} inputMode="numeric" disabled={disabled} onChange={(event) => onChange('priceMinor', event.target.value)} placeholder="例如 3990" error={errors.priceMinor} />
    <TextAreaField fieldClassName="product-basic-form-wide" label="商品描述" value={values.description} maxLength={5000} disabled={disabled} onChange={(event) => onChange('description', event.target.value)} rows={6} error={errors.description} />
  </div>;
}
