import { describe, expect, it } from 'vitest';
import { toDraftInput, validateProductForm } from './validation';

describe('product draft validation', () => {
  it('requires account context and title', () => {
    const errors = validateProductForm({ accountId: '', title: '', description: '', categoryCode: '', priceMinor: '' });
    expect(errors.accountId).toBeTruthy();
    expect(errors.title).toBeTruthy();
  });

  it('rejects invalid price and preserves canonical input fields', () => {
    const errors = validateProductForm({ accountId: 'account-1', title: '草稿', description: '', categoryCode: '', priceMinor: '-1' });
    expect(errors.priceMinor).toBeTruthy();
    expect(toDraftInput({ accountId: 'account-1', title: ' 草稿 ', description: ' 说明 ', categoryCode: ' digital ', priceMinor: '1990' })).toEqual({ accountId: 'account-1', title: '草稿', description: '说明', categoryCode: 'digital', priceMinor: 1990 });
  });

  it('requires postage when the official fixed-price mode is selected', () => {
    const errors = validateProductForm({ accountId: 'account-1', title: '商品', description: '描述', categoryCode: 'digital', priceMinor: '', priceYuan: '200', quantity: '1', postageMode: 'fixed', postageYuan: '' });
    expect(errors.postageYuan).toBe('一口价模式必须填写邮费。');
  });
});
