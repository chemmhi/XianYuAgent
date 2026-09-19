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
});
