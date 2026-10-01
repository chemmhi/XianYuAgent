import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelClientService, type ModelClient } from '../src/model-client.js';
import { MemoryStore } from '../src/store-memory.js';
import { PiRuntimeAdapter } from '../src/pi-runtime.js';
import { WorkspaceService } from '../src/workspace.js';

async function waitForTerminal(store: MemoryStore, adminId: string, runId: string): Promise<Awaited<ReturnType<MemoryStore['getRun']>>> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const bundle = await store.getRun(adminId, runId);
    if (bundle && ['succeeded', 'failed', 'cancelled', 'expired'].includes(bundle.run.status)) return bundle;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('workspace run did not reach terminal state');
}

test('Workspace PI resolves the account ModelClientService and fails over to backup', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'workspace-model-client@example.com', passwordHash: 'hash', displayName: 'Workspace Model Client' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'workspace-model-client' });
  const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Model client fallback' });
  const calls: string[] = [];
  const primary: ModelClient = { complete: async () => { calls.push('primary'); throw new Error('primary unavailable'); } };
  const backup: ModelClient = { complete: async () => { calls.push('backup'); return { content: 'Workspace 备用回答', model: 'backup-model' }; } };
  const accountModelClient = new ModelClientService({ primary, backup });
  const unreachableBaseClient: ModelClient = { complete: async () => { throw new Error('base client must not be used'); } };
  const runtime = new PiRuntimeAdapter(store, unreachableBaseClient, {
    model: 'workspace-model',
    resolveModelClient: async () => accountModelClient,
  });
  const workspace = new WorkspaceService(store, runtime, async () => 'audit-workspace-model-client');

  try {
    const started = await workspace.startRun({
      adminId: admin.id,
      accountId: account.id,
      sessionId: session.id,
      instruction: '请生成一句模型测试回复',
      clientRunRef: 'workspace-model-client-fallback',
      requestId: 'workspace-model-client-fallback',
      traceId: 'workspace-model-client-fallback',
    });
    const bundle = await waitForTerminal(store, admin.id, started.run.runId);

    assert.ok(bundle);
    assert.equal(bundle.run.status, 'succeeded');
    assert.equal(bundle.run.resultSummary, 'Workspace 备用回答');
    assert.deepEqual(calls, ['primary', 'backup']);
  } finally {
    runtime.stop();
  }
});
