import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/http';
import { defaultAgentDynamicsFilters, agentDynamicsRunsErrorState, toAgentDynamicsLoadError } from './controller';
import { RunsTable } from './components/AgentDynamicsViews';
import type { AgentDynamicsFilters, AgentDynamicsLoadError, AgentDynamicsRunRowVM, AgentDynamicsRunsState } from './types';
import { formatDuration, runStageFromStatus, stageLabel, toneForDecision } from './types';

describe('agent dynamics controller mappings', () => {
  it('maps statuses and decisions to prototype semantics', () => {
    expect(runStageFromStatus('received')).toBe('gateway');
    expect(runStageFromStatus('context_loaded')).toBe('context');
    expect(runStageFromStatus('failed')).toBe('generation');
    expect(stageLabel('persistence')).toBe('提交并落库');
    expect(toneForDecision('replied')).toBe('success');
    expect(toneForDecision('handoff')).toBe('warn');
    expect(toneForDecision('failed')).toBe('danger');
    expect(toneForDecision('processing')).toBe('info');
    expect(formatDuration(3200)).toBe('3.2s');
  });

  it('keeps filter defaults stable for empty/list reloads', () => {
    expect(defaultAgentDynamicsFilters).toEqual({ range: '24h', status: 'all', stage: 'all', keyword: '', page: 1, pageSize: 10 });
  });

  it('maps forbidden, timeout, network, and unknown errors', () => {
    expect(toAgentDynamicsLoadError(new ApiError('denied', 403))).toMatchObject({ code: 'FORBIDDEN', retryable: false });
    expect(toAgentDynamicsLoadError(new ApiError('timeout', 504))).toMatchObject({ code: 'TIMEOUT', retryable: true });
    expect(toAgentDynamicsLoadError(new TypeError('offline'))).toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
    expect(toAgentDynamicsLoadError(new Error('boom'))).toMatchObject({ code: 'UNKNOWN', retryable: true });
  });

  it('keeps the last run page and filters visible during a failed background refresh', () => {
    const row: AgentDynamicsRunRowVM = {
      runId: 'run_keep_visible',
      createdAt: '2026-09-21T06:32:06.000Z',
      timeLabel: '14:32:06',
      buyer: { name: '保留买家' },
      inboundPreview: '保留旧数据',
      product: { name: '保留商品' },
      intent: '商品咨询',
      stage: { key: 'generation', label: '回复生成', tone: 'info' },
      decision: { key: 'replied', label: '自动回复', tone: 'success' },
      senderOutcome: { label: '已落库', tone: 'success' },
      durationMs: 1200,
      persisted: true,
    };
    const previous: AgentDynamicsRunsState = {
      phase: 'success',
      data: { items: [row], total: 1, page: 2, pageSize: 20, totalPages: 2 },
      error: null,
      refreshing: true,
    };
    const refreshError: AgentDynamicsLoadError = { code: 'NETWORK_ERROR', message: '刷新失败', retryable: true };
    const next = agentDynamicsRunsErrorState(previous, refreshError);

    expect(next.data).toBe(previous.data);
    expect(next.phase).toBe('success');
    expect(next.refreshing).toBe(false);
    expect(previous.refreshing).toBe(true);

    const filters: AgentDynamicsFilters = { range: '24h', status: 'failed', stage: 'generation', keyword: '保留关键词', page: 2, pageSize: 20 };
    const html = renderToStaticMarkup(createElement(RunsTable, {
      filters,
      data: next.data,
      onFilterChange: () => undefined,
      onOpenRun: () => undefined,
      onRetry: () => undefined,
      loading: false,
      error: next.error,
    }));
    expect(html).toContain('保留买家');
    expect(html).toContain('保留商品');
    expect(html).toContain('刷新失败');
    expect(html).toContain('保留关键词');
  });
});
