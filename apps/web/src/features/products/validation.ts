import type { ProductDraftInput, ProductDraftPatch } from './types';

export type ProductFormValues = {
  accountId: string;
  title: string;
  description: string;
  categoryCode: string;
  priceMinor: string;
};

export type ProductFormErrors = Partial<Record<keyof ProductFormValues, string>>;

export function validateProductForm(values: ProductFormValues): ProductFormErrors {
  const errors: ProductFormErrors = {};
  if (!values.accountId.trim()) errors.accountId = '缺少账号上下文，请先在 URL 中指定 accountId。';
  if (!values.title.trim()) errors.title = '商品标题不能为空。';
  if (values.title.trim().length > 200) errors.title = '商品标题不能超过 200 个字符。';
  if (values.description.length > 5000) errors.description = '商品描述不能超过 5000 个字符。';
  if (values.categoryCode.length > 64) errors.categoryCode = '分类编码不能超过 64 个字符。';
  if (values.priceMinor.trim() && (!/^\d+$/.test(values.priceMinor.trim()) || Number(values.priceMinor) < 0)) errors.priceMinor = '价格必须是非负整数（单位：分）。';
  return errors;
}

export function toDraftInput(values: ProductFormValues): ProductDraftInput {
  return {
    accountId: values.accountId.trim(),
    title: values.title.trim(),
    description: values.description.trim() || undefined,
    categoryCode: values.categoryCode.trim() || undefined,
    priceMinor: values.priceMinor.trim() ? Number(values.priceMinor.trim()) : undefined,
  };
}

export function toDraftPatch(values: ProductFormValues): ProductDraftPatch {
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    categoryCode: values.categoryCode.trim(),
    priceMinor: values.priceMinor.trim() ? Number(values.priceMinor.trim()) : undefined,
  };
}

