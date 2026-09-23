export interface AutoReplyProductMetrics {
  browseCount?: number;
  wantCount?: number;
  collectCount?: number;
}

export function readAutoReplyProductMetrics(attributes: Record<string, unknown>): AutoReplyProductMetrics {
  const xianyu = recordValue(attributes.xianyu);
  const detail = recordValue(xianyu.detail);
  const summary = recordValue(detail.summary);
  return {
    browseCount: normalizeAutoReplyProductMetric(summary.browseCount ?? summary.browse_count),
    wantCount: normalizeAutoReplyProductMetric(summary.wantCount ?? summary.want_count),
    collectCount: normalizeAutoReplyProductMetric(summary.collectCount ?? summary.collect_count),
  };
}

export function normalizeAutoReplyProductMetric(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) && numeric >= 0 ? Math.trunc(numeric) : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
