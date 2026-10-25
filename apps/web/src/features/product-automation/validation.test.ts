import { describe, expect, it } from 'vitest';
import { firstAutomationErrorTab, validateAutomationFields } from './validation';
import type { ProductAutomationConfig } from './types';
import { toAutomationConfigWire } from './api';
import { buildValidatedAutomationUpdate } from './components/AutomationDrawer';

function config(): ProductAutomationConfig {
  return { productId: 'product', accountId: 'account', version: 1, delivery: { enabled: false }, gift: { enabled: false }, reprice: { enabled: false }, review: { enabled: false } };
}

describe('automation field validation', () => {
  it('collects errors across all enabled tabs and chooses the first failing tab', () => {
    const draft = config();
    draft.delivery = { enabled: true, couponIds: [] };
    draft.gift = { enabled: true, couponIds: [] };
    draft.reprice = { enabled: true, targetPriceMinor: -1, repriceMessage: 'a'.repeat(501) };
    draft.review = { enabled: true, reviewInitialMinutes: 0, reviewRepeatMinutes: 43201, reviewMaxCount: 11, reviewMessage: ' ' };
    const errors = validateAutomationFields(draft);
    expect(Object.keys(errors)).toHaveLength(4);
    expect(errors.reprice).toHaveProperty('targetPriceMinor');
    expect(errors.reprice).toHaveProperty('repriceMessage');
    expect(Object.keys(errors.review ?? {})).toHaveLength(4);
    expect(firstAutomationErrorTab(errors)).toBe('delivery');
    delete errors.delivery;
    expect(firstAutomationErrorTab(errors)).toBe('reprice');
    expect(firstAutomationErrorTab({ review: { reviewMessage: '请输入提醒文案' } })).toBe('review');
  });
  it('allows the exact service boundaries including zero target price', () => {
    const draft = config();
    draft.delivery = { enabled: true, couponIds: ['coupon'] };
    draft.gift = { enabled: true, couponIds: ['gift'] };
    draft.reprice = { enabled: true, targetPriceMinor: 0, repriceMessage: 'a'.repeat(500) };
    draft.review = { enabled: true, reviewInitialMinutes: 1, reviewRepeatMinutes: 43200, reviewMaxCount: 10, reviewMessage: 'a'.repeat(500) };
    expect(validateAutomationFields(draft)).toEqual({});
    expect(firstAutomationErrorTab({})).toBeUndefined();
  });
  it('rejects unsafe or fractional values using the backend integer constraints', () => {
    const draft = config();
    draft.reprice = { enabled: true, targetPriceMinor: Number.MAX_SAFE_INTEGER + 1 };
    draft.review = { enabled: true, reviewInitialMinutes: 1.5, reviewRepeatMinutes: NaN, reviewMaxCount: Infinity, reviewMessage: 'a'.repeat(501) };
    expect(validateAutomationFields(draft).reprice).toHaveProperty('targetPriceMinor');
    expect(Object.keys(validateAutomationFields(draft).review ?? {})).toHaveLength(4);
  });
  it('flags invalid inactive fields because the API still sends them for service normalization', () => {
    const draft = config();
    draft.reprice = { enabled: false, targetPriceMinor: -1, repriceMessage: 'a'.repeat(501) };
    draft.review = { enabled: false, reviewInitialMinutes: -1, reviewRepeatMinutes: -1, reviewMaxCount: 11, reviewMessage: '' };
    const before = structuredClone(draft);
    const errors = validateAutomationFields(draft);
    expect(errors.reprice).toHaveProperty('targetPriceMinor');
    expect(errors.reprice).toHaveProperty('repriceMessage');
    expect(Object.keys(errors.review ?? {})).toHaveLength(4);
    expect(firstAutomationErrorTab(errors)).toBe('reprice');
    const wire = toAutomationConfigWire(buildValidatedAutomationUpdate(draft));
    expect(wire.unpaidAutoReprice).toMatchObject({ enabled: false, targetPriceMinor: -1 });
    expect(wire.reviewReminder).toMatchObject({ enabled: false, firstDelayMinutes: -1, repeatIntervalMinutes: -1, maxReminders: 11, message: '' });
    expect(draft).toEqual(before);
  });
  it('allows valid inactive numeric/message fields and does not require inactive coupon selections', () => {
    const draft = config();
    draft.reprice = { enabled: false, targetPriceMinor: 0, repriceMessage: 'a'.repeat(500) };
    draft.review = { enabled: false, reviewInitialMinutes: 43200, reviewRepeatMinutes: 1, reviewMaxCount: 10, reviewMessage: '提醒文案' };
    expect(validateAutomationFields(draft)).toEqual({});
    const wire = toAutomationConfigWire(buildValidatedAutomationUpdate(draft));
    expect(wire.paidAutoDelivery).toMatchObject({ enabled: false, couponBatchIds: [] });
    expect(wire.reviewGift).toMatchObject({ enabled: false, couponBatchIds: [] });
    expect(wire.unpaidAutoReprice).toMatchObject({ enabled: false, targetPriceMinor: 0, message: 'a'.repeat(500) });
    expect(wire.reviewReminder).toMatchObject({ enabled: false, firstDelayMinutes: 43200, repeatIntervalMinutes: 1, maxReminders: 10, message: '提醒文案' });
  });
});
