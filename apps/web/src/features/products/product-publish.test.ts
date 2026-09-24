import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProductPublishComposer } from './components/ProductPublishComposer';
import { inferProductCategory, serializeAttachments } from './product-publish';
import { toDraftInput, validateProductForm } from './validation';

describe('product publish form contract', () => {
  it('infers the category from title and description without a manual selector', () => {
    expect(inferProductCategory('降噪蓝牙耳机 Pro', '通勤使用')).toMatchObject({ code: 'digital.audio', label: '数码 › 耳机 / 音箱' });
    expect(inferProductCategory('桌面收纳盒', '奶油白')).toMatchObject({ code: 'home.storage', label: '家居 › 收纳' });
  });

  it('serializes publish metadata while keeping preview URLs out of the API payload', () => {
    expect(serializeAttachments([{ id: 'image-1', url: 'blob:image-1', name: 'one.png', mimeType: 'image/png', size: 12 }])).toEqual([{ name: 'one.png', mimeType: 'image/png', size: 12 }]);
  });

  it('maps yuan inputs to minor units and validates logistics fields', () => {
    const values = { accountId: 'account-1', title: '耳机', description: '全新', categoryCode: 'digital.audio', priceMinor: '', priceYuan: '169', originalPriceYuan: '229', quantity: '12', postageMode: 'seller' as const, postageYuan: '0', location: '浙江 杭州', publishImages: [{ name: 'one.png', mimeType: 'image/png', size: 12 }] };
    expect(validateProductForm(values)).toEqual({});
    expect(toDraftInput(values)).toMatchObject({ priceMinor: 16900, publishMeta: { originalPriceMinor: 22900, quantity: 12, postageMode: 'seller', location: '浙江 杭州' } });
  });

  it('keeps the composer free of emoji and provider status copy', () => {
    const html = renderToStaticMarkup(createElement(ProductPublishComposer, { description: '', attachments: [], onDescriptionChange: vi.fn(), onAttachmentsChange: vi.fn(), onOptimize: vi.fn() }));
    expect(html).toContain('添加商品图片');
    expect(html).toContain('AI 优化文案');
    expect(html).not.toContain('表情');
    expect(html).not.toContain('Provider');
  });
});

