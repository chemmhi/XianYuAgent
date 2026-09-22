import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createMockProductAutomationApi, createProductAutomationApi, MOCK_AUTOMATION_COUPONS } from './api';
import { AutomationDrawer } from './components/AutomationDrawer';
import { BatchAutomationDialog } from './components/BatchAutomationDialog';
import { CouponPickerDialog } from './components/CouponPickerDialog';
import type { ProductVM } from '../products/types';

const product: ProductVM = { id: 'product-1', accountId: 'account-1', title: 'PPT Master', externalProductRef: 'item-1', attributesJson: {}, configVersion: 1, priceMinor: 850, status: 'published', createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-20T10:00:00.000Z', skuCount: 1, assetCount: 0 };

describe('product automation API', () => {
  it('maps the live adapter to the canonical automation and coupon contracts', async () => {
    const calls: Array<{ method: string; path: string; body?: unknown; options?: unknown }> = [];
    const api = createProductAutomationApi({
      async get<T>(path: string) { calls.push({ method: 'GET', path }); return (path.includes('/automation') ? { data: { productId: 'product-1', accountId: 'account-1', configVersion: 7, paidAutoDelivery: { enabled: true, couponIds: ['coupon-1'] }, unpaidAutoReprice: { enabled: false }, reviewGift: { enabled: false }, reviewReminder: { enabled: true } } } : { data: { items: MOCK_AUTOMATION_COUPONS } }) as T; },
      async patch<T>(path: string, body?: unknown, options?: unknown) { calls.push({ method: 'PATCH', path, body, options }); return { data: { productId: 'product-1', accountId: 'account-1', configVersion: 8, paidAutoDelivery: { enabled: false }, unpaidAutoReprice: { enabled: false }, reviewGift: { enabled: false }, reviewReminder: { enabled: true } } } as T; },
    });
    const config = await api.getConfig('product-1');
    expect(config.version).toBe(7);
    expect(config.delivery.couponIds).toEqual(['coupon-1']);
    await api.listCoupons('account-1', 'delivery');
    await api.saveConfig('product-1', { version: 7, delivery: { enabled: false }, reprice: { enabled: false }, gift: { enabled: false }, review: { enabled: true } });
    await api.saveBatch({ productIds: ['product-1'], expectedConfigVersions: { 'product-1': 8 }, apply: { delivery: true, reprice: false, gift: false, review: false }, rules: { delivery: { enabled: false }, reprice: { enabled: false }, gift: { enabled: false }, review: { enabled: true } } });
    expect(calls[0].path).toBe('/api/v1/products/product-1/automation');
    expect(calls[1].path).toContain('/api/v1/coupons/batches?accountId=account-1&purpose=delivery');
    const saveCall = calls.find((call) => call.method === 'PATCH' && call.path.includes('/automation'));
    expect(saveCall?.body).toMatchObject({ configVersion: 7, paidAutoDelivery: { enabled: false }, unpaidAutoReprice: { enabled: false }, reviewGift: { enabled: false }, reviewReminder: { enabled: true } });
    expect(saveCall?.options).toMatchObject({ headers: expect.objectContaining({ 'If-Match-Version': '7', 'Idempotency-Key': expect.any(String) }) });
    const batchCall = calls.find((call) => call.path.endsWith('/automation/batch'));
    expect(batchCall?.body).toMatchObject({ productIds: ['product-1'], expectedConfigVersions: { 'product-1': 8 }, config: { paidAutoDelivery: { enabled: false } } });
  });

  it('persists product rule changes with a version bump', async () => {
    const api = createMockProductAutomationApi();
    const initial = await api.getConfig(product.id);
    const saved = await api.saveConfig(product.id, { version: initial.version, delivery: { ...initial.delivery, enabled: false }, reprice: initial.reprice, gift: initial.gift, review: initial.review });
    expect(saved.delivery.enabled).toBe(false);
    expect(saved.version).toBe(initial.version + 1);
    expect((await api.getConfig(product.id)).delivery.enabled).toBe(false);
  });

  it('applies only selected rules in a batch update', async () => {
    const api = createMockProductAutomationApi();
    await api.getConfig('product-1');
    await api.saveBatch({ productIds: ['product-1'], apply: { delivery: true, reprice: false, gift: false, review: false }, rules: { delivery: { enabled: false, couponIds: [] }, reprice: { enabled: true, targetPriceMinor: 990 }, gift: { enabled: true }, review: { enabled: true } } });
    const saved = await api.getConfig('product-1');
    expect(saved.delivery.enabled).toBe(false);
    expect(saved.reprice.enabled).toBe(false);
  });
});

describe('product automation components', () => {
  it('renders the four rule tabs and the simplified card picker entry', async () => {
    const api = createMockProductAutomationApi();
    const config = await api.getConfig(product.id);
    const html = renderToStaticMarkup(createElement(AutomationDrawer, { open: true, product, config, coupons: MOCK_AUTOMATION_COUPONS, loadPhase: 'success', savePhase: 'idle', error: null, onClose: vi.fn(), onSave: vi.fn(async () => config) }));
    expect(html).toContain('付款后自动发货');
    expect(html).toContain('拍下未付款改价');
    expect(html).toContain('评价后发送赠品');
    expect(html).toContain('超时未评价求评价');
    expect(html).toContain('选择卡券');
    expect(html).not.toContain('当前可用库存');
    expect(html).not.toContain('库存关系');
  });

  it('renders transfer picker with available and selected panes and save count', () => {
    const html = renderToStaticMarkup(createElement(CouponPickerDialog, { open: true, title: '选择发货卡券', subtitle: '付款后自动发货使用的卡券', coupons: MOCK_AUTOMATION_COUPONS, selectedIds: ['coupon-batch-2'], onCancel: vi.fn(), onSave: vi.fn() }));
    expect(html).toContain('待选卡券');
    expect(html).toContain('已选卡券');
    expect(html).toContain('保存（1个）');
    expect(html).toContain('API 卡券');
  });

  it('renders batch configuration with explicit apply checkboxes and disabled empty save', () => {
    const html = renderToStaticMarkup(createElement(BatchAutomationDialog, { open: true, productIds: [], onCancel: vi.fn(), onSave: vi.fn() }));
    expect(html).toContain('批量配置自动化');
    expect(html).toContain('应用付款后自动发货');
    expect(html).toContain('保存并启用');
    expect(html).toMatch(/disabled=""/);
  });
});
