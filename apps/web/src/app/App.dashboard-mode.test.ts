import { describe, expect, it } from 'vitest';
import { resolveDashboardMode } from './App';

describe('dashboard API mode resolution', () => {
  it('inherits live mode when the dashboard override is unset', () => {
    expect(resolveDashboardMode('live')).toBe('live');
  });

  it('keeps mock mode when the dashboard override is explicit', () => {
    expect(resolveDashboardMode('live', 'mock')).toBe('mock');
  });

  it('does not promote a mock API transport to live mode', () => {
    expect(resolveDashboardMode('mock')).toBe('mock');
  });
});
