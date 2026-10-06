import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { InProcessAgentRuntime, WorkspaceService } from '../src/workspace.js';

test('workspace active run can be cancelled before runtime writes a result', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'workspace-cancel@example.com', passwordHash: 'hash', displayName: 'Workspace Cancel' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'workspace-cancel' });
  const runtime = new InProcessAgentRuntime(store);
  const service = new WorkspaceService(store, runtime, async () => 'audit-workspace-cancel');

  const session = await service.createSession({ adminId: admin.id, accountId: account.id, title: '取消测试', requestId: 'session', traceId: 'session' });
  const started = await service.startRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: '读取当前状态', requestId: 'run', traceId: 'run' });
  const cancelled = await service.cancelActiveRun({ adminId: admin.id, runId: started.run.runId, requestId: 'cancel', traceId: 'cancel' });

  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.finishedAt);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const latest = await service.getRun({ adminId: admin.id, runId: started.run.runId });
  assert.equal(latest.status, 'cancelled');
  assert.equal(latest.steps[0]?.status, 'cancelled');
  const messages = await service.listMessages({ adminId: admin.id, sessionId: session.id });
  assert.equal(messages.at(-1)?.content, '任务已取消');
});
