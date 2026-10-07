import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getWorkspaceRunCandidates, isWorkspaceRunActive, isWorkspaceRunReconnectable, listWorkspaceSessions, mergeWorkspaceSessionTitles, pickWorkspaceRun, shouldAutoReconnectWorkspaceRun } from './controller';
import type { WorkspaceApi } from './api';
import type { WorkspaceMessageVM, WorkspaceRunVM, WorkspaceSessionVM } from './types';

const controllerSource = readFileSync(fileURLToPath(new URL('./controller.ts', import.meta.url)), 'utf8');

describe('workspace controller session loading', () => {
  it('treats retryable and in-flight runs as active for the loading indicator', () => {
    expect(isWorkspaceRunActive('queued')).toBe(true);
    expect(isWorkspaceRunActive('retrying')).toBe(true);
    expect(isWorkspaceRunActive('succeeded')).toBe(false);
    expect(isWorkspaceRunActive('failed')).toBe(false);
    expect(isWorkspaceRunReconnectable('failed')).toBe(true);
    expect(isWorkspaceRunReconnectable('waiting_confirmation')).toBe(false);
  });

  it('forwards the server-side search term to the workspace API', async () => {
    const listSessions = vi.fn(async (_accountId?: string, _search?: string) => []);
    const api = { listSessions } as unknown as WorkspaceApi;

    await listWorkspaceSessions(api, 'account-1', '巡检');
    await listWorkspaceSessions(api, 'account-1', '库存');

    expect(listSessions).toHaveBeenNthCalledWith(1, 'account-1', '巡检');
    expect(listSessions).toHaveBeenNthCalledWith(2, 'account-1', '库存');
  });

  it('marks rehydrated active runs for one automatic realtime reconnect', () => {
    expect(shouldAutoReconnectWorkspaceRun('running', 'reconnecting')).toBe(true);
    expect(shouldAutoReconnectWorkspaceRun('succeeded', 'reconnecting')).toBe(false);
    expect(shouldAutoReconnectWorkspaceRun('running', 'idle')).toBe(false);
  });

  it('keeps an optimistic title while the server still reports the fallback title', () => {
    const previous = [{ id: 'session-1', accountId: 'account-1', title: '检查商品自动发货', status: 'active', lastActiveAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' }] satisfies WorkspaceSessionVM[];
    const next = [{ ...previous[0], title: '新会话', titlePending: true }] satisfies WorkspaceSessionVM[];
    expect(mergeWorkspaceSessionTitles(previous, next)[0]?.title).toBe('检查商品自动发货');
  });

  it('tracks conversation detail loading separately from the session list phase', () => {
    expect(controllerSource).toContain("conversationLoading: Boolean(activeSessionId)");
    expect(controllerSource).toContain("conversationLoading: false, sessions: mergeWorkspaceSessionTitles(previous.sessions, hydratedSessions)");
    expect(controllerSource).toContain("activeSessionId: sessionId, conversationLoading: true");
  });

  it('hydrates persisted history before rendering a follow-up run', () => {
    expect(controllerSource).toContain('const persistedMessagesPromise = api.listMessages(sessionId, 500).catch(() => undefined);');
    expect(controllerSource).toContain('messages: persistedMessages ?? previous.messages');
    expect(controllerSource).toContain('api.listMessages(activeSessionId, 500)');
  });

  it('schedules an active recovered run for reconnect when switching sessions', () => {
    const switchSessionSource = controllerSource.slice(controllerSource.indexOf('const switchSession'), controllerSource.indexOf('const archiveSession'));
    expect(switchSessionSource).toContain('reconnectOnHydrateRunRef.current = recovered.run && isWorkspaceRunActive(recovered.run.status) ? recovered.run.runId : undefined;');
    expect(switchSessionSource).toContain("connection: reconnectOnHydrateRunRef.current ? 'reconnecting' : 'idle'");
  });
});

describe('workspace confirmation recovery', () => {
  it('keeps non-terminal runs recoverable even when a later run is terminal', () => {
    const messages: WorkspaceMessageVM[] = [
      { id: 'user-1', runId: 'run-waiting', type: 'user_message', createdAt: '2026-10-06T00:00:00.000Z', title: '用户', content: '需要确认' },
      { id: 'user-2', runId: 'run-succeeded', type: 'user_message', createdAt: '2026-10-06T00:01:00.000Z', title: '用户', content: '后续查询' },
    ];
    const candidates = getWorkspaceRunCandidates(messages);
    expect(candidates).toEqual(['run-succeeded', 'run-waiting']);

    const waiting = { runId: 'run-waiting', status: 'waiting_confirmation' } as WorkspaceRunVM;
    const running = { runId: 'run-running', status: 'running' } as WorkspaceRunVM;
    const succeeded = { runId: 'run-succeeded', status: 'succeeded' } as WorkspaceRunVM;
    expect(pickWorkspaceRun([succeeded, waiting])).toBe(waiting);
    expect(pickWorkspaceRun([running, waiting])).toBe(waiting);
  });
});
