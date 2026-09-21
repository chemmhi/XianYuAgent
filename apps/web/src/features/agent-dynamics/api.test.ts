import { describe, expect, it } from 'vitest';
import { createAgentDynamicsApi, createMockAgentDynamicsApi } from './api';
import type { AgentDynamicsFilters } from './types';

const filters: AgentDynamicsFilters = { accountId: 'acct_1', range: '24h', status: 'failed', stage: 'generation', keyword: '买家B', page: 2, pageSize: 10 };

describe('agent dynamics API adapter', () => {
  it('builds contract query parameters for summary, list, and detail', async () => {
    const calls: string[] = [];
    const rawSummary = { from: '2026-09-20T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z', asOf: '2026-09-21T00:00:00.000Z', inboundCount: 1, processingCount: 0, persistedCount: 1, handoffCount: 0, failedCount: 0, skippedCount: 0, completionRate: 1, throughputPerSecond: 0.1, p95DurationMs: 3200, byStatus: [{ status: 'persisted', count: 1 }], byStage: [{ stage: 'persisted', count: 1, averageDurationMs: 3200 }], exceptions: [], health: [] };
    const rawRun = { id: 'run_1', accountId: 'acct_1', conversationId: 'conversation_1', intent: '商品咨询', decision: 'replied', status: 'persisted', stage: 'persisted', senderOutcome: 'simulated', createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:03.200Z', durationMs: 3200, buyerDisplayName: '买家一', productTitle: '资料包', inboundMessagePreview: '有货吗' };
    const rawDetail = { run: rawRun, events: [{ id: 'event_1', eventType: 'run.created', stage: 'persisted', status: 'persisted', occurredAt: '2026-09-21T00:00:03.200Z' }], conversation: { buyerDisplayName: '买家一' }, inboundMessage: { bodyText: '有货吗' }, outboundMessages: [{ bodyText: '有货', createdAt: '2026-09-21T00:00:03.200Z' }] };
    const transport = { get: async <T>(path: string) => { calls.push(path); return { success: true, data: path.includes('/summary') ? rawSummary : path.includes('/runs/') ? rawDetail : { items: [rawRun], total: 1, page: 2, pageSize: 10, totalPages: 1 } } as T; } };
    const api = createAgentDynamicsApi(transport);

    await api.getSummary({ accountId: 'acct_1', range: '7d' });
    await api.listRuns(filters);
    await api.getRunDetail('run/1', 'acct_1');

    expect(calls[0]).toMatch(/^\/api\/v1\/auto-reply\/activity\/summary\?accountId=acct_1&from=.*&to=.*$/);
    expect(calls[1]).toMatch(/^\/api\/v1\/auto-reply\/runs\?accountId=acct_1&from=.*&to=.*&decision=failed&stage=reply_generation&keyword=%E4%B9%B0%E5%AE%B6B&page=2&pageSize=10$/);
    expect(calls[2]).toBe('/api/v1/auto-reply/runs/run%2F1?accountId=acct_1');
  });

  it('maps raw summary, run list, and detail payloads into the page view model', async () => {
    const transport = { get: async <T>(path: string) => {
      if (path.includes('/summary')) return { success: true, data: { from: '2026-09-20T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z', asOf: '2026-09-21T00:00:00.000Z', inboundCount: 2, processingCount: 1, persistedCount: 1, handoffCount: 0, failedCount: 0, skippedCount: 0, completionRate: 0.5, throughputPerSecond: 0.2, p95DurationMs: 4200, byStatus: [{ status: 'persisted', count: 1 }, { status: 'generated', count: 1 }], byStage: [{ stage: 'persisted', count: 1, averageDurationMs: 3000 }], exceptions: [], health: [] } } as T;
      if (path.includes('/runs/')) return { success: true, data: { run: { id: 'run_1', accountId: 'acct_1', conversationId: 'conversation_1', intent: '商品咨询', decision: 'replied', status: 'persisted', stage: 'persisted', senderOutcome: 'simulated', createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:03.000Z', durationMs: 3000 }, events: [{ id: 'event_1', eventType: 'run.persisted', stage: 'persisted', status: 'persisted', occurredAt: '2026-09-21T00:00:03.000Z' }], conversation: { buyerDisplayName: '买家一' }, inboundMessage: { bodyText: '有货吗' }, outboundMessages: [{ bodyText: '有货' }] } } as T;
      return { success: true, data: { items: [{ id: 'run_1', accountId: 'acct_1', conversationId: 'conversation_1', intent: '商品咨询', decision: 'replied', status: 'persisted', stage: 'persisted', senderOutcome: 'simulated', createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:03.000Z', durationMs: 3000, buyerDisplayName: '买家一', productTitle: '资料包', inboundMessagePreview: '有货吗' }], total: 1, page: 1, pageSize: 20, totalPages: 1 } } as T;
    } };
    const api = createAgentDynamicsApi(transport);
    const summary = await api.getSummary({ range: '24h' });
    const runs = await api.listRuns({ ...filters, status: 'all', stage: 'all', page: 1 });
    const detail = await api.getRunDetail('run_1');
    expect(summary.kpis.find((item) => item.key === 'persisted')?.value).toBe('1');
    expect(runs.items[0]).toMatchObject({ runId: 'run_1', buyer: { name: '买家一' }, product: { name: '资料包' }, persisted: true });
    expect(detail).toMatchObject({ runId: 'run_1', message: '有货吗', reply: '有货', timeline: [{ title: 'run.persisted' }] });
  });

  it('filters mock runs by status, stage, and keyword', async () => {
    const api = createMockAgentDynamicsApi();
    const result = await api.listRuns({ ...filters, page: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.runId).toBe('run_failed');
  });
});
