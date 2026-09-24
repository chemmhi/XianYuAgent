import type { ProductDraftInput, ProductDraftPatch, ProductPublishImageMeta } from './types';
import { yuanToMinor } from './product-publish';

export type ProductFormValues = {
  accountId: string;
  title: string;
  description: string;
  categoryCode: string;
  priceMinor: string;
  priceYuan?: string;
  originalPriceYuan?: string;
  quantity?: string;
  postageMode?: 'free' | 'distance' | 'fixed' | 'none' | 'seller' | 'buyer';
  postageYuan?: string;
  location?: string;
  publishImages?: ProductPublishImageMeta[];
};

export type ProductFormErrors = Partial<Record<keyof ProductFormValues, string>>;

export function validateProductForm(values: ProductFormValues): ProductFormErrors {
  const errors: ProductFormErrors = {};
  if (!values.accountId.trim()) errors.accountId = '缺少账号上下文，请先在 URL 中指定 accountId。';
  if (!values.title.trim()) errors.title = '商品标题不能为空。';
  if (values.title.trim().length > 200) errors.title = '商品标题不能超过 200 个字符。';
  if (values.description.length > 5000) errors.description = '商品描述不能超过 5000 个字符。';
  if (values.categoryCode.length > 64) errors.categoryCode = '分类编码不能超过 64 个字符。';
  if (values.priceYuan !== undefined) {
    if (values.priceYuan.trim() && (!/^\d+(?:\.\d{1,2})?$/.test(values.priceYuan.trim()) || Number(values.priceYuan) < 0)) errors.priceYuan = '售价必须是非负金额，最多保留 2 位小数。';
    if (values.originalPriceYuan?.trim() && (!/^\d+(?:\.\d{1,2})?$/.test(values.originalPriceYuan.trim()) || Number(values.originalPriceYuan) < 0)) errors.originalPriceYuan = '原价必须是非负金额，最多保留 2 位小数。';
    if (values.quantity?.trim() && (!/^\d+$/.test(values.quantity.trim()) || Number(values.quantity) < 1)) errors.quantity = '库存数量必须是大于 0 的整数。';
    if (values.postageYuan?.trim() && (!/^\d+(?:\.\d{1,2})?$/.test(values.postageYuan.trim()) || Number(values.postageYuan) < 0)) errors.postageYuan = '邮费必须是非负金额，最多保留 2 位小数。';
    if ((values.postageMode === 'fixed' || values.postageMode === 'buyer') && !values.postageYuan?.trim()) errors.postageYuan = '一口价模式必须填写邮费。';
  } else if (values.priceMinor.trim() && (!/^\d+$/.test(values.priceMinor.trim()) || Number(values.priceMinor) < 0)) errors.priceMinor = '价格必须是非负整数（单位：分）。';
  return errors;
}

function publishMeta(values: ProductFormValues) {
  if (values.priceYuan === undefined && values.originalPriceYuan === undefined && values.quantity === undefined && values.postageMode === undefined && values.postageYuan === undefined && values.location === undefined && values.publishImages === undefined) return undefined;
  return {
    originalPriceMinor: yuanToMinor(values.originalPriceYuan),
    quantity: values.quantity?.trim() ? Number(values.quantity.trim()) : undefined,
    postageMode: values.postageMode ?? 'free',
    postageMinor: yuanToMinor(values.postageYuan),
    location: values.location?.trim() || undefined,
    images: values.publishImages ?? [],
  };
}

export function toDraftInput(values: ProductFormValues): ProductDraftInput {
  const legacyPriceMinor = values.priceYuan !== undefined ? yuanToMinor(values.priceYuan) : (values.priceMinor.trim() ? Number(values.priceMinor.trim()) : undefined);
  const meta = publishMeta(values);
  return {
    accountId: values.accountId.trim(),
    title: values.title.trim(),
    description: values.description.trim() || undefined,
    categoryCode: values.categoryCode.trim() || undefined,
    priceMinor: legacyPriceMinor,
    ...(meta ? { publishMeta: meta } : {}),
  };
}

export function toDraftPatch(values: ProductFormValues): ProductDraftPatch {
  const legacyPriceMinor = values.priceYuan !== undefined ? yuanToMinor(values.priceYuan) : (values.priceMinor.trim() ? Number(values.priceMinor.trim()) : undefined);
  const meta = publishMeta(values);
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    categoryCode: values.categoryCode.trim(),
    priceMinor: legacyPriceMinor,
    ...(meta ? { publishMeta: meta } : {}),
  };
}

