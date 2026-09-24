import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createMockProductAutomationApi, createProductAutomationApi, MOCK_AUTOMATION_COUPONS, toAutomationConfig, toAutomationConfigWire } from './api';
import { AutomationDrawer, buildAutomationCouponOptions, buildValidatedAutomationUpdate, resolveDeliveryCouponIds, resolveGiftCouponIds } from './components/AutomationDrawer';
import { BatchAutomationDialog } from './components/BatchAutomationDialog';
import { CouponPickerDialog } from './components/CouponPickerDialog';
import { toProductAutomationSaveError } from './controller';
import { ApiError } from '../../api/http';
import type { ProductVM } from '../products/types';

const product: ProductVM = { id: 'product-1', accountId: 'account-1', title: 'PPT Master', externalProductRef: 'item-1', attributesJson: {}, configVersion: 1, priceMinor: 850, status: 'published', createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-20T10:00:00.000Z', skuCount: 1, assetCount: 0 };

describe('product automation API', () => {
  it('maps the live adapter to the canonical automation and coupon contracts', async () => {
    const calls: Array<{ method: string; path: string; body?: unknown; options?: unknown }> = [];
    const api = createProductAutomationApi({
      async get<T>(path: string) { calls.push({ method: 'GET', path }); return (path.includes('/automation') ? { data: { productId: 'product-1', accountId: 'account-1', configVersion: 7, config: { paidAutoDelivery: { enabled: true, couponBatchIds: ['1'] }, unpaidAutoReprice: { enabled: false }, reviewGift: { enabled: false }, reviewReminder: { enabled: true, firstDelayHours: 72, repeatIntervalHours: 24, maxReminders: 1, message: '请评价' } } } } : { data: { items: [...MOCK_AUTOMATION_COUPONS, { id: 'operator-only', label: '仅运营可见', purpose: 'text', deliveryScope: 'operator_only' }, { id: 'paused-coupon', label: '已禁用卡券', purpose: 'text', deliveryScope: 'buyer_deliverable', status: 'paused' }] } }) as T; },
      async patch<T>(path: string, body?: unknown, options?: unknown) { calls.push({ method: 'PATCH', path, body, options }); return { data: { productId: 'product-1', accountId: 'account-1', configVersion: 8, paidAutoDelivery: { enabled: false }, unpaidAutoReprice: { enabled: false }, reviewGift: { enabled: false }, reviewReminder: { enabled: true } } } as T; },
      async post<T>(path: string, body?: unknown, options?: unknown) { calls.push({ method: 'POST', path, body, options }); return { data: { updatedCount: 1 } } as T; },
    });
    const config = await api.getConfig('product-1');
    expect(config.version).toBe(7);
    expect(config.delivery.couponIds).toEqual(['1']);
     const availableCoupons = await api.listCoupons('account-1', 'delivery');
     const giftCoupons = await api.listCoupons('account-1', 'gift');
     expect(availableCoupons.some((coupon) => coupon.id === 'operator-only')).toBe(true);
     expect(availableCoupons.some((coupon) => coupon.id === 'paused-coupon')).toBe(false);
     expect(availableCoupons.every((coupon) => coupon.status === 'active')).toBe(true);
     expect(giftCoupons.map((coupon) => coupon.id)).toEqual(availableCoupons.map((coupon) => coupon.id));
    await api.saveConfig('product-1', { version: 7, delivery: { enabled: false } });
    await api.saveBatch({ productIds: ['product-1'], expectedConfigVersions: { 'product-1': 8 }, apply: { delivery: true, reprice: false, gift: false, review: false }, rules: { delivery: { enabled: false }, reprice: { enabled: false }, gift: { enabled: false }, review: { enabled: true } } });
    expect(calls[0].path).toBe('/api/v1/products/product-1/automation');
    expect(calls[1].path).toBe('/api/v1/coupons/batches?accountId=account-1&page=1&pageSize=100');
    const saveCall = calls.find((call) => call.method === 'PATCH' && call.path.includes('/automation'));
    expect(saveCall?.body).toMatchObject({ config: { paidAutoDelivery: { enabled: false, couponBatchIds: [], autoConfirm: true } } });
    expect(Object.keys(((saveCall?.body as { config?: Record<string, unknown> }).config ?? {}))).toEqual(['paidAutoDelivery']);
    expect((saveCall?.body as { config?: { paidAutoDelivery?: { autoConfirm?: boolean } } }).config?.paidAutoDelivery?.autoConfirm).toBe(true);
    expect(saveCall?.options).toMatchObject({ headers: expect.objectContaining({ 'If-Match-Version': '7', 'Idempotency-Key': expect.any(String) }) });
    const batchCall = calls.find((call) => call.path.endsWith('/automation/batch'));
    expect(batchCall?.body).toMatchObject({ productIds: ['product-1'], expectedConfigVersions: { 'product-1': 8 }, config: { paidAutoDelivery: { enabled: false } } });
  });

  it('loads every coupon page for the automation picker', async () => {
    const requestedPaths: string[] = [];
    const api = createProductAutomationApi({
      async get<T>(path: string) {
        requestedPaths.push(path);
        const page = new URL(path, 'http://automation.test').searchParams.get('page');
        return (page === '1'
          ? { data: { items: Array.from({ length: 100 }, (_, index) => ({ id: `coupon-${index + 1}`, label: `卡券 ${index + 1}`, purpose: 'text', deliveryScope: 'buyer_deliverable' })), totalPages: 2 } }
          : { data: { items: [{ id: 'coupon-101', label: '卡券 101', purpose: 'text', deliveryScope: 'buyer_deliverable' }], totalPages: 2 } }) as T;
      },
    });
    const coupons = await api.listCoupons('account-1', 'delivery');
    expect(coupons).toHaveLength(101);
    expect(coupons.at(-1)?.id).toBe('coupon-101');
    expect(requestedPaths).toEqual([
      '/api/v1/coupons/batches?accountId=account-1&page=1&pageSize=100',
      '/api/v1/coupons/batches?accountId=account-1&page=2&pageSize=100',
    ]);
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
    expect(html).not.toContain('查看卡券设置');
    expect(html).not.toContain('规格、数量、库存');
  });

  it('defaults automatic shipment confirmation to enabled for legacy and partial payloads', () => {
    const mapped = toAutomationConfig({ productId: 'product-1', accountId: 'account-1', configVersion: 1, paidAutoDelivery: { enabled: false }, unpaidAutoReprice: { enabled: false }, reviewGift: { enabled: false }, reviewReminder: { enabled: false } });
    expect(mapped.delivery.autoConfirm).toBe(true);
    const wire = toAutomationConfigWire({ version: 1, delivery: { enabled: false }, reprice: { enabled: false }, gift: { enabled: false }, review: { enabled: false } });
    expect(wire.paidAutoDelivery?.autoConfirm).toBe(true);
    expect(toAutomationConfig({ productId: 'product-1', accountId: 'account-1', version: 1, delivery: { enabled: false }, reprice: { enabled: false }, gift: { enabled: false }, review: { enabled: false } }).delivery.autoConfirm).toBe(true);
  });

  it('preserves backend defaults when the legacy response omits review message', async () => {
    const calls: Array<{ body?: unknown }> = [];
    const api = createProductAutomationApi({
      async get<T>() { return { data: { productId: 'product-1', accountId: 'account-1', configVersion: 1, config: { paidAutoDelivery: { enabled: false }, unpaidAutoReprice: { enabled: false }, reviewGift: { enabled: false }, reviewReminder: { enabled: true } } } } as T; },
      async patch<T>(_path: string, body?: unknown) { calls.push({ body }); return { data: { productId: 'product-1', accountId: 'account-1', configVersion: 1, config: { paidAutoDelivery: { enabled: false }, unpaidAutoReprice: { enabled: false }, reviewGift: { enabled: false }, reviewReminder: { enabled: true, message: '默认文案' } } } } as T; },
    });
    const initial = await api.getConfig('product-1');
    await api.saveConfig('product-1', { version: initial.version, delivery: initial.delivery, reprice: initial.reprice, gift: initial.gift, review: initial.review });
    expect((calls[0]?.body as { config?: { reviewReminder?: { message?: string } } }).config?.reviewReminder?.message).toBeTruthy();
  });

  it('renders transfer picker with available and selected panes and save count', () => {
    const html = renderToStaticMarkup(createElement(CouponPickerDialog, { open: true, title: '选择发货卡券', subtitle: '付款后自动发货使用的卡券', coupons: MOCK_AUTOMATION_COUPONS, selectedIds: ['coupon-batch-2'], onCancel: vi.fn(), onSave: vi.fn() }));
    expect(html).toContain('coupons-modal-backdrop');
    expect(html).toContain('coupons-relation-modal');
    expect(html).toContain('coupons-relation-grid coupon-picker-grid');
    expect((html.match(/class="coupons-relation-pane coupon-picker-pane coupon-transfer-pane"/g) ?? []).length).toBe(2);
    expect((html.match(/coupons-relation-search/g) ?? []).length).toBe(2);
    expect(html).toContain('待选卡券');
    expect(html).toContain('已选卡券');
    expect(html).toContain('保存（1 个）');
    expect(html).toContain('API 卡券');
    expect(html).not.toContain('coupon-picker-transfer-column');
    expect(html).not.toContain('加入已选卡券');
    expect(html).not.toContain('移出已选卡券');
    expect(html).not.toContain('库存 120');
    expect(html).not.toContain('2 条规格');
  });

  it('removes the no-op draft button and submits the full rule set on save', async () => {
    const config = await createMockProductAutomationApi().getConfig(product.id);
    expect(Object.keys(buildValidatedAutomationUpdate(config))).toEqual(['version', 'delivery', 'reprice', 'gift', 'review']);
    const html = renderToStaticMarkup(createElement(AutomationDrawer, { open: true, product, config, coupons: MOCK_AUTOMATION_COUPONS, loadPhase: 'success', savePhase: 'idle', error: null, onClose: vi.fn(), onSave: vi.fn(async () => config) }));
    expect(html).toContain('关闭');
    expect(html).not.toContain('保存草稿');
  });

  it('renders selected coupons as removable rows without redundant checkboxes', () => {
    const html = renderToStaticMarkup(createElement(CouponPickerDialog, { open: true, title: '选择发货卡券', subtitle: '付款后自动发货使用的卡券', coupons: MOCK_AUTOMATION_COUPONS, selectedIds: ['coupon-batch-2'], onCancel: vi.fn(), onSave: vi.fn() }));
    expect(html).toContain('aria-label="移除批量数据2"');
    expect((html.match(/<strong>批量数据2<\/strong>/g) ?? []).length).toBe(2);
    expect(html).toContain('☑');
    expect(html).not.toContain('<input type="checkbox"');
  });

  it('hydrates automation picker selections from product-level coupon bindings', async () => {
    const api = createMockProductAutomationApi();
    const config = await api.getConfig(product.id);
    const boundProduct = { ...product, couponBatches: [{ id: 'coupon-gift-a', label: '评价赠品批次 A' }] };
    const html = renderToStaticMarkup(createElement(AutomationDrawer, { open: true, product: boundProduct, config: { ...config, delivery: { ...config.delivery, couponIds: [] }, gift: { ...config.gift, couponIds: [] } }, coupons: MOCK_AUTOMATION_COUPONS, loadPhase: 'success', savePhase: 'idle', error: null, onClose: vi.fn(), onSave: vi.fn(async () => config) }));
    expect(html).toContain('评价赠品批次 A');
    expect((html.match(/已选发货卡券/g) ?? []).length).toBeGreaterThan(0);
    expect(html).toContain('未选择赠品卡券');
  });

  it('keeps configured delivery coupons when the product list has no binding rows', async () => {
    const api = createMockProductAutomationApi();
    const config = await api.getConfig(product.id);
    const html = renderToStaticMarkup(createElement(AutomationDrawer, {
      open: true,
      product: { ...product, couponBatches: [] },
      config,
      coupons: MOCK_AUTOMATION_COUPONS,
      loadPhase: 'success',
      savePhase: 'idle',
      error: null,
      onClose: vi.fn(),
      onSave: vi.fn(async () => config),
    }));
    expect(html).toContain('批量数据2');
    expect(html).toContain('已选发货卡券');
  });

  it('falls back to the visible product binding when the saved automation id is stale', async () => {
    const boundProduct = { ...product, couponBatches: [{ id: 'coupon-owei-map', label: '奥维地图' }] };
    const coupons = [...MOCK_AUTOMATION_COUPONS, { id: 'coupon-owei-map', label: '奥维地图', typeLabel: '数据卡', specSummary: '按行取值', quantitySummary: '每件 1 份' }];
    const pickerCoupons = buildAutomationCouponOptions(coupons, boundProduct.couponBatches);
    expect(pickerCoupons.map((coupon) => coupon.id)).toEqual(expect.arrayContaining(['coupon-batch-2', 'coupon-gift-a', 'coupon-api-member', 'coupon-text-fixed', 'coupon-owei-map']));
    expect(resolveDeliveryCouponIds(['internal-uuid-for-owei-map'], ['coupon-owei-map'], pickerCoupons)).toEqual(['coupon-owei-map']);
    expect(resolveDeliveryCouponIds(['coupon-batch-2'], ['coupon-owei-map'], pickerCoupons)).toEqual(['coupon-owei-map']);
    const config = await createMockProductAutomationApi().getConfig(product.id);
    const html = renderToStaticMarkup(createElement(AutomationDrawer, {
      open: true,
      product: boundProduct,
      config: { ...config, delivery: { ...config.delivery, enabled: true, couponIds: ['internal-uuid-for-owei-map'] } },
      coupons,
      loadPhase: 'success',
      savePhase: 'idle',
      error: null,
      onClose: vi.fn(),
      onSave: vi.fn(async () => null),
    }));
    expect(html).toContain('奥维地图');
    expect(html.indexOf('data-testid="choose-delivery-coupon"')).toBeLessThan(html.indexOf('class="automation-selected-coupon"'));
  });

  it('hydrates gift selections from the public coupon id without inheriting delivery bindings', async () => {
    const boundProduct = { ...product, couponBatches: [{ id: 'coupon-owei-map', label: '奥维地图' }] };
    const coupons = [...MOCK_AUTOMATION_COUPONS, { id: 'coupon-owei-map', label: '奥维地图', typeLabel: '数据卡', specSummary: '按行取值', quantitySummary: '每件 1 份' }];
    expect(resolveGiftCouponIds(['internal-uuid-for-owei-map'], ['coupon-owei-map'], coupons)).toEqual(['coupon-owei-map']);
    expect(resolveGiftCouponIds([], ['coupon-owei-map'], coupons)).toEqual([]);
    const config = await createMockProductAutomationApi().getConfig(product.id);
    const html = renderToStaticMarkup(createElement(AutomationDrawer, {
      open: true,
      product: boundProduct,
      config: { ...config, delivery: { ...config.delivery, couponIds: ['coupon-owei-map'] }, gift: { ...config.gift, enabled: true, couponIds: ['internal-uuid-for-owei-map'] } },
      coupons,
      loadPhase: 'success',
      savePhase: 'idle',
      error: null,
      onClose: vi.fn(),
      onSave: vi.fn(async () => null),
    }));
    expect(html).toContain('评价后发送赠品');
    expect(html).toContain('已选奥维地图');
  });

  it('renders the delivery auto-confirm switch and preserves its saved state', () => {
    const savedConfig = {
      productId: product.id,
      accountId: product.accountId,
      version: 4,
      delivery: { enabled: true, couponIds: ['coupon-batch-2'], autoConfirm: true },
      reprice: { enabled: false },
      gift: { enabled: false, couponIds: [] },
      review: { enabled: false },
    };
    const html = renderToStaticMarkup(createElement(AutomationDrawer, { open: true, product, config: savedConfig, coupons: MOCK_AUTOMATION_COUPONS, loadPhase: 'success', savePhase: 'idle', error: null, onClose: vi.fn(), onSave: vi.fn(async () => savedConfig) }));
    expect(html).toContain('自动确认发货');
    expect(html).toContain('发卡成功后执行');
    expect(html).toContain('data-testid="auto-confirm-delivery"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('renders batch configuration with explicit apply checkboxes and disabled empty save', () => {
    const html = renderToStaticMarkup(createElement(BatchAutomationDialog, { open: true, productIds: [], onCancel: vi.fn(), onSave: vi.fn() }));
    expect(html).toContain('批量配置自动化');
    expect(html).toContain('应用付款后自动发货');
    expect(html).toContain('保存并启用');
    expect(html).toMatch(/disabled=""/);
  });
});

describe('product automation save error mapping', () => {
  it('maps optimistic-lock conflicts to a recoverable user message', () => {
    expect(toProductAutomationSaveError(new ApiError('automation config version conflict', 409, { error: { code: 'AUTOMATION_VERSION_CONFLICT' } }))).toBe('自动化配置已被其他操作更新，请关闭抽屉后重新打开再保存。');
  });

  it('maps coupon state conflicts to card reselection guidance', () => {
    expect(toProductAutomationSaveError(new ApiError('coupon batch is closed', 409, { error: { code: 'CONFLICT' } }))).toContain('重新选择可发货卡券');
  });

  it('maps validation failures to actionable card configuration guidance', () => {
    expect(toProductAutomationSaveError(new ApiError('paidAutoDelivery requires at least one coupon batch', 422, { error: { code: 'VALIDATION_FAILED' } }))).toContain('已选择可发货卡券');
  });
});
