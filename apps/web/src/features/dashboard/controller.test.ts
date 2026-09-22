import { describe, expect, it } from 'vitest';
import { getVisibleDashboardState } from './controller';
import type { DashboardState } from './types';

const loadedState: DashboardState = {
  phase: 'success',
  data: {
    kpis: [],
    trend: [],
    health: [],
    productRank: [],
    recentActivity: [],
    riskTodos: [],
    updatedAt: new Date(0).toISOString(),
  },
  error: null,
  refreshing: false,
};

describe('dashboard account visibility', () => {
  it('clears the previous account snapshot while the next account loads', () => {
    const visible = getVisibleDashboardState(loadedState, 'account-a', 'account-b');
    expect(visible.phase).toBe('loading');
    expect(visible.data).toBeNull();
  });

  it('keeps the loaded snapshot for the matching account', () => {
    expect(getVisibleDashboardState(loadedState, 'account-a', 'account-a')).toBe(loadedState);
  });
});
