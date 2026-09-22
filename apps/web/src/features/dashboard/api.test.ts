import { describe, expect, it } from 'vitest';
import { createDashboardApi } from './api';

describe('dashboard api query contract', () => {
  it('serializes preset and custom trend ranges for the snapshot route', async () => {
    const paths: string[] = [];
    const api = createDashboardApi({
      async get<T>(path: string): Promise<T> {
        paths.push(path);
        return {
          totalSales: 78420,
          todayOrderAmount: 18640,
          autoProcessRate: 96.8,
          pendingManualCount: 3,
          availableCouponCount: 1286,
          trend: [],
          riskTodos: [],
        } as T;
      },
    });

    await api.getSnapshot({ range: '3d' });
    await api.getSnapshot({ range: 'custom', from: '2026-09-01', to: '2026-09-15' });

    expect(paths).toEqual([
      '/api/v1/dashboard/snapshot?range=3d',
      '/api/v1/dashboard/snapshot?range=custom&from=2026-09-01&to=2026-09-15',
    ]);
  });
});
