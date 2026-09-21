import { describe, expect, it, vi } from 'vitest';
import { listWorkspaceSessions } from './controller';
import type { WorkspaceApi } from './api';

describe('workspace controller session loading', () => {
  it('forwards the server-side search term to the workspace API', async () => {
    const listSessions = vi.fn(async (_accountId?: string, _search?: string) => []);
    const api = { listSessions } as unknown as WorkspaceApi;

    await listWorkspaceSessions(api, 'account-1', '巡检');
    await listWorkspaceSessions(api, 'account-1', '库存');

    expect(listSessions).toHaveBeenNthCalledWith(1, 'account-1', '巡检');
    expect(listSessions).toHaveBeenNthCalledWith(2, 'account-1', '库存');
  });
});
