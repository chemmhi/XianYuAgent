import type { CouponBatchRecord, ProductAutomationConfig } from './domain.js';

const couponRuleKeys = ['paidAutoDelivery', 'reviewGift'] as const;

/**
 * Remove a deleted/voided coupon batch from persisted automation rules.
 * A rule that loses its last coupon is disabled; rules retaining another
 * coupon keep their existing enabled state.
 */
export function removeCouponBatchFromAutomationConfig(config: ProductAutomationConfig, batch: Pick<CouponBatchRecord, 'id' | 'sequenceId'>): { config: ProductAutomationConfig; changed: boolean } {
  const removedIds = new Set([batch.id, batch.sequenceId].filter((value): value is string => Boolean(value)).map(String));
  const next = structuredClone(config);
  let changed = false;

  for (const key of couponRuleKeys) {
    const rule = next[key];
    const before = [...new Set((rule.couponBatchIds ?? []).map((value) => String(value).trim()).filter(Boolean))];
    const after = before.filter((value) => !removedIds.has(value));
    if (after.length === before.length) continue;
    const enabled = after.length === 0 && before.length > 0 ? false : rule.enabled;
    if (key === 'paidAutoDelivery') next.paidAutoDelivery = { ...next.paidAutoDelivery, couponBatchIds: after, enabled };
    else next.reviewGift = { ...next.reviewGift, couponBatchIds: after, enabled };
    changed = true;
  }

  return { config: next, changed };
}
