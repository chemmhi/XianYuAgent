import { describe, expect, it } from 'vitest';
import { getDashboardReloadState, getVisibleDashboardState } from './controller';
import type { DashboardState } from './types';

const loadedState: DashboardState = {
  phase: 'success',
  data: {
    kpis: [],
    selectedRangeSales: 0,
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

  it('keeps the visible snapshot while a matching account refreshes', () => {
    const refreshing = getDashboardReloadState(loadedState, 'account-a', 'account-a');
    expect(refreshing.phase).toBe('success');
    expect(refreshing.data).toBe(loadedState.data);
    expect(refreshing.refreshing).toBe(true);
  });

  it('clears the snapshot when a different account starts loading', () => {
    const loading = getDashboardReloadState(loadedState, 'account-a', 'account-b');
    expect(loading.phase).toBe('loading');
    expect(loading.data).toBeNull();
    expect(loading.refreshing).toBe(false);
  });
});
