import { describe, expect, it } from 'vitest';
import { createAgentDynamicsApi, createMockAgentDynamicsApi } from './api';
import type { AgentDynamicsFilters } from './types';

const filters: AgentDynamicsFilters = { accountId: 'acct_1', range: '24h', status: 'failed', stage: 'generation', keyword: '买家B', page: 2, pageSize: 10 };

const rawRun = {
  id: 'run-1', accountId: 'acct_1', conversationId: 'conversation-1', inboundMessageId: 'message-1', intent: '商品咨询', decision: 'failed', status: 'failed', productId: 'product-1', senderOutcome: undefined, failureCode: 'RESPONSES_API_TIMEOUT', createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:03.200Z', stage: 'failed', durationMs: 3200, buyerDisplayName: '买家B', productTitle: '资料包', inboundMessagePreview: '请问购买后怎么使用？',
} as const;

const rawSummary = {
  from: '2026-09-20T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z', asOf: '2026-09-21T00:00:00.000Z', inboundCount: 1, processingCount: 0, persistedCount: 0, handoffCount: 0, failedCount: 1, skippedCount: 0, completionRate: 1, throughputPerSecond: 0.01, p95DurationMs: 3200,
  byStatus: [{ status: 'failed', count: 1 }], byStage: [{ stage: 'failed', count: 1, averageDurationMs: 3200 }], exceptions: [{ code: 'RESPONSES_API_TIMEOUT', count: 1, status: 'failed' }], health: [],
} as const;

describe('agent dynamics API adapter', () => {
  it('maps raw summary/list/detail DTOs into the canonical VM and sends range windows', async () => {
    const calls: string[] = [];
    const transport = { get: async <T>(path: string) => {
      calls.push(path);
      if (path.includes('/summary')) return { success: true, data: rawSummary } as T;
      if (path.includes('/runs/run%2F1')) return { success: true, data: { run: rawRun, events: [{ id: 'event-1', runId: 'run-1', sequence: 2, eventType: 'run.failed', stage: 'failed', status: 'failed', occurredAt: rawRun.updatedAt, durationMs: 3200, traceId: 'trace-run-1', payload: { input: { kind: 'reply_generation', contextDigest: 'sha256:ctx', outputLength: 0 }, output: { decision: 'failed' }, error: { code: 'RESPONSES_API_TIMEOUT' } } }], inboundMessage: { bodyText: '请问购买后怎么使用？' }, outboundMessages: [], product: { id: 'product-1', title: '资料包' } } } as T;
      return { success: true, data: { items: [rawRun], total: 1, page: 1, pageSize: 20, totalPages: 1 } } as T;
    } };
    const api = createAgentDynamicsApi(transport);

    const summary = await api.getSummary({ accountId: 'acct_1', range: '7d' });
    const runs = await api.listRuns({ ...filters, page: 1 });
    const detail = await api.getRunDetail('run/1', 'acct_1');

    expect(calls[0]).toMatch(/^\/api\/v1\/auto-reply\/activity\/summary\?accountId=acct_1&from=.*&to=.*$/);
    expect(calls.some((path) => path.includes('status=failed'))).toBe(true);
    expect(calls.some((path) => path.includes('stage=failed'))).toBe(true);
    expect(calls.find((path) => path.includes('/runs/run%2F1'))).toBe('/api/v1/auto-reply/runs/run%2F1?accountId=acct_1');
    expect(summary.kpis.find((item) => item.key === 'inbound')?.value).toBe('1');
    expect(summary.pipeline.find((item) => item.key === 'generation')?.count).toBe(1);
    expect(summary.exceptions[0]).toMatchObject({ key: 'RESPONSES_API_TIMEOUT', count: 1 });
    expect(summary.events[0]).toMatchObject({ runId: 'run-1', label: '失败' });
    expect(runs.items[0]).toMatchObject({ runId: 'run-1', buyer: { name: '买家B' }, stage: { key: 'generation' }, decision: { key: 'failed' }, persisted: true });
    expect(detail.timeline[0]).toMatchObject({ title: '回复生成失败', tone: 'danger', sequence: 2, traceId: 'trace-run-1' });
    expect(detail.timeline[0]?.title).not.toContain('买家B');
    expect(detail.timeline[0]?.description).toBe('异常终止：该节点返回失败，后续步骤停止');
    expect(detail.timeline[0]?.details?.input).toEqual(expect.arrayContaining([{ label: '步骤类型', value: 'reply_generation' }, { label: '输出长度', value: '0' }]));
    expect(detail.timeline[0]?.details?.technical).toEqual(expect.arrayContaining([{ label: '上下文摘要', value: 'sha256:ctx' }]));
    expect(detail.timeline[0]?.details?.output).toEqual(expect.arrayContaining([{ label: '决策结果', value: 'failed' }]));
    expect(detail.timeline[0]?.details?.error).toEqual([{ label: '错误码', value: 'RESPONSES_API_TIMEOUT' }]);
    expect(detail.timeline[0]?.details?.log).toEqual(expect.arrayContaining([{ label: '工作状态', value: '失败' }, { label: '错误码', value: 'RESPONSES_API_TIMEOUT' }]));
    expect(detail.message).toBe('请问购买后怎么使用？');
  });

  it('keeps legacy events understandable without repeating status as fake output', async () => {
    const transport = { get: async <T>(path: string) => {
      if (path.includes('/runs/run%2Fold')) return { success: true, data: { run: { ...rawRun, id: 'run-old', status: 'persisted', decision: 'replied', intent: 'general' }, events: [{ id: 'event-old', runId: 'run-old', sequence: 2, eventType: 'run.classified', stage: 'intent_recognition', status: 'classified', occurredAt: rawRun.updatedAt, payload: { decision: 'replied', intent: 'general' } }], inboundMessage: { bodyText: '你好' }, outboundMessages: [], product: { id: 'product-1', title: '资料包' } } } as T;
      return { success: true, data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 } } as T;
    } };
    const detail = await createAgentDynamicsApi(transport).getRunDetail('run/old', 'acct_1');
    expect(detail.timeline[0]).toMatchObject({ title: '意图识别完成', description: '意图识别：判断消息类型与是否允许自动回复' });
    expect(detail.timeline[0]?.title).not.toContain('买家B');
    expect(detail.timeline[0]?.details?.inferred).toBe(true);
    expect(detail.timeline[0]?.details?.input).toEqual(expect.arrayContaining([{ label: '步骤类型', value: 'intent_classification' }]));
    expect(detail.timeline[0]?.details?.output).toEqual(expect.arrayContaining([{ label: '意图', value: 'general' }, { label: '下一步', value: '读取上下文' }]));
    expect(detail.timeline[0]?.details?.note).toContain('历史记录');
    expect(detail.timeline[0]?.details?.output).not.toEqual(expect.arrayContaining([{ label: '状态变化', value: 'classified' }]));
    expect(detail.timeline[0]?.details?.log).toEqual(expect.arrayContaining([{ label: '工作状态', value: '已识别' }]));
  });

  it('maps redacted node progress into an execution log', async () => {
    const transport = { get: async <T>(path: string) => {
      if (path.includes('/runs/run%2Fprogress')) return { success: true, data: { run: { ...rawRun, id: 'run-progress', status: 'generated', decision: 'replied' }, events: [{ id: 'event-progress', runId: 'run-progress', sequence: 3, eventType: 'agent.tool.completed', stage: 'context_read', status: 'generated', occurredAt: rawRun.updatedAt, durationMs: 420, traceId: 'trace-progress', payload: { log: { node: 'Agent', phase: 'tool', state: 'completed', message: '读取商品信息完成', tool: 'get_product_info', loop: 1, result: { ok: true, productFound: true } } } }], inboundMessage: { bodyText: '请介绍商品' }, outboundMessages: [], product: { id: 'product-1', title: '资料包' } } } as T;
      return { success: true, data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 } } as T;
    } };
    const detail = await createAgentDynamicsApi(transport).getRunDetail('run/progress', 'acct_1');
    expect(detail.timeline[0]).toMatchObject({ title: 'Agent', description: '读取商品信息完成' });
    expect(detail.timeline[0]?.title).not.toContain('买家B');
    expect(detail.timeline[0]?.details?.log).toEqual(expect.arrayContaining([
      { label: '工作状态', value: '已完成' },
      { label: '阶段', value: 'tool' },
      { label: '日志', value: '读取商品信息完成' },
      { label: '工具', value: 'get_product_info' },
      { label: '循环轮次', value: '1' },
      { label: '耗时', value: '0.4s' },
    ]));
  });

  it('short-circuits live calls when no account context is selected', async () => {
    let calls = 0;
    const api = createAgentDynamicsApi({ get: async <T>() => { calls += 1; return {} as T; } });
    const summary = await api.getSummary({ range: '24h' });
    const runs = await api.listRuns({ ...filters, accountId: undefined });
    expect(calls).toBe(0);
    expect(summary.kpis.find((item) => item.key === 'inbound')?.value).toBe('0');
    expect(runs.total).toBe(0);
    await expect(api.getRunDetail('run-1')).rejects.toMatchObject({ status: 422 });
  });

  it('filters mock runs by status, stage, and keyword', async () => {
    const api = createMockAgentDynamicsApi();
    const result = await api.listRuns({ ...filters, page: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.runId).toBe('run_failed');
  });
});
