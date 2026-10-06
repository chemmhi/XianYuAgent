import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { InProcessAgentRuntime, WorkspaceService } from '../src/workspace.js';

test('workspace session titles are generated from the model summary', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'workspace-session-title@example.com', passwordHash: 'hash', displayName: 'Workspace Session Title' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'workspace-session-title' });
  const prompts: string[] = [];
  const service = new WorkspaceService(
    store,
    new InProcessAgentRuntime(store),
    async () => 'audit-workspace-session-title',
    undefined,
    undefined,
    undefined,
    {
      complete: async ({ messages }) => {
        prompts.push(String(messages.at(-1)?.content ?? ''));
        return { content: '启用商品自动发货', model: 'title-model' };
      },
    },
  );

  const session = await service.createSession({
    adminId: admin.id,
    accountId: account.id,
    title: '新会话',
    instruction: '给“AI工具一键下载服务”这个商品启动自动发货，内容为夸克网盘公开分享链接。',
    requestId: 'workspace-session-title',
    traceId: 'workspace-session-title',
  });

  assert.equal(session.title, '新会话');
  assert.equal(session.titlePending, true);
  let updated = await store.getAgentSession(admin.id, session.id);
  for (let attempt = 0; attempt < 20 && updated?.title !== '启用商品自动发货'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    updated = await store.getAgentSession(admin.id, session.id);
  }
  assert.equal(updated?.title, '启用商品自动发货');
  assert.equal((await service.listSessions({ adminId: admin.id, accountId: account.id }))[0]?.titlePending, false);
  assert.deepEqual(prompts, ['给“AI工具一键下载服务”这个商品启动自动发货，内容为夸克网盘公开分享链接。']);
});
