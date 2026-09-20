import { describe, expect, it } from 'vitest';
import { hasOrdersContextLoadFailure } from './context-state';

describe('orders account context state', () => {
  it('surfaces an initial account lookup failure instead of leaving the list loading forever', () => {
    expect(hasOrdersContextLoadFailure('账号服务暂时不可用')).toBe(true);
  });

  it('does not hide a previously selected account behind a global context error', () => {
    expect(hasOrdersContextLoadFailure('刷新账号失败', 'account-1')).toBe(false);
    expect(hasOrdersContextLoadFailure(null)).toBe(false);
  });
});
