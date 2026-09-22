import type { AutomationCoupon, AutomationRuleState, ProductAutomationBatchUpdate, ProductAutomationBatchUpdateWire, ProductAutomationConfig, ProductAutomationConfigWire, ProductAutomationUpdate, ProductAutomationUpdateWire } from './types';

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
  const source = value.config ?? {
    paidAutoDelivery: value.paidAutoDelivery ?? { enabled: false, couponBatchIds: [] },
    unpaidAutoReprice: value.unpaidAutoReprice ?? { enabled: false, targetPriceMinor: 0 },
    reviewGift: value.reviewGift ?? { enabled: false, couponBatchIds: [] },
    reviewReminder: value.reviewReminder ?? { enabled: false, firstDelayHours: 72, repeatIntervalHours: 24, maxReminders: 1, message: '如果使用满意，欢迎给个好评，谢谢支持～' },
  };
  return {
    productId: value.productId,
    accountId: value.accountId,
    version: value.configVersion,
    delivery: fromDeliveryRule(source.paidAutoDelivery),
    reprice: fromRepriceRule(source.unpaidAutoReprice),
    gift: fromGiftRule(source.reviewGift),
    review: fromReminderRule(source.reviewReminder),
    updatedAt: value.updatedAt,
  };
}

export function toAutomationConfigWire(value: ProductAutomationUpdate): ProductAutomationUpdateWire {
  return {
    configVersion: value.version,
    paidAutoDelivery: toDeliveryRule(value.delivery),
    unpaidAutoReprice: toRepriceRule(value.reprice),
    reviewGift: toGiftRule(value.gift),
    reviewReminder: toReminderRule(value.review),
  };
}

export function toAutomationBatchWire(value: ProductAutomationBatchUpdate, expectedConfigVersions: Record<string, number> = {}): ProductAutomationBatchUpdateWire {
  const config: ProductAutomationUpdateWire = {};
  if (value.apply.delivery) config.paidAutoDelivery = toDeliveryRule(value.rules.delivery);
  if (value.apply.reprice) config.unpaidAutoReprice = toRepriceRule(value.rules.reprice);
  if (value.apply.gift) config.reviewGift = toGiftRule(value.rules.gift);
  if (value.apply.review) config.reviewReminder = toReminderRule(value.rules.review);
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
    if (method === 'post' && transport.post) return transport.post<T>(path, body, options);
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
      const response = await transport.get<{ data?: { items?: Record<string, unknown>[] } | Record<string, unknown>[] } | { items?: Record<string, unknown>[] } | Record<string, unknown>[]>(`/api/v1/coupons/batches?accountId=${encodeURIComponent(accountId)}`);
      const payload = (response as { data?: unknown }).data ?? response;
      const items = Array.isArray(payload) ? payload : ((payload as { items?: Record<string, unknown>[] }).items ?? []);
      return items.map(mapCoupon).filter((coupon) => coupon.deliveryScope === 'buyer_deliverable' || purpose === undefined).map(({ deliveryScope: _deliveryScope, ...coupon }) => coupon);
    },
    async saveConfig(productId, input) {
      const wire = toAutomationConfigWire(input);
      const headers: Record<string, string> = {};
      if (input.version !== undefined) headers['If-Match-Version'] = String(input.version);
      const response = await write<{ data?: ProductAutomationConfigWire | ProductAutomationConfig } | ProductAutomationConfigWire | ProductAutomationConfig>(`/api/v1/products/${encodeURIComponent(productId)}/automation`, { config: wire }, headers, 'patch');
      const payload = (response as { data?: ProductAutomationConfigWire | ProductAutomationConfig }).data ?? response as ProductAutomationConfigWire | ProductAutomationConfig;
      return toAutomationConfig(payload);
    },
    async saveBatch(input) {
      const response = await write<{ data?: { updatedCount?: number } } | { updatedCount?: number }>('/api/v1/products/automation/batch', toAutomationBatchWire(input, input.expectedConfigVersions), {}, 'post');
      const envelope = response as { data?: { updatedCount?: number } };
      const data = envelope.data ?? (response as { updatedCount?: number });
      return { updatedCount: data.updatedCount ?? input.productIds.length };
    },
  };
}

function fromDeliveryRule(rule: AutomationRuleState): AutomationRuleState {
  return { ...rule, couponIds: rule.couponIds ?? rule.couponBatchIds ?? [] };
}

function fromRepriceRule(rule: AutomationRuleState): AutomationRuleState {
  return { ...rule, repriceMessage: rule.repriceMessage ?? rule.message ?? '' };
}

function fromGiftRule(rule: AutomationRuleState): AutomationRuleState {
  return { ...rule, couponIds: rule.couponIds ?? rule.couponBatchIds ?? [] };
}

function fromReminderRule(rule: AutomationRuleState): AutomationRuleState {
  return {
    ...rule,
    reviewInitialHours: rule.reviewInitialHours ?? rule.firstDelayHours ?? 72,
    reviewRepeatHours: rule.reviewRepeatHours ?? rule.repeatIntervalHours ?? 24,
    reviewMaxCount: rule.reviewMaxCount ?? rule.maxReminders ?? 1,
    reviewMessage: rule.reviewMessage ?? rule.message ?? '',
  };
}

function toDeliveryRule(rule: AutomationRuleState): AutomationRuleState {
  return { enabled: rule.enabled, couponBatchIds: rule.couponBatchIds ?? rule.couponIds ?? [], autoConfirm: rule.autoConfirm ?? false, maxAttempts: rule.maxAttempts ?? 3, retryBackoffSeconds: rule.retryBackoffSeconds ?? 30 };
}

function toRepriceRule(rule: AutomationRuleState): AutomationRuleState {
  return { enabled: rule.enabled, mode: rule.mode ?? 'fixed', targetPriceMinor: rule.targetPriceMinor ?? 0, message: rule.message ?? rule.repriceMessage ?? '', maxAttempts: rule.maxAttempts ?? 3, retryBackoffSeconds: rule.retryBackoffSeconds ?? 30 };
}

function toGiftRule(rule: AutomationRuleState): AutomationRuleState {
  return { enabled: rule.enabled, couponBatchIds: rule.couponBatchIds ?? rule.couponIds ?? [], maxAttempts: rule.maxAttempts ?? 3, retryBackoffSeconds: rule.retryBackoffSeconds ?? 30 };
}

function toReminderRule(rule: AutomationRuleState): AutomationRuleState {
  return { enabled: rule.enabled, firstDelayHours: rule.firstDelayHours ?? rule.reviewInitialHours ?? 72, repeatIntervalHours: rule.repeatIntervalHours ?? rule.reviewRepeatHours ?? 24, maxReminders: rule.maxReminders ?? rule.reviewMaxCount ?? 1, message: rule.message ?? rule.reviewMessage ?? '' };
}

function mapCoupon(value: Record<string, unknown>): AutomationCoupon & { deliveryScope?: string } {
  const metadata = value.metadata && typeof value.metadata === 'object' ? value.metadata as Record<string, unknown> : {};
  const availableCount = typeof value.availableCount === 'number' ? value.availableCount : undefined;
  const deliveryScope = typeof value.deliveryScope === 'string' ? value.deliveryScope : undefined;
  const label = typeof value.label === 'string' && value.label.trim() ? value.label : String(value.purpose ?? '未命名卡券');
  return {
    id: String(value.batchId ?? value.id ?? ''),
    label,
    typeLabel: typeof value.purpose === 'string' ? `${value.purpose} 卡` : '卡券',
    specSummary: metadata.specValue ? `规格 ${String(metadata.specValue)}` : '默认规格',
    quantitySummary: metadata.deliveryCount ? `每件 ${String(metadata.deliveryCount)} 份` : '每件 1 份',
    stockSummary: availableCount === undefined ? '库存待同步' : `库存 ${availableCount}`,
    accountId: typeof value.accountId === 'string' ? value.accountId : undefined,
    apiManaged: value.purpose === 'api',
    deliveryScope,
  };
}
