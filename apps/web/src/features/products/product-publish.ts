import type { ProductPublishImageMeta, ProductPublishMeta, ProductVM } from './types';

export type PublishAttachment = ProductPublishImageMeta & {
  id: string;
  url: string;
  file?: File;
};

export type ProductPostageMode = 'free' | 'distance' | 'fixed' | 'none';

export type ProductPublishSpec = {
  label: string;
  value: string;
  source: 'description' | 'image' | 'official';
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
  postageMode: ProductPostageMode;
  postageYuan: string;
  location: string;
  attachments: PublishAttachment[];
};

export const DEFAULT_PRODUCT_DESCRIPTION = '全新降噪蓝牙耳机 Pro，通勤和居家都适合。\n• 主动降噪，地铁 / 飞机环境更安静\n• 单次续航约 8 小时，充电盒可补电 3 次\n• 支持双设备连接，Type-C 充电\n\n成色：全新未拆封｜发货：24 小时内';

export function formatYuan(minor?: number): string {
  return minor === undefined ? '' : (minor / 100).toFixed(2).replace(/\.00$/, '');
}

export function yuanToMinor(value?: string): number | undefined {
  if (!value?.trim()) return undefined;
  const numeric = Number(value.trim());
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric * 100) : undefined;
}

export function inferProductCategory(title: string, description: string): { code: string; label: string; hint: string } {
  const text = `${title} ${description}`;
  if (/耳机|蓝牙|降噪|音箱/u.test(text)) return { code: 'digital.audio', label: '数码 › 耳机 / 音箱', hint: '已根据商品描述自动选择' };
  if (/收纳|家居|盒子/u.test(text)) return { code: 'home.storage', label: '家居 › 收纳', hint: '已根据商品描述自动选择' };
  if (/保温杯|水杯|杯子/u.test(text)) return { code: 'home.kitchen', label: '家居 › 厨具 / 水具', hint: '已根据商品描述自动选择' };
  return { code: '', label: '待识别', hint: '继续完善标题或描述后自动选择' };
}

export function inferProductSpecs(title: string, description: string, attachments: PublishAttachment[]): ProductPublishSpec[] {
  const text = `${title} ${description}`.trim();
  const specs: ProductPublishSpec[] = [];
  const category = inferProductCategory(title, description);
  if (category.label !== '待识别') specs.push({ label: '类目', value: category.label, source: 'official' });
  const condition = text.match(/全新未拆封|全新|九成新|八成新|二手|轻微使用痕迹/u)?.[0];
  if (condition) specs.push({ label: '成色', value: condition, source: 'description' });
  const size = text.match(/(?:尺码|码数)\s*[:：]?\s*(XS|S|M|L|XL|XXL|均码)/iu)?.[1] ?? text.match(/\b(XXL|XL|XS|M|L|S)\b/u)?.[1];
  if (size) specs.push({ label: '尺码', value: size.toUpperCase(), source: 'description' });
  const color = text.match(/(?:颜色|色系)\s*[:：]?\s*(黑色|白色|蓝色|红色|粉色|绿色|灰色|米色|杏色)/u)?.[1];
  if (color) specs.push({ label: '颜色', value: color, source: 'description' });
  if (attachments.length > 0) specs.push({ label: '图片', value: `${attachments.length} 张，发布时交给闲鱼官方识别`, source: 'image' });
  if (specs.length === 0) specs.push({ label: '规格', value: '补充图片或描述后自动确认', source: 'official' });
  return specs;
}

function normalizePostageMode(value: unknown): ProductPostageMode {
  if (value === 'distance') return 'distance';
  if (value === 'fixed' || value === 'buyer') return 'fixed';
  if (value === 'none') return 'none';
  return 'free';
}

export function publishMetaFromProduct(product?: ProductVM | null): ProductPublishMeta {
  const raw = product?.attributesJson?.publish;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  return {
    originalPriceMinor: typeof value.originalPriceMinor === 'number' ? value.originalPriceMinor : undefined,
    quantity: typeof value.quantity === 'number' ? value.quantity : undefined,
    postageMode: normalizePostageMode(value.postageMode),
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
    postageMode: normalizePostageMode(meta.postageMode),
    postageYuan: formatYuan(meta.postageMinor),
    location: meta.location ?? '',
    attachments: [],
  };
}

export function serializeAttachments(attachments: PublishAttachment[]): ProductPublishImageMeta[] {
  return attachments.map(({ id: _id, url: _url, file: _file, ...meta }) => meta);
}
