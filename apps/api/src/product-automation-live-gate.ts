export type ProductAutomationExecutionMode = 'simulate' | 'live';

export interface ProductAutomationLiveConfig {
  executionMode: ProductAutomationExecutionMode;
  liveConfirmed: boolean;
  productTitleAllowlist: string[];
}

export const DEFAULT_PRODUCT_AUTOMATION_PRODUCT_TITLE = '2026年奥维高清地图骗局';

export const DEFAULT_PRODUCT_AUTOMATION_LIVE_CONFIG: ProductAutomationLiveConfig = {
  executionMode: 'simulate',
  liveConfirmed: false,
  productTitleAllowlist: [DEFAULT_PRODUCT_AUTOMATION_PRODUCT_TITLE],
};

/**
 * Normalizes only presentation noise. Matching remains exact after this step;
 * no substring, fuzzy, or case-insensitive matching is allowed for live writes.
 */
export function normalizeAutomationProductTitle(value: string): string {
  return value.normalize('NFKC').replace(/[\r\n]+/gu, '').replace(/[\t ]+/gu, ' ').trim();
}

export function parseProductAutomationProductTitleAllowlist(value: string | undefined): string[] {
  if (value === undefined) return [...DEFAULT_PRODUCT_AUTOMATION_LIVE_CONFIG.productTitleAllowlist];
  const raw = value.trim();
  if (!raw) return [];

  const candidates: unknown[] = raw.startsWith('[')
    ? parseJsonTitleArray(raw)
    : raw.split(/[\n,;]/u);
  const normalized = candidates
    .filter((candidate): candidate is string => typeof candidate === 'string')
    .map(normalizeAutomationProductTitle)
    .filter(Boolean);
  if (normalized.length !== candidates.length) throw new Error('PRODUCT_AUTOMATION_PRODUCT_TITLE_ALLOWLIST_INVALID');
  return [...new Set(normalized)];
}

export function resolveProductAutomationLiveConfig(env: NodeJS.ProcessEnv): ProductAutomationLiveConfig {
  const executionMode: ProductAutomationExecutionMode = env.PRODUCT_AUTOMATION_EXECUTION_MODE?.trim().toLowerCase() === 'live' ? 'live' : 'simulate';
  return {
    executionMode,
    liveConfirmed: parseBoolean(env.PRODUCT_AUTOMATION_LIVE_CONFIRMED),
    productTitleAllowlist: parseProductAutomationProductTitleAllowlist(env.PRODUCT_AUTOMATION_PRODUCT_TITLE_ALLOWLIST),
  };
}

export function productAutomationLiveBlockReason(config: ProductAutomationLiveConfig, itemTitle: string | undefined): string | undefined {
  if (config.executionMode !== 'live') return 'PRODUCT_AUTOMATION_LIVE_MODE_REQUIRED';
  if (!config.liveConfirmed) return 'PRODUCT_AUTOMATION_LIVE_CONFIRMATION_REQUIRED';
  const normalizedTitle = typeof itemTitle === 'string' ? normalizeAutomationProductTitle(itemTitle) : '';
  const normalizedAllowlist = (Array.isArray(config.productTitleAllowlist) ? config.productTitleAllowlist : [])
    .map(normalizeAutomationProductTitle)
    .filter(Boolean);
  if (!normalizedTitle || !normalizedAllowlist.includes(normalizedTitle)) return 'PRODUCT_AUTOMATION_PRODUCT_TITLE_NOT_ALLOWLISTED';
  return undefined;
}

function parseJsonTitleArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error('invalid');
    return parsed;
  } catch {
    throw new Error('PRODUCT_AUTOMATION_PRODUCT_TITLE_ALLOWLIST_INVALID');
  }
}

function parseBoolean(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}
