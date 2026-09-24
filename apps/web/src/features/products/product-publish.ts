import type { ProductPublishImageMeta, ProductPublishMeta, ProductVM } from './types';

export type PublishAttachment = ProductPublishImageMeta & {
  id: string;
  url: string;
  file?: File;
};

export type ProductPublishFormValues = {
  accountId: string;
  title: string;
  description: string;
  categoryCode: string;
  priceMinor: string;
  priceYuan: string;
  originalPriceYuan: string;
  quantity: string;
  postageMode: 'seller' | 'buyer';
  postageYuan: string;
  location: string;
  attachments: PublishAttachment[];
};

export const DEFAULT_PRODUCT_DESCRIPTION = '全新降噪蓝牙耳机 Pro，通勤和居家都适合。\n• 主动降噪，地铁 / 飞机环境更安静\n• 单次续航约 8 小时，充电盒可补电 3 次\n• 支持双设备连接，Type-C 充电\n\n成色：全新未拆封｜发货：24 小时内';

export function formatYuan(minor?: number): string {
  return minor === undefined ? '' : (minor / 100).toFixed(2).replace(/\.00$/, '');
}

export function inferProductCategory(title: string, description: string): { code: string; label: string; hint: string } {
  const text = `${title} ${description}`;
  if (/耳机|蓝牙|降噪|音箱/u.test(text)) return { code: 'digital.audio', label: '数码 › 耳机 / 音箱', hint: '已根据商品描述自动选择' };
  if (/收纳|家居|盒子/u.test(text)) return { code: 'home.storage', label: '家居 › 收纳', hint: '已根据商品描述自动选择' };
  if (/保温杯|水杯|杯子/u.test(text)) return { code: 'home.kitchen', label: '家居 › 厨具 / 水具', hint: '已根据商品描述自动选择' };
  return { code: '', label: '待识别', hint: '继续完善标题或描述后自动选择' };
}

export function publishMetaFromProduct(product?: ProductVM | null): ProductPublishMeta {
  const raw = product?.attributesJson?.publish;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  return {
    originalPriceMinor: typeof value.originalPriceMinor === 'number' ? value.originalPriceMinor : undefined,
    quantity: typeof value.quantity === 'number' ? value.quantity : undefined,
    postageMode: value.postageMode === 'buyer' ? 'buyer' : 'seller',
    postageMinor: typeof value.postageMinor === 'number' ? value.postageMinor : undefined,
    location: typeof value.location === 'string' ? value.location : undefined,
    images: Array.isArray(value.images) ? value.images.filter((item): item is ProductPublishImageMeta => Boolean(item && typeof item === 'object' && typeof (item as ProductPublishImageMeta).name === 'string' && typeof (item as ProductPublishImageMeta).mimeType === 'string')) : [],
  };
}

export function createInitialProductPublishValues(accountId?: string, product?: ProductVM | null): ProductPublishFormValues {
  const meta = publishMetaFromProduct(product);
  const category = inferProductCategory(product?.title ?? '', product?.description ?? '');
  return {
    accountId: product?.accountId ?? accountId ?? '',
    title: product?.title ?? '',
    description: product?.description ?? '',
    categoryCode: product?.categoryCode ?? category.code,
    priceMinor: product?.priceMinor === undefined ? '' : String(product.priceMinor),
    priceYuan: formatYuan(product?.priceMinor),
    originalPriceYuan: formatYuan(meta.originalPriceMinor),
    quantity: meta.quantity === undefined ? '' : String(meta.quantity),
    postageMode: meta.postageMode ?? 'seller',
    postageYuan: formatYuan(meta.postageMinor),
    location: meta.location ?? '',
    attachments: [],
  };
}

export function serializeAttachments(attachments: PublishAttachment[]): ProductPublishImageMeta[] {
  return attachments.map(({ id: _id, url: _url, file: _file, ...meta }) => meta);
}
