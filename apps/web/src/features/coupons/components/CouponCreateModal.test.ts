import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { buildCouponPayload, CouponCreateModal, type CouponCreateFormState, validateCouponForm } from './CouponCreateModal';
import type { CouponBatchVM } from '../types';

const baseForm: CouponCreateFormState = {
  accountId: 'account-001', label: '', purpose: 'text', deliveryScope: 'operator_only', textContent: '', dataContent: '',
  apiUrl: '', apiMethod: 'GET', apiTimeout: 60, apiHeaders: '', apiParams: '', apiResponseField: '', imageUrls: [], delaySeconds: 0, useNoLogisticsForm: false,
  deliveryCount: 0, description: '', feePayer: '', minPrice: '', dockVisibility: 'public', multiSpec: false, specName: '', specValue: '',
};

function batch(purpose: CouponBatchVM['purpose'], metadata: CouponBatchVM['metadata'] = {}): CouponBatchVM {
  return { batchId: '4', accountId: 'account-001', label: '测试卡券', purpose, deliveryScope: 'operator_only', status: 'draft', totalCount: 0, availableCount: 0, reservedCount: 0, consumedCount: 0, stockAlert: 'exhausted', version: 1, updatedAt: '2026-09-20T00:00:00.000Z', bindings: [], metadata };
}

describe('CouponCreateModal', () => {
  it('matches the reference field set while omitting the two requested docking controls', () => {
    const html = renderToStaticMarkup(createElement(CouponCreateModal, { submitting: false, onClose: vi.fn(), onSubmit: vi.fn(async () => {}) }));
    expect(html).toContain('固定文字配置');
    expect(html).toContain('图片配置（可选，最多3张）');
    expect(html).toContain('type=\"file\"');
    expect(html).toContain('accept=\"image/*\"');
    expect(html).not.toContain('账号');
    expect(html).not.toContain('交付范围');
    expect(html).not.toContain('夸克链接');
    expect(html).not.toContain('提取码');
    expect(html).not.toContain('已发货次数');
    expect(html).not.toContain('首批库存');
    expect(html).not.toContain('对接价格');
    expect(html).not.toContain('是否可对接');
    expect(html).not.toContain('对接信息');
    expect(html).not.toContain('对接消息');
    expect(html).toContain('ui-select-control');
    expect((html.match(/ui-select-control/g) ?? []).length).toBe(1);
    expect(html).toContain('data-coupons-purpose-select="true"');
    expect(html).toContain('coupons-purpose-field');
    expect(html).toContain('coupons-field-label');
    expect(html).toContain('coupons-checkbox-row');
  });

  it('keeps API and data fields conditional on card type', () => {
    const apiHtml = renderToStaticMarkup(createElement(CouponCreateModal, { submitting: false, batch: batch('api', { apiConfig: { url: '', method: 'POST', timeout: 60, headers: '', params: '', responseField: '' } }), onClose: vi.fn(), onSubmit: vi.fn(async () => {}) }));
    expect(apiHtml).toContain('type=\"url\"');
    expect(apiHtml).toContain('POST请求可用参数（点击添加）：');
    expect(apiHtml).toContain('接口返回纯文本时若填写本字段，会因无法解析而取值失败，请务必留空。');
    expect((apiHtml.match(/ui-select-control/g) ?? []).length).toBe(2);
    const dataHtml = renderToStaticMarkup(createElement(CouponCreateModal, { submitting: false, batch: batch('data'), onClose: vi.fn(), onSubmit: vi.fn(async () => {}) }));
    expect(dataHtml).toContain('批量数据配置');
    expect(dataHtml).toContain('支持格式：卡号:密码 或 单独的兑换码');
    expect(dataHtml).toContain('图片配置（可选，最多3张）');
  });

  it('builds canonical payload without legacy visible-only fields', () => {
    const form = { ...baseForm, label: '固定文字卡券', textContent: '兑换内容', useNoLogisticsForm: true, description: '{DELIVERY_CONTENT}', imageUrls: ['data:image/png;base64,abc'] };
    const payload = buildCouponPayload(form);
    expect(payload).toMatchObject({ accountId: 'account-001', label: '固定文字卡券', purpose: 'text', deliveryScope: 'operator_only' });
    expect(payload).not.toHaveProperty('items');
    expect(payload.metadata).toMatchObject({ textContent: '兑换内容', useNoLogisticsForm: true, description: '{DELIVERY_CONTENT}', delaySeconds: 0, multiSpec: false, imageUrls: ['data:image/png;base64,abc'] });
    expect(payload.metadata).not.toHaveProperty('price');
    expect(payload.metadata).not.toHaveProperty('dockable');
  });

  it('validates reference-specific content and JSON rules', () => {
    expect(validateCouponForm({ ...baseForm, accountId: '', label: '缺少账号', textContent: '内容' })).toContain('可用账号');
    expect(validateCouponForm({ ...baseForm, label: 'API 卡券', purpose: 'api' })).toContain('API地址');
    expect(validateCouponForm({ ...baseForm, label: '文本卡券', textContent: '内容', description: '普通备注' })).toContain('{DELIVERY_CONTENT}');
    expect(validateCouponForm({ ...baseForm, label: '接口卡券', purpose: 'api', apiUrl: 'https://example.com', apiHeaders: '{bad' })).toContain('请求头');
    expect(validateCouponForm({ ...baseForm, label: '多规格', textContent: '内容', multiSpec: true, specName: '套餐' })).toContain('规格名称和规格值');
    expect(validateCouponForm({ ...baseForm, label: '正常卡券', textContent: '内容', description: '{DELIVERY_CONTENT}' })).toBe('');
  });
});
