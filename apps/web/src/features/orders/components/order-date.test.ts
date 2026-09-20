import { describe, expect, it } from 'vitest';
import { formatOrderDate } from './order-date';

describe('formatOrderDate', () => {
  it('converts stored UTC instants to the operations timezone', () => {
    expect(formatOrderDate('2026-09-20T02:00:00.000Z', 'Asia/Shanghai')).toBe('2026-09-20 10:00');
  });

  it('keeps missing and invalid timestamps safe for compact tables', () => {
    expect(formatOrderDate('')).toBe('—');
    expect(formatOrderDate('not-a-date')).toBe('not-a-date');
  });
});
