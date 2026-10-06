import { describe, expect, it } from 'vitest';
import { createWorkspaceApi } from './api';

describe('workspace canonical API adapter', () => {
  it('unwraps session envelopes and preserves account-scoped query paths', async () => {
    const calls: string[] = [];
    const api = createWorkspaceApi({
      async get<T>(path: string) {
        calls.push(path);
        return { success: true, data: { items: [{ id: 'session-1', accountId: 'account-1', title: '巡检', status: 'active', lastActiveAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z' }] } } as T;
      },
    });

    const sessions = await api.listSessions('account-1', '巡检');

    expect(sessions[0]).toMatchObject({ id: 'session-1', accountId: 'account-1', title: '巡检' });
    expect(calls[0]).toBe('/api/v1/workspace/agent-sessions?accountId=account-1&search=%E5%B7%A1%E6%A3%80');
  });

  it('uses idempotent canonical mutation routes and maps a direct run envelope', async () => {
    const calls: Array<{ path: string; body?: unknown; headers?: HeadersInit }> = [];
    const api = createWorkspaceApi({
      async get<T>() { throw new Error('unexpected GET'); },
      async post<T>(path: string, body?: unknown, init?: RequestInit) {
        calls.push({ path, body, headers: init?.headers });
        return { success: true, data: { runId: 'run-1', sessionId: 'session-1', accountId: 'account-1', status: 'queued', instructionSummary: '查看状态', createdAt: '2026-09-19T00:00:00.000Z', updatedAt: '2026-09-19T00:00:00.000Z', steps: [] } } as T;
      },
    });

    const run = await api.startRun({ accountId: 'account-1', sessionId: 'session-1', instruction: '查看状态', clientRunRef: 'client-1' });

    expect(run).toMatchObject({ runId: 'run-1', sessionId: 'session-1', status: 'queued' });
    expect(calls[0]).toMatchObject({ path: '/api/v1/workspace/runs', body: { accountId: 'account-1', sessionId: 'session-1', clientRunRef: 'client-1' } });
    expect(calls[0]?.headers).toEqual(expect.objectContaining({ 'Idempotency-Key': expect.stringContaining('workspace-run-') }));
  });

  it('reads event replay from the cursor supplied by the controller', async () => {
    let requestedPath = '';
    const api = createWorkspaceApi({
      async get<T>(path: string) {
        requestedPath = path;
        return { success: true, data: { items: [{ sequence: 4, runId: 'run-1', eventType: 'run.succeeded', payload: {}, createdAt: '2026-09-19T00:00:00.000Z' }] } } as T;
      },
    });

    const events = await api.listEvents('run-1', 3);

    expect(requestedPath).toBe('/api/v1/workspace/runs/run-1/events?after=3');
    expect(events).toHaveLength(1);
    expect(events[0]?.sequence).toBe(4);
  });

  it('loads persisted workspace messages for a switched session', async () => {
    let requestedPath = '';
    const api = createWorkspaceApi({
      async get<T>(path: string) {
        requestedPath = path;
        return { success: true, data: { items: [{ id: 'message-1', sessionId: 'session-1', runId: 'run-1', type: 'user_message', content: '查看状态', createdAt: '2026-09-19T00:00:00.000Z', sequence: 1 }] } } as T;
      },
    });

    const messages = await api.listMessages('session-1');

    expect(requestedPath).toBe('/api/v1/workspace/agent-sessions/session-1/messages?limit=100');
    expect(messages[0]).toMatchObject({ id: 'message-1', title: '用户', runId: 'run-1', type: 'user_message' });
  });

  it('deletes a session through the canonical idempotent route', async () => {
    const calls: Array<{ path: string; headers?: HeadersInit }> = [];
    const api = createWorkspaceApi({
      async get<T>() { throw new Error('unexpected GET'); },
      async delete<T>(path: string, init?: RequestInit) {
        calls.push({ path, headers: init?.headers });
        return { success: true, data: { deleted: true, sessionId: 'session-1' } } as T;
      },
    });

    await expect(api.deleteSession('session-1')).resolves.toEqual({ deleted: true, sessionId: 'session-1' });
    expect(calls[0]?.path).toBe('/api/v1/workspace/agent-sessions/session-1');
    expect(calls[0]?.headers).toEqual(expect.objectContaining({ 'Idempotency-Key': expect.stringContaining('workspace-session-delete-') }));
  });

});
