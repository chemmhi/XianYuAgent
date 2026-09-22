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
    delivery: { enabled: true, couponIds: ['coupon-batch-2'] },
    reprice: { enabled: false, targetPriceMinor: 990, repriceMessage: '已为您调整价格，请及时付款' },
    gift: { enabled: false, couponIds: ['coupon-gift-a'] },
    review: { enabled: true, reviewInitialHours: 72, reviewRepeatHours: 24, reviewMaxCount: 1, reviewMessage: '商品已经发出，如果使用满意，麻烦帮忙点个好评～' },
  };
}

export function toAutomationConfig(value: ProductAutomationConfigWire | ProductAutomationConfig): ProductAutomationConfig {
  if ('version' in value) return value;
  return { productId: value.productId, accountId: value.accountId, version: value.configVersion, delivery: value.paidAutoDelivery, reprice: value.unpaidAutoReprice, gift: value.reviewGift, review: value.reviewReminder, updatedAt: value.updatedAt };
}

export function toAutomationConfigWire(value: ProductAutomationUpdate): ProductAutomationUpdateWire {
  return { configVersion: value.version, paidAutoDelivery: value.delivery, unpaidAutoReprice: value.reprice, reviewGift: value.gift, reviewReminder: value.review };
}

export function toAutomationBatchWire(value: ProductAutomationBatchUpdate, expectedConfigVersions: Record<string, number> = {}): ProductAutomationBatchUpdateWire {
  const config: ProductAutomationUpdateWire = {};
  if (value.apply.delivery) config.paidAutoDelivery = value.rules.delivery;
  if (value.apply.reprice) config.unpaidAutoReprice = value.rules.reprice;
  if (value.apply.gift) config.reviewGift = value.rules.gift;
  if (value.apply.review) config.reviewReminder = value.rules.review;
  return { productIds: value.productIds, expectedConfigVersions, config };
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
    if (method === 'put' && transport.put) return transport.put<T>(path, body, options);
    if (transport.patch) return transport.patch<T>(path, body, options);
    if (transport.put) return transport.put<T>(path, body, options);
    if (transport.post) return transport.post<T>(path, body, options);
    throw new Error('automation write transport unavailable');
  };
    return {
    async getConfig(productId) {
      const response = await transport.get<{ data?: ProductAutomationConfigWire | ProductAutomationConfig } | ProductAutomationConfigWire | ProductAutomationConfig>(`/api/v1/products/${encodeURIComponent(productId)}/automation`);
      const payload = (response as { data?: ProductAutomationConfigWire | ProductAutomationConfig }).data ?? response as ProductAutomationConfigWire | ProductAutomationConfig;
      return toAutomationConfig(payload);
    },
    async listCoupons(accountId, purpose) {
      const suffix = purpose ? `&purpose=${encodeURIComponent(purpose)}` : '';
      const response = await transport.get<{ data?: { items?: AutomationCoupon[] } | AutomationCoupon[] } | { items?: AutomationCoupon[] } | AutomationCoupon[]>(`/api/v1/coupons/batches?accountId=${encodeURIComponent(accountId)}${suffix}`);
      const payload = (response as { data?: unknown }).data ?? response;
      return Array.isArray(payload) ? payload : ((payload as { items?: AutomationCoupon[] }).items ?? []);
    },
    async saveConfig(productId, input) {
      const wire = toAutomationConfigWire(input);
      const headers: Record<string, string> = {};
      if (input.version !== undefined) headers['If-Match-Version'] = String(input.version);
      const response = await write<{ data?: ProductAutomationConfigWire | ProductAutomationConfig } | ProductAutomationConfigWire | ProductAutomationConfig>(`/api/v1/products/${encodeURIComponent(productId)}/automation`, wire, headers, 'patch');
      const payload = (response as { data?: ProductAutomationConfigWire | ProductAutomationConfig }).data ?? response as ProductAutomationConfigWire | ProductAutomationConfig;
      return toAutomationConfig(payload);
    },
    async saveBatch(input) {
      const response = await write<{ data?: { updatedCount?: number } } | { updatedCount?: number }>('/api/v1/products/automation/batch', toAutomationBatchWire(input, input.expectedConfigVersions), {}, 'patch');
      const envelope = response as { data?: { updatedCount?: number } };
      const data = envelope.data ?? (response as { updatedCount?: number });
      return { updatedCount: data.updatedCount ?? input.productIds.length };
    },
  };
}
