import type { CouponCreateFormState } from './components/CouponCreateModal';

export type CouponFieldErrors = Partial<Record<keyof CouponCreateFormState, string>>;
function validJson(value: string): boolean { if (!value.trim()) return true; try { JSON.parse(value); return true; } catch { return false; } }

export function validateCouponFields(form: CouponCreateFormState): CouponFieldErrors {
  const errors: CouponFieldErrors = {};
  if (!form.label.trim()) errors.label = '请输入卡券名称。';
  if (!form.purpose) errors.purpose = '请选择卡券类型。';
  if (form.purpose === 'text' && !form.textContent.trim()) errors.textContent = '请输入固定文字内容。';
  if (form.purpose === 'data' && !form.dataContent.trim()) errors.dataContent = '请输入批量数据。';
  if (form.purpose === 'api') {
    if (!form.apiUrl.trim()) errors.apiUrl = '请输入API地址。';
    if (!validJson(form.apiHeaders)) errors.apiHeaders = '请求头格式错误，请输入有效的JSON。';
    if (!validJson(form.apiParams)) errors.apiParams = '请求参数格式错误，请输入有效的JSON。';
  }
  if (form.multiSpec) {
    if (!form.specName.trim()) errors.specName = '多规格卡券必须填写规格名称和规格值。';
    if (!form.specValue.trim()) errors.specValue = '多规格卡券必须填写规格名称和规格值。';
  }
  if (form.purpose !== 'image' && form.description.trim() && !form.description.includes('{DELIVERY_CONTENT}')) errors.description = '非图片类型卡券的备注中必须包含 {DELIVERY_CONTENT} 变量。';
  return errors;
}

/** Legacy non-field checks represent account context and metadata without visible controls. */
export function couponContextError(form: CouponCreateFormState): string {
  if (!form.accountId.trim()) return '当前没有可用账号，请先选择或创建一个账号。';
  if (form.minPrice.trim()) {
    const minPrice = Number(form.minPrice.trim());
    if (!Number.isFinite(minPrice) || minPrice <= 0) return '最低售价必须是大于0的数字。';
    if (!/^\d+(\.\d{1,2})?$/.test(form.minPrice.trim())) return '最低售价最多保留两位小数。';
  }
  return '';
}
