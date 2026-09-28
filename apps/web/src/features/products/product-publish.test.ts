import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProductPublishComposer } from './components/ProductPublishComposer';
import { ProductPublishForm } from './components/ProductPublishForm';
import { inferProductCategory, inferProductSpecs, serializeAttachments, shouldPreviewOfficialSpecifications } from './product-publish';
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
    const values = { accountId: 'account-1', title: '耳机', description: '全新', categoryCode: 'digital.audio', priceMinor: '', priceYuan: '169', originalPriceYuan: '229', postageMode: 'free' as const, postageYuan: '', location: '浙江 杭州', publishImages: [{ name: 'one.png', mimeType: 'image/png', size: 12 }] };
    expect(validateProductForm(values)).toEqual({});
    expect(toDraftInput(values)).toMatchObject({ priceMinor: 16900, publishMeta: { originalPriceMinor: 22900, postageMode: 'free', location: '浙江 杭州' } });
  });

  it('shows description-derived specs and image handoff status', () => {
    expect(inferProductSpecs('女士连衣裙 M', '九成新，颜色：黑色', [{ id: '1', url: 'blob:1', name: 'dress.png', mimeType: 'image/png', size: 10 }])).toEqual(expect.arrayContaining([
      { label: '成色', value: '九成新', source: 'description' },
      { label: '尺码', value: 'M', source: 'description' },
      { label: '颜色', value: '黑色', source: 'description' },
      { label: '图片', value: '1 张，发布时交给闲鱼官方识别', source: 'image' },
    ]));
  });

  it('adapts shipping and address UI to the official publish flow', () => {
    const html = renderToStaticMarkup(createElement(ProductPublishForm, {
      values: { accountId: 'account-1', title: '耳机', description: '全新', categoryCode: 'digital.audio', priceMinor: '', priceYuan: '200', originalPriceYuan: '', postageMode: 'fixed', postageYuan: '', location: '', attachments: [] },
      errors: {},
      onChange: vi.fn(),
      onAttachmentsChange: vi.fn(),
      onOptimize: vi.fn(),
    }));
    expect(html).toContain('发货设置');
    expect(html).toContain('一口价');
    expect(html).not.toContain('aria-label="库存数量"');
    expect(html).toContain('库存按闲鱼官方逻辑处理。');
    expect(html).toContain('宝贝所在地');
    expect(html).toContain('例如：深圳湾公园');
    expect(html).toContain('自动预览官方规格');
  });

  it('starts official recommendation after an image is uploaded', () => {
    const base = { accountId: 'account-1', title: '店铺管家', description: '闲鱼超级助手' };
    expect(shouldPreviewOfficialSpecifications({ ...base, attachments: [{ id: 'a1', url: 'blob:a1', name: 'one.png', mimeType: 'image/png', file: {} as File }] })).toBe(true);
    expect(shouldPreviewOfficialSpecifications({ ...base, attachments: [] })).toBe(false);
  });

  it('renders official options as editable selectors before publishing', () => {
    const html = renderToStaticMarkup(createElement(ProductPublishForm, {
      values: { accountId: 'account-1', title: '游戏资料', description: '攻略', categoryCode: '', priceMinor: '', priceYuan: '20', originalPriceYuan: '', postageMode: 'free' as const, postageYuan: '', location: '深圳湾公园', attachments: [], specOverrides: [] },
      errors: {},
      officialPreview: { category: { catId: 'cat-1', catName: '游戏装备', channelCatId: 'channel-1' }, specs: [{ propertyId: '-10000', propertyName: '分类', selected: { text: '游戏装备' }, options: [{ text: '游戏装备' }, { text: '电子资料' }] }], imageUrls: [], replay: { source: 'reference-project', steps: [] } },
      previewState: 'success',
      onSpecOverrideChange: vi.fn(),
      onChange: vi.fn(),
      onAttachmentsChange: vi.fn(),
      onOptimize: vi.fn(),
    }));
    expect(html).toContain('闲鱼官方规格预览');
    expect(html).toContain('可在提交前修正');
    expect(html).toContain('游戏装备');
  });

  it('keeps the composer free of emoji and provider status copy', () => {
    const html = renderToStaticMarkup(createElement(ProductPublishComposer, { description: '', attachments: [], onDescriptionChange: vi.fn(), onAttachmentsChange: vi.fn(), onOptimize: vi.fn() }));
    expect(html).toContain('添加商品图片');
    expect(html).toContain('AI 优化文案');
    expect(html).not.toContain('表情');
    expect(html).not.toContain('Provider');
  });
});

