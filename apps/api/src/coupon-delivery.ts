import type { CouponApiConfig, CouponBatchRecord, CouponReservationItemRecord } from './domain.js';

export type CouponDeliveryPurpose = 'delivery' | 'gift';

export interface CouponDeliveryContext {
  orderId: string;
  itemId: string;
  itemTitle: string;
  buyerName: string;
  buyerId: string;
  sellerName: string;
  specName: string;
  specValue: string;
  orderAmount: string;
  orderQuantity: string;
}

export interface CouponDeliveryResolution {
  text?: string;
  imageUrls: string[];
  delaySeconds: number;
  useNoLogisticsForm: boolean;
  formText?: string;
}

export interface CouponDeliveryFetchOptions {
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  retryDelayMs?: number;
}

const DEFAULT_API_TIMEOUT_SECONDS = 10;
const DEFAULT_API_MAX_ATTEMPTS = 4;

export async function resolveCouponDelivery(
  batch: CouponBatchRecord,
  item: CouponReservationItemRecord | undefined,
  context: CouponDeliveryContext,
  purpose: CouponDeliveryPurpose,
  options: CouponDeliveryFetchOptions = {},
): Promise<CouponDeliveryResolution> {
  const metadata = batch.metadata ?? {};
  let text: string | undefined;
  if (batch.purpose === 'text') {
    text = metadata.textContent?.trim() || item?.content?.trim() || undefined;
  } else if (batch.purpose === 'data') {
    text = item?.content?.trim() || undefined;
  } else if (batch.purpose === 'api') {
    text = await fetchApiCouponContent(metadata.apiConfig, context, options);
  }

  const description = replaceOrderVariables(metadata.description?.trim() ?? '', context);
  if (batch.purpose !== 'image' && description) text = composeDescription(text ?? '', metadata.description ?? '', context);
  else if (batch.purpose === 'image' && description) text = description;

  const useNoLogisticsForm = purpose === 'delivery' && metadata.useNoLogisticsForm === true;
  if (useNoLogisticsForm && (batch.purpose !== 'text' || !metadata.textContent?.trim())) throw new Error('NO_LOGISTICS_FORM_INVALID');

  return {
    text: text?.trim() || undefined,
    imageUrls: (metadata.imageUrls ?? []).filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim()),
    delaySeconds: Math.max(0, Number(metadata.delaySeconds ?? 0) || 0),
    useNoLogisticsForm,
    formText: useNoLogisticsForm ? metadata.textContent?.trim() : undefined,
  };
}

export function buildCouponContext(input: Partial<CouponDeliveryContext> = {}): CouponDeliveryContext {
  return {
    orderId: input.orderId ?? '',
    itemId: input.itemId ?? '',
    itemTitle: input.itemTitle ?? '',
    buyerName: input.buyerName ?? '',
    buyerId: input.buyerId ?? '',
    sellerName: input.sellerName ?? '',
    specName: input.specName ?? '',
    specValue: input.specValue ?? '',
    orderAmount: input.orderAmount ?? '',
    orderQuantity: input.orderQuantity ?? '',
  };
}

export function parseSkuSpec(value?: string): { specName: string; specValue: string } {
  const normalized = value?.trim() ?? '';
  if (!normalized) return { specName: '', specValue: '' };
  const separator = normalized.indexOf(':');
  if (separator < 0) return { specName: '', specValue: normalized };
  return { specName: normalized.slice(0, separator).trim(), specValue: normalized.slice(separator + 1).trim() };
}

export function splitDataContent(value?: string): string[] {
  return (value ?? '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function composeDescription(content: string, description: string, context: CouponDeliveryContext): string {
  const hasVariable = /\{(?:DELIVERY_CONTENT|order_id|item_id|item_title|buyer_name|buyer_id|seller_name|spec_name|spec_value|order_amount|order_quantity)\}/u.test(description);
  const processed = replaceOrderVariables(description.replaceAll('{DELIVERY_CONTENT}', content), context).trim();
  return hasVariable ? processed : [processed, content].filter(Boolean).join('\n\n');
}

export function replaceOrderVariables(value: string, context: CouponDeliveryContext): string {
  const values: Record<string, string> = {
    order_id: context.orderId,
    item_id: context.itemId,
    item_title: context.itemTitle,
    buyer_name: context.buyerName,
    buyer_id: context.buyerId,
    seller_name: context.sellerName,
    spec_name: context.specName,
    spec_value: context.specValue,
    order_amount: context.orderAmount,
    order_quantity: context.orderQuantity,
  };
  return value.replace(/\{([a-z_]+)\}/giu, (match, key: string) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] ?? '' : match);
}

export function recursiveReplaceParams(value: unknown, context: CouponDeliveryContext): unknown {
  if (Array.isArray(value)) return value.map((item) => recursiveReplaceParams(item, context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, recursiveReplaceParams(item, context)]));
  if (typeof value !== 'string') return value;
  return replaceOrderVariables(value, context).replaceAll('{timestamp}', String(Math.floor(Date.now() / 1000)));
}

async function fetchApiCouponContent(apiConfig: CouponApiConfig | undefined, context: CouponDeliveryContext, options: CouponDeliveryFetchOptions): Promise<string | undefined> {
  if (!apiConfig?.url?.trim()) throw new Error('API_CONFIG_MISSING');
  const method = apiConfig.method === 'POST' ? 'POST' : 'GET';
  const timeoutSeconds = Math.max(1, Math.trunc(Number(apiConfig.timeout ?? DEFAULT_API_TIMEOUT_SECONDS) || DEFAULT_API_TIMEOUT_SECONDS));
  const headers = parseJsonRecord(apiConfig.headers);
  const rawParams = parseJsonValue(apiConfig.params);
  const params = recursiveReplaceParams(rawParams ?? {}, context);
  const maxAttempts = Math.max(1, Math.min(6, Math.trunc(options.maxAttempts ?? DEFAULT_API_MAX_ATTEMPTS)));
  const retryDelayMs = Math.max(0, Math.trunc(options.retryDelayMs ?? 50));
  const fetchImpl = options.fetchImpl ?? fetch;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    try {
      const url = new URL(apiConfig.url);
      const init: RequestInit = { method, headers: { ...headers }, signal: controller.signal };
      if (method === 'GET') {
        appendQuery(url, params);
      } else {
        const requestHeaders = init.headers as Record<string, string>;
        if (!Object.keys(requestHeaders).some((key) => key.toLowerCase() === 'content-type')) requestHeaders['Content-Type'] = 'application/json';
        init.body = JSON.stringify(params ?? {});
      }
      const response = await fetchImpl(url, init);
      const responseText = await response.text();
      if (response.ok) return extractApiContent(responseText, apiConfig.responseField);
      if (!(response.status >= 500 || response.status === 408) || attempt >= maxAttempts) throw new Error(`API_HTTP_${response.status}`);
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
    } finally {
      clearTimeout(timer);
    }
    if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
  }
  throw new Error('API_REQUEST_FAILED');
}

function parseJsonRecord(value?: string): Record<string, string> {
  if (!value?.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('API_HEADERS_INVALID');
  return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, item]) => [key, String(item)]));
}

function parseJsonValue(value?: string): unknown {
  if (!value?.trim()) return {};
  return JSON.parse(value);
}

function appendQuery(url: URL, params: unknown): void {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return;
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
}

function extractApiContent(responseText: string, responseField?: string): string {
  if (!responseField?.trim()) {
    try {
      const parsed = JSON.parse(responseText) as unknown;
      const candidate = firstPrimitive(parsed, ['data', 'content', 'card']);
      if (candidate !== undefined) return String(candidate);
    } catch { /* plain text response */ }
    return responseText.trim();
  }
  const parsed = JSON.parse(responseText) as unknown;
  const value = readPath(parsed, responseField);
  if (value === undefined || value === null) throw new Error('API_RESPONSE_FIELD_NOT_FOUND');
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function firstPrimitive(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean') return candidate;
    if (candidate && typeof candidate === 'object') {
      const nested = firstPrimitive(candidate, keys);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function readPath(value: unknown, path: string): unknown {
  const segments = path.replace(/\[([0-9]+)\]/gu, '.$1').split('.').map((part) => part.trim()).filter(Boolean);
  let current: unknown = value;
  for (const segment of segments) {
    if (current && typeof current === 'object' && segment in (current as Record<string, unknown>)) current = (current as Record<string, unknown>)[segment];
    else return undefined;
  }
  return current;
}
