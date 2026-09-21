import { describe, expect, it } from 'vitest';
import { createAgentDynamicsApi, createMockAgentDynamicsApi } from './api';
import type { AgentDynamicsFilters, AgentDynamicsSummaryVM } from './types';

const filters: AgentDynamicsFilters = { accountId: 'acct_1', range: '24h', status: 'failed', stage: 'generation', keyword: '买家B', page: 2, pageSize: 10 };

describe('agent dynamics API adapter', () => {
  it('builds contract query parameters for summary, list, and detail', async () => {
    const calls: string[] = [];
    const summary = { asOf: '2026-09-21T00:00:00.000Z' } as AgentDynamicsSummaryVM;
    const transport = { get: async <T>(path: string) => { calls.push(path); return { success: true, data: path.includes('/summary') ? summary : path.includes('/runs/') ? summary : { items: [], total: 0, page: 2, pageSize: 10, totalPages: 1 } } as T; } };
    const api = createAgentDynamicsApi(transport);

    await api.getSummary({ accountId: 'acct_1', range: '7d' });
    await api.listRuns(filters);
    await api.getRunDetail('run/1', 'acct_1');

    expect(calls[0]).toBe('/api/v1/auto-reply/activity/summary?accountId=acct_1&range=7d');
    expect(calls[1]).toContain('/api/v1/auto-reply/runs?accountId=acct_1&range=24h&status=failed&stage=generation&keyword=%E4%B9%B0%E5%AE%B6B&page=2&pageSize=10');
    expect(calls[2]).toBe('/api/v1/auto-reply/runs/run%2F1?accountId=acct_1');
  });

  it('filters mock runs by status, stage, and keyword', async () => {
    const api = createMockAgentDynamicsApi();
    const result = await api.listRuns({ ...filters, page: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.runId).toBe('run_failed');
  });
});
