import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { buildCouponPayload, CouponCreateModal, type CouponCreateFormState, validateCouponForm } from './CouponCreateModal';

const baseForm: CouponCreateFormState = {
  accountId: 'account-001', label: '', purpose: 'text', deliveryScope: 'operator_only', quarkUrl: '', extractionCode: '', textContent: '', dataContent: '', apiUrl: '', apiMethod: 'GET', apiTimeout: 60, apiHeaders: '', apiParams: '', apiResponseField: '', imageUrls: '', delaySeconds: 0, useNoLogisticsForm: false, deliveryCount: 0, description: '', feePayer: '', minPrice: '', dockVisibility: 'public', multiSpec: false, specName: '', specValue: '', itemsText: '',
};

describe('CouponCreateModal', () => {
  it('matches the reference labels/defaults while omitting removed docking controls', () => {
    const html = renderToStaticMarkup(createElement(CouponCreateModal, { submitting: false, onClose: vi.fn(), onSubmit: vi.fn(async () => {}) }));
    expect(html).toContain('例如：游戏点卡、会员卡等');
    expect(html).toContain('固定文字');
    expect(html).toContain('批量数据');
    expect(html).toContain('API接口');
    expect(html).toContain('填写到无需邮寄凭证');
    expect(html).toContain('多规格卡券');
    expect(html).not.toContain('对接价格');
    expect(html).not.toContain('是否可对接');
  });

  it('builds canonical metadata with reference defaults and preserves existing fields on edit', () => {
    const form = { ...baseForm, label: '固定文字卡券', textContent: '兑换内容', useNoLogisticsForm: true, description: '{DELIVERY_CONTENT}' };
    const payload = buildCouponPayload(form, { dockable: true, price: '9.90', description: '旧备注' });
    expect(payload).toMatchObject({ accountId: 'account-001', label: '固定文字卡券', purpose: 'text', deliveryScope: 'operator_only' });
    expect(payload.metadata).toMatchObject({ dockable: true, price: '9.90', textContent: '兑换内容', useNoLogisticsForm: true, description: '{DELIVERY_CONTENT}', delaySeconds: 0, multiSpec: false });
    expect(payload.metadata).not.toHaveProperty('isDockable');
  });

  it('validates reference-specific content and JSON rules', () => {
    expect(validateCouponForm({ ...baseForm, label: 'API 卡券', purpose: 'api' })).toContain('API地址');
    expect(validateCouponForm({ ...baseForm, label: '文本卡券', textContent: '内容', description: '普通备注' })).toContain('{DELIVERY_CONTENT}');
    expect(validateCouponForm({ ...baseForm, label: '接口卡券', purpose: 'api', apiUrl: 'https://example.com', apiHeaders: '{bad' })).toContain('请求头');
    expect(validateCouponForm({ ...baseForm, label: '多规格', textContent: '内容', multiSpec: true, specName: '套餐' })).toContain('规格名称和规格值');
    expect(validateCouponForm({ ...baseForm, label: '正常卡券', textContent: '内容', description: '{DELIVERY_CONTENT}' })).toBe('');
  });
});
