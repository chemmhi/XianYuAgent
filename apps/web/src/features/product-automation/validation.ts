import type { AutomationRuleKey, AutomationRuleState, ProductAutomationConfig } from './types';

export type AutomationRuleErrors = Partial<Record<keyof AutomationRuleState, string>>;
export type AutomationFieldErrors = Partial<Record<AutomationRuleKey, AutomationRuleErrors>>;
const ruleOrder: AutomationRuleKey[] = ['delivery', 'reprice', 'gift', 'review'];

/** Numeric and message constraints also apply to inactive rules in the service save contract. */
export function validateAutomationFields(config: ProductAutomationConfig): AutomationFieldErrors {
  const errors: AutomationFieldErrors = {};
  for (const key of ['delivery', 'gift'] as const) {
    if (config[key].enabled && !config[key].couponIds?.some(value => value.trim())) errors[key] = { couponIds: key === 'delivery' ? '请至少选择一张发货卡券' : '请至少选择一张赠品卡券' };
  }
  {
    const rule = config.reprice;
    const fields: AutomationRuleErrors = {};
    if (!Number.isSafeInteger(rule.targetPriceMinor ?? 0) || (rule.targetPriceMinor ?? 0) < 0) fields.targetPriceMinor = '目标价格必须为非负金额';
    if ((rule.repriceMessage ?? '').trim().length > 500) fields.repriceMessage = '改价后发送文本不能超过 500 个字符';
    if (Object.keys(fields).length) errors.reprice = fields;
  }
  {
    const rule = config.review;
    const fields: AutomationRuleErrors = {};
    const bounded = (value: number, min: number, max: number) => Number.isSafeInteger(value) && value >= min && value <= max;
    if (!bounded(rule.reviewInitialMinutes ?? 4320, 1, 43200)) fields.reviewInitialMinutes = '首次提醒必须是 1-43200 的整数';
    if (!bounded(rule.reviewRepeatMinutes ?? 1440, 1, 43200)) fields.reviewRepeatMinutes = '重复提醒间隔必须是 1-43200 的整数';
    if (!bounded(rule.reviewMaxCount ?? 1, 1, 10)) fields.reviewMaxCount = '最多提醒次数必须是 1-10 的整数';
    const message = (rule.reviewMessage ?? '').trim();
    if (!message) fields.reviewMessage = '请输入提醒文案';
    else if (message.length > 500) fields.reviewMessage = '提醒文案不能超过 500 个字符';
    if (Object.keys(fields).length) errors.review = fields;
  }
  return errors;
}

export function firstAutomationErrorTab(errors: AutomationFieldErrors): AutomationRuleKey | undefined {
  return ruleOrder.find(key => Object.keys(errors[key] ?? {}).length > 0);
}
