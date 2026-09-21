import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/http';
import { defaultAgentDynamicsFilters, toAgentDynamicsLoadError } from './controller';
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
    expect(defaultAgentDynamicsFilters).toEqual({ range: '24h', status: 'all', stage: 'all', keyword: '', page: 1, pageSize: 20 });
  });

  it('maps forbidden, timeout, network, and unknown errors', () => {
    expect(toAgentDynamicsLoadError(new ApiError('denied', 403))).toMatchObject({ code: 'FORBIDDEN', retryable: false });
    expect(toAgentDynamicsLoadError(new ApiError('timeout', 504))).toMatchObject({ code: 'TIMEOUT', retryable: true });
    expect(toAgentDynamicsLoadError(new TypeError('offline'))).toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
    expect(toAgentDynamicsLoadError(new Error('boom'))).toMatchObject({ code: 'UNKNOWN', retryable: true });
  });
});
