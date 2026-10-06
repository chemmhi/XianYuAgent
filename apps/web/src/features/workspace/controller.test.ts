import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getWorkspaceRunCandidates, isWorkspaceRunActive, isWorkspaceRunReconnectable, listWorkspaceSessions, pickWorkspaceRun } from './controller';
import type { WorkspaceApi } from './api';
import type { WorkspaceMessageVM, WorkspaceRunVM } from './types';

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

  it('hydrates persisted history before rendering a follow-up run', () => {
    expect(controllerSource).toContain('const persistedMessagesPromise = api.listMessages(sessionId, 500).catch(() => undefined);');
    expect(controllerSource).toContain('messages: persistedMessages ?? previous.messages');
    expect(controllerSource).toContain('api.listMessages(activeSessionId, 500)');
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
