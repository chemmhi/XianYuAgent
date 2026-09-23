import type { AutomationCoupon, ProductAutomationBatchUpdate, ProductAutomationBatchUpdateWire, ProductAutomationConfig, ProductAutomationConfigWire, ProductAutomationUpdate, ProductAutomationUpdateWire } from './types';

export interface ProductAutomationApiTransport {
  get<T>(path: string): Promise<T>;
  post?<T>(path: string, body?: unknown, options?: { headers?: Record<string, string> }): Promise<T>;
  patch?<T>(path: string, body?: unknown, options?: { headers?: Record<string, string> }): Promise<T>;
  put?<T>(path: string, body?: unknown, options?: { headers?: Record<string, string> }): Promise<T>;
}

export interface ProductAutomationApi {
  getConfig(productId: string): Promise<ProductAutomationConfig>;
  listCoupons(accountId: string, purpose?: 'delivery' | 'gift'): Promise<AutomationCoupon[]>;
  saveConfig(productId: string, input: ProductAutomationUpdate): Promise<ProductAutomationConfig>;
  saveBatch(input: ProductAutomationBatchUpdate): Promise<{ updatedCount: number }>;
}

function defaultConfig(productId: string, accountId: string): ProductAutomationConfig {
  return {
    productId,
    accountId,
    version: 1,
    delivery: { enabled: true, couponIds: ['coupon-batch-2'], autoConfirm: false },
    reprice: { enabled: false, targetPriceMinor: 990, repriceMessage: '已为您调整价格，请及时付款' },
    gift: { enabled: false, couponIds: [] },
    review: { enabled: true, reviewInitialHours: 72, reviewRepeatHours: 24, reviewMaxCount: 1, reviewMessage: '商品已经发出，如果使用满意，麻烦帮忙点个好评～' },
  };
}

export function toAutomationConfig(value: ProductAutomationConfigWire | ProductAutomationConfig): ProductAutomationConfig {
  if ('version' in value) return value;
  const record = value as ProductAutomationConfigWire & { config?: ProductAutomationConfigWire };
  const canonical = record.config ?? record;
  return {
    productId: record.productId,
    accountId: record.accountId,
    version: record.configVersion,
    delivery: { enabled: canonical.paidAutoDelivery?.enabled ?? false, couponIds: ((canonical.paidAutoDelivery as { couponBatchIds?: string[]; couponIds?: string[] } | undefined)?.couponBatchIds ?? (canonical.paidAutoDelivery as { couponBatchIds?: string[]; couponIds?: string[] } | undefined)?.couponIds ?? []), autoConfirm: Boolean((canonical.paidAutoDelivery as { autoConfirm?: boolean } | undefined)?.autoConfirm ?? false) },
    reprice: { enabled: canonical.unpaidAutoReprice?.enabled ?? false, targetPriceMinor: canonical.unpaidAutoReprice?.targetPriceMinor ?? 0, repriceMessage: (canonical.unpaidAutoReprice as { message?: string; repriceMessage?: string } | undefined)?.message ?? (canonical.unpaidAutoReprice as { message?: string; repriceMessage?: string } | undefined)?.repriceMessage ?? '' },
    gift: { enabled: canonical.reviewGift?.enabled ?? false, couponIds: ((canonical.reviewGift as { couponBatchIds?: string[]; couponIds?: string[] } | undefined)?.couponBatchIds ?? (canonical.reviewGift as { couponBatchIds?: string[]; couponIds?: string[] } | undefined)?.couponIds ?? []) },
    review: {
      enabled: canonical.reviewReminder?.enabled ?? false,
      reviewInitialHours: (canonical.reviewReminder as { firstDelayHours?: number } | undefined)?.firstDelayHours ?? 72,
      reviewRepeatHours: (canonical.reviewReminder as { repeatIntervalHours?: number } | undefined)?.repeatIntervalHours ?? 24,
      reviewMaxCount: (canonical.reviewReminder as { maxReminders?: number } | undefined)?.maxReminders ?? 1,
      reviewMessage: (canonical.reviewReminder as { message?: string; reviewMessage?: string } | undefined)?.message ?? (canonical.reviewReminder as { message?: string; reviewMessage?: string } | undefined)?.reviewMessage ?? '',
    },
    updatedAt: record.updatedAt,
  };
}

export function toAutomationConfigWire(value: ProductAutomationUpdate): ProductAutomationUpdateWire {
  return {
    configVersion: value.version,
    paidAutoDelivery: { enabled: value.delivery.enabled, couponBatchIds: value.delivery.couponIds ?? [], autoConfirm: value.delivery.autoConfirm ?? false, maxAttempts: 3, retryBackoffSeconds: 30 } as ProductAutomationUpdateWire['paidAutoDelivery'],
    unpaidAutoReprice: { enabled: value.reprice.enabled, mode: 'fixed', targetPriceMinor: value.reprice.targetPriceMinor ?? 0, message: value.reprice.repriceMessage ?? '', maxAttempts: 3, retryBackoffSeconds: 30 } as ProductAutomationUpdateWire['unpaidAutoReprice'],
    reviewGift: { enabled: value.gift.enabled, couponBatchIds: value.gift.couponIds ?? [], maxAttempts: 3, retryBackoffSeconds: 30 } as ProductAutomationUpdateWire['reviewGift'],
    reviewReminder: { enabled: value.review.enabled, firstDelayHours: value.review.reviewInitialHours ?? 72, repeatIntervalHours: value.review.reviewRepeatHours ?? 24, maxReminders: value.review.reviewMaxCount ?? 1, message: value.review.reviewMessage ?? '' } as ProductAutomationUpdateWire['reviewReminder'],
  };
}

export function toAutomationBatchWire(value: ProductAutomationBatchUpdate, expectedConfigVersions: Record<string, number> = {}): ProductAutomationBatchUpdateWire {
  const config: ProductAutomationUpdateWire = {};
  const canonical = toAutomationConfigWire({ version: undefined, delivery: value.rules.delivery, reprice: value.rules.reprice, gift: value.rules.gift, review: value.rules.review });
  if (value.apply.delivery) config.paidAutoDelivery = canonical.paidAutoDelivery;
  if (value.apply.reprice) config.unpaidAutoReprice = canonical.unpaidAutoReprice;
  if (value.apply.gift) config.reviewGift = canonical.reviewGift;
  if (value.apply.review) config.reviewReminder = canonical.reviewReminder;
  return { productIds: value.productIds, expectedConfigVersions, config };
}

function toAutomationCoupon(value: Record<string, unknown>): AutomationCoupon {
  const purpose = String(value.purpose ?? 'text');
  const availableCount = Number(value.availableCount ?? value.available ?? 0);
  const metadata = (value.metadata && typeof value.metadata === 'object' ? value.metadata : {}) as Record<string, unknown>;
  const typeLabel = purpose === 'data' ? '数据卡' : purpose === 'api' ? 'API 卡' : purpose === 'image' ? '图片卡' : '文字卡';
  const specSummary = metadata.multiSpec ? String(metadata.specName ?? '多规格') : purpose === 'api' ? '动态规格' : `${Number(metadata.specCount ?? 1)} 条规格`;
  const quantity = Number(metadata.deliveryCount ?? 1);
  return {
    id: String(value.id ?? value.batchId ?? ''),
    label: String(value.label ?? value.batchId ?? value.id ?? '未命名卡券'),
    typeLabel,
    specSummary,
    quantitySummary: `每件 ${quantity} 份`,
    stockSummary: purpose === 'api' ? '动态' : `库存 ${Number.isFinite(availableCount) ? availableCount : 0}`,
    accountId: value.accountId ? String(value.accountId) : undefined,
    apiManaged: purpose === 'api',
  };
}

export const MOCK_AUTOMATION_COUPONS: AutomationCoupon[] = [
  { id: 'coupon-batch-2', label: '批量数据2', typeLabel: '数据卡', specSummary: '2 条规格', quantitySummary: '每件 1 份', stockSummary: '库存 120' },
  { id: 'coupon-gift-a', label: '评价赠品批次 A', typeLabel: '数据卡', specSummary: '1 条规格', quantitySummary: '每件 1 份', stockSummary: '库存 80' },
  { id: 'coupon-api-member', label: 'API 卡券 · 会员激活码', typeLabel: 'API 卡', specSummary: '动态库存', quantitySummary: '规格由服务返回', stockSummary: '动态', apiManaged: true },
  { id: 'coupon-text-fixed', label: '固定文字', typeLabel: '文字卡', specSummary: '1 条内容', quantitySummary: '每件 1 份', stockSummary: '不限量' },
];

export function createMockProductAutomationApi(seed: Partial<ProductAutomationConfig> = {}): ProductAutomationApi {
  const configs = new Map<string, ProductAutomationConfig>();
  const coupons = [...MOCK_AUTOMATION_COUPONS];
  return {
    async getConfig(productId) {
      const existing = configs.get(productId);
      if (existing) return structuredClone(existing);
      const config = { ...defaultConfig(productId, 'account-001'), ...seed, productId };
      configs.set(productId, config);
      return structuredClone(config);
    },
    async listCoupons() { return structuredClone(coupons); },
    async saveConfig(productId, input) {
      const current = configs.get(productId) ?? defaultConfig(productId, 'account-001');
      const next = { ...current, ...input, productId, version: current.version + 1, updatedAt: new Date().toISOString() };
      configs.set(productId, next);
      return structuredClone(next);
    },
    async saveBatch(input) {
      for (const productId of input.productIds) {
        const current = configs.get(productId) ?? defaultConfig(productId, 'account-001');
        const next = { ...current };
        for (const key of Object.keys(input.apply) as Array<keyof typeof input.apply>) {
          if (input.apply[key]) next[key] = { ...current[key], ...input.rules[key] };
        }
        configs.set(productId, { ...next, version: current.version + 1, updatedAt: new Date().toISOString() });
      }
      return { updatedCount: input.productIds.length };
    },
  };
}

export function createProductAutomationApi(transport: ProductAutomationApiTransport, fallbackAccountId = 'account-001'): ProductAutomationApi {
  const write = async <T>(path: string, body: unknown, headers: Record<string, string>, method: 'patch' | 'put' | 'post' = 'patch'): Promise<T> => {
    const options = { headers: { ...headers, 'Idempotency-Key': `product-automation-${Date.now()}-${Math.random().toString(36).slice(2)}` } };
    if (method === 'post' && transport.post) return transport.post<T>(path, body, options);
    if (method === 'put' && transport.put) return transport.put<T>(path, body, options);
    if (method === 'patch' && transport.patch) return transport.patch<T>(path, body, options);
    if (transport.put) return transport.put<T>(path, body, options);
    if (transport.post) return transport.post<T>(path, body, options);
    throw new Error('automation write transport unavailable');
  };
  const readConfig = async (productId: string): Promise<ProductAutomationConfig> => {
    const response = await transport.get<{ data?: ProductAutomationConfigWire | ProductAutomationConfig } | ProductAutomationConfigWire | ProductAutomationConfig>(`/api/v1/products/${encodeURIComponent(productId)}/automation`);
    const payload = (response as { data?: ProductAutomationConfigWire | ProductAutomationConfig }).data ?? response as ProductAutomationConfigWire | ProductAutomationConfig;
    return toAutomationConfig(payload);
  };
    return {
    async getConfig(productId) {
      return readConfig(productId);
    },
    async listCoupons(accountId, purpose) {
      const suffix = purpose ? `&purpose=${encodeURIComponent(purpose)}` : '';
      const response = await transport.get<{ data?: { items?: Record<string, unknown>[] } | Record<string, unknown>[] } | { items?: Record<string, unknown>[] } | Record<string, unknown>[]>(`/api/v1/coupons/batches?accountId=${encodeURIComponent(accountId)}${suffix}`);
      const payload = (response as { data?: unknown }).data ?? response;
      const items = Array.isArray(payload) ? payload : ((payload as { items?: Record<string, unknown>[] }).items ?? []);
      return items.map(toAutomationCoupon);
    },
    async saveConfig(productId, input) {
      const wire = toAutomationConfigWire(input);
      const { configVersion: _configVersion, ...config } = wire;
      const headers: Record<string, string> = {};
      if (input.version !== undefined) headers['If-Match-Version'] = String(input.version);
      const response = await write<{ data?: ProductAutomationConfigWire | ProductAutomationConfig } | ProductAutomationConfigWire | ProductAutomationConfig>(`/api/v1/products/${encodeURIComponent(productId)}/automation`, { config }, headers, 'patch');
      const payload = (response as { data?: ProductAutomationConfigWire | ProductAutomationConfig }).data ?? response as ProductAutomationConfigWire | ProductAutomationConfig;
      return toAutomationConfig(payload);
    },
    async saveBatch(input) {
      const expectedConfigVersions = { ...(input.expectedConfigVersions ?? {}) };
      for (const productId of input.productIds) {
        if (expectedConfigVersions[productId] === undefined) expectedConfigVersions[productId] = (await readConfig(productId)).version;
      }
      const response = await write<{ data?: { updatedCount?: number } } | { updatedCount?: number }>('/api/v1/products/automation/batch', toAutomationBatchWire(input, expectedConfigVersions), {}, 'post');
      const envelope = response as { data?: { updatedCount?: number } };
      const data = envelope.data ?? (response as { updatedCount?: number });
      return { updatedCount: data.updatedCount ?? input.productIds.length };
    },
  };
}
