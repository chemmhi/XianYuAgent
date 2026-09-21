import { describe, expect, it } from 'vitest';
import { createAutoReplyAgentSettingsApi, createMockAutoReplyAgentSettingsApi } from './api';
import type { AutoReplyAgentConfigVM } from './types';

function config(overrides: Partial<AutoReplyAgentConfigVM> = {}): AutoReplyAgentConfigVM {
  return { adminId: 'a', configVersion: 2, configDigest: 'd', createdAt: '', updatedAt: '', enabled: true, systemPrompt: 's', userPromptTemplate: 'u', maxLoops: 4, maxToolCalls: 8, toolTimeoutMs: 1000, totalTimeoutMs: 2000, maxHistory: 10, maxReplyLength: 500, maxReplySegmentChars: 200, maxReplySegments: 3, replySegmentDelayMs: 100, debounceMs: 2000, allowPaidOrderReply: false, sendMode: 'simulate', ...overrides };
}

describe('Auto Reply Agent settings API', () => {
  it('uses the canonical settings route and optimistic version payload', async () => {
    const calls: Array<{ path: string; body?: unknown; init?: RequestInit }> = [];
    const transport: Parameters<typeof createAutoReplyAgentSettingsApi>[0] = {
      async get<T>(path: string) { calls.push({ path }); return config() as T; },
      async patch<T>(path: string, body?: unknown, init?: RequestInit) { calls.push({ path, body, init }); return config({ configVersion: 3, configDigest: 'd2', maxLoops: 6, debounceMs: 1_500 }) as T; },
    };
    const api = createAutoReplyAgentSettingsApi(transport);
    const before = await api.get();
    const after = await api.update({ expectedVersion: before.configVersion, patch: { maxLoops: 6, debounceMs: 1_500 } });
    expect(calls[0]).toEqual({ path: '/api/v1/settings/agent' });
    expect(calls[1]?.path).toBe('/api/v1/settings/agent');
    expect(calls[1]?.body).toMatchObject({ expectedVersion: 2, maxLoops: 6, debounceMs: 1_500 });
    expect(calls[1]?.init?.headers).toMatchObject({ 'Idempotency-Key': expect.stringContaining('auto-reply-agent-settings-') });
    expect(after.configVersion).toBe(3);
  });

  it('mock settings round-trip increments config version for the next Agent run', async () => {
    const api = createMockAutoReplyAgentSettingsApi();
    const before = await api.get();
    const saved = await api.update({ expectedVersion: before.configVersion, patch: { maxLoops: 7, debounceMs: 0, sendMode: 'simulate' } });
    const after = await api.get();
    expect(saved.configVersion).toBe(before.configVersion + 1);
    expect(after.maxLoops).toBe(7);
    expect(after.debounceMs).toBe(0);
    expect(after.configDigest).not.toBe(before.configDigest);
  });
});
