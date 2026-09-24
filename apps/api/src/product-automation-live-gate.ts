export type ProductAutomationExecutionMode = 'simulate' | 'live';

export interface ProductAutomationLiveConfig {
  executionMode: ProductAutomationExecutionMode;
  liveConfirmed: boolean;
  buyerAllowlist: string[];
}

export const DEFAULT_PRODUCT_AUTOMATION_LIVE_CONFIG: ProductAutomationLiveConfig = {
  executionMode: 'simulate',
  liveConfirmed: false,
  buyerAllowlist: [],
};

/**
 * Normalizes only buyer-name presentation noise. Matching remains exact after
 * this step; no substring, fuzzy, or case-insensitive matching is allowed for
 * live writes.
 */
export function normalizeAutomationBuyerName(value: string): string {
  return value.normalize('NFKC').replace(/[\r\n]+/gu, ' ').replace(/[\t ]+/gu, ' ').trim();
}

export function parseProductAutomationBuyerAllowlist(value: string | undefined): string[] {
  if (value === undefined) return [...DEFAULT_PRODUCT_AUTOMATION_LIVE_CONFIG.buyerAllowlist];
  const raw = value.trim();
  if (!raw) return [];

  const candidates: unknown[] = raw.startsWith('[')
    ? parseJsonStringArray(raw)
    : raw.split(/[\n,;]/u);
  const normalized = candidates
    .filter((candidate): candidate is string => typeof candidate === 'string')
    .map(normalizeAutomationBuyerName)
    .filter(Boolean);
  if (normalized.length !== candidates.length) throw new Error('PRODUCT_AUTOMATION_BUYER_ALLOWLIST_INVALID');
  return [...new Set(normalized)];
}

export function resolveProductAutomationLiveConfig(env: NodeJS.ProcessEnv, buyerAllowlist = parseProductAutomationBuyerAllowlist(env.AUTOMATION_BUYER_ALLOWLIST)): ProductAutomationLiveConfig {
  const executionMode: ProductAutomationExecutionMode = env.PRODUCT_AUTOMATION_EXECUTION_MODE?.trim().toLowerCase() === 'live' ? 'live' : 'simulate';
  return {
    executionMode,
    liveConfirmed: parseBoolean(env.PRODUCT_AUTOMATION_LIVE_CONFIRMED),
    buyerAllowlist: [...new Set(buyerAllowlist.map(normalizeAutomationBuyerName).filter(Boolean))],
  };
}

export function productAutomationLiveBlockReason(config: ProductAutomationLiveConfig, buyerName: string | undefined): string | undefined {
  if (config.executionMode !== 'live') return 'PRODUCT_AUTOMATION_LIVE_MODE_REQUIRED';
  if (!config.liveConfirmed) return 'PRODUCT_AUTOMATION_LIVE_CONFIRMATION_REQUIRED';
  const normalizedBuyerName = typeof buyerName === 'string' ? normalizeAutomationBuyerName(buyerName) : '';
  const normalizedAllowlist = (Array.isArray(config.buyerAllowlist) ? config.buyerAllowlist : [])
    .map(normalizeAutomationBuyerName)
    .filter(Boolean);
  if (!normalizedBuyerName || !normalizedAllowlist.includes(normalizedBuyerName)) return 'PRODUCT_AUTOMATION_BUYER_NOT_ALLOWLISTED';
  return undefined;
}

function parseJsonStringArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error('invalid');
    return parsed;
  } catch {
    throw new Error('PRODUCT_AUTOMATION_BUYER_ALLOWLIST_INVALID');
  }
}

function parseBoolean(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}
