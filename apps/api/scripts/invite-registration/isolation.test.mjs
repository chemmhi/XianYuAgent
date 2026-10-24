import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocket } from 'ws';
import { fixture } from './test-support.mjs';
import { InvitedUserModelPolicy } from '../../src/invited-user-model-policy.ts';

for (const kind of ['memory', 'postgres']) test(kind + ': platform-user isolation and existing settings compatibility', async t => {
  const f = await fixture(kind); t.after(() => f.close());
  const a = await f.actor('owner@example.com');
  const b = await f.actor('invited@example.com', 'user');
  const accountA = await f.runtime.store.createAccount({ adminId: a.id, platform: 'xianyu', sellerRef: 'seller-a' });
  const accountB = await f.runtime.store.createAccount({ adminId: b.id, platform: 'xianyu', sellerRef: 'seller-b' });
  await t.test('authenticated idempotency cannot replay another user settings', async () => {
    const input = { accountId: accountA.id, expectedVersion: 0, maxLoops: 6 };
    const first = await f.request('/api/v1/settings/agent', { ...a, method: 'PATCH', key: 'shared-key', body: input });
    assert.equal(first.status, 200); assert.equal(first.body.data.maxLoops, 6);
    const replay = await f.request('/api/v1/settings/agent', { ...a, method: 'PATCH', key: 'shared-key', body: input });
    assert.equal(replay.status, 200);
    const foreign = await f.request('/api/v1/settings/agent', { ...b, method: 'PATCH', key: 'shared-key', body: input });
    assert.equal(foreign.status, 403); assert.equal(foreign.body.data, null);
    const own = await f.request('/api/v1/settings/agent', { ...b, method: 'PATCH', key: 'shared-key', body: { ...input, accountId: accountB.id } });
    assert.equal(own.status, 200);
  });
  await t.test('account, model, conversation and workspace read/write are scoped', async () => {
    const list = await f.request('/api/v1/accounts', b);
    assert.deepEqual(list.body.data.items.map(item => item.id), [accountB.id]);
    for (const path of ['/api/v1/accounts/' + accountA.id, '/api/v1/settings/agent?accountId=' + accountA.id, '/api/v1/settings/openai?accountId=' + accountA.id]) assert.ok([403,404].includes((await f.request(path, b)).status), path);
    const session = await f.runtime.store.createAgentSession({ adminId: a.id, accountId: accountA.id, title: 'private' });
    await f.runtime.store.appendWorkspaceMessage({ adminId: a.id, sessionId: session.id, type: 'user_message', content: 'owner-private-message' });
    assert.equal(await f.runtime.store.getAgentSession(b.id, session.id), undefined);
    const ownerMessages = await f.request('/api/v1/workspace/agent-sessions/' + session.id + '/messages', a);
    assert.equal(ownerMessages.status, 200); assert.ok(JSON.stringify(ownerMessages.body.data).includes('owner-private-message'));
    assert.ok([403,404].includes((await f.request('/api/v1/workspace/agent-sessions/' + session.id + '/messages', b)).status));
    assert.ok([403,404].includes((await f.request('/api/v1/workspace/agent-sessions?accountId=' + accountA.id, b)).status));
    const conv = await f.runtime.store.createConversation({ adminId: a.id, accountId: accountA.id, buyerRef: 'private-buyer' });
    assert.ok([403,404].includes((await f.request('/api/v1/conversations/' + conv.id + '/messages', b)).status));
    const foreignCreate = await f.request('/api/v1/accounts', { ...b, method: 'POST', key: 'duplicate-platform', body: { platform: 'xianyu', sellerRef: 'seller-a' } });
    assert.equal(foreignCreate.status, 409);
  });
  await t.test('credential creation/update/action cache never crosses platform users', async () => {
    const createBody = { accountId:accountA.id, provider:'openai', alias:'private', apiKey:'private-credential-key' };
    const first = await f.request('/api/v1/credentials', { ...a, method:'POST', key:'credential-create', body:createBody });
    assert.equal(first.status, 201);
    const id = first.body.data.id;
    for (const [path, method, key, body] of [
      ['/api/v1/credentials', 'POST', 'credential-create', createBody],
      ['/api/v1/credentials/' + id, 'PATCH', 'credential-update', { expectedVersion:1, alias:'private-updated' }],
      ['/api/v1/credentials/' + id + '/disable', 'POST', 'credential-disable', { expectedVersion:2 }],
    ]) {
      if (key !== 'credential-create') assert.equal((await f.request(path, { ...a, method,key,body })).status, 200);
      const foreign = await f.request(path, { ...b, method,key,body });
      assert.ok([403,404].includes(foreign.status), JSON.stringify(foreign.body));
      assert.equal(foreign.body.data, null);
    }
  });
  await t.test('workspace and conversation WebSockets reject foreign resource subscriptions', async () => {
    const session = await f.runtime.store.createAgentSession({ adminId:a.id, accountId:accountA.id, title:'private-ws' });
    const { run } = await f.runtime.store.createRun({ adminId:a.id, accountId:accountA.id, sessionId:session.id, instruction:'read' });
    const conv = await f.runtime.store.createConversation({ adminId:a.id, accountId:accountA.id, buyerRef:'private-ws' });
    for (const path of ['/api/v1/workspace/runs/' + run.id + '/events', '/api/v1/conversations/' + conv.id + '/events']) {
      const status = await new Promise((resolve, reject) => {
        const ws = new WebSocket(f.origin.replace('http:', 'ws:') + path, { headers:{ cookie:b.cookie, origin: f.origin }, handshakeTimeout:2000 });
        ws.once('unexpected-response', (_req,res) => { res.resume(); ws.terminate(); resolve(res.statusCode); });
        ws.once('open', () => { ws.close(); reject(new Error('foreign WS opened')); });
        ws.on('error', () => {});
      });
      assert.ok([403,404].includes(status), String(status));
    }
  });
  await t.test('Cookie rebinding cannot overwrite either user credentials', async () => {
    await f.runtime.credentials.save({ adminId: b.id, accountId: accountB.id, cookieHeader: 'unb=seller-b; token=original', requestId:'setup', traceId:'setup' });
    const before = await f.runtime.store.getCredential(b.id, accountB.id);
    for (const path of ['/api/v1/auth/cookie-login', '/api/v1/accounts/' + accountB.id + '/credential']) {
      const result = await f.request(path, { ...b, method: path.includes('cookie-login') ? 'POST' : 'PUT', key: path, body: { accountId: accountB.id, cookieHeader: 'unb=seller-a; token=foreign' } });
      assert.equal(result.status, 409, JSON.stringify(result.body));
    }
    assert.equal((await f.runtime.store.getCredential(b.id, accountB.id)).cookieHeader, before.cookieHeader);
    assert.equal((await f.runtime.store.getAccount(a.id, accountA.id)).sellerRef, 'seller-a');
    assert.equal((await f.runtime.store.getAccount(b.id, accountB.id)).sellerRef, 'seller-b');
  });
  await t.test('host Skills are rejected at HTTP, natural-language and model-tool boundaries', async () => {
    assert.deepEqual(await f.runtime.piSkills.list(b.id), []);
    assert.equal(await f.runtime.piSkills.buildSystemPrompt(b.id), '');
    assert.equal(await f.runtime.piSkills.handleInstruction({ adminId: b.id, instruction: '安装 skill https://example.com/skill.zip' }), undefined);
    await assert.rejects(() => f.runtime.piSkills.executeModelTool('pi_skill_install', { source: 'https://example.com/skill.zip' }, { adminId: b.id, accountId: accountB.id, instruction:'install', requestId:'x', traceId:'x' }), error => error.code === 'FORBIDDEN');
    for (const suffix of ['install', 'x/execute', 'x/login', 'x/enable']) assert.equal((await f.request('/api/v1/workspace/skills/' + suffix, { ...b, method: 'POST', key: suffix, body: { source:'https://example.com/skill.zip', command:'run' } })).status, 403);
  });
  await t.test('invited-user model URLs/probes cannot reach arbitrary hosts; own trusted config still saves', async () => {
    const common = { adminId:b.id, accountId:accountB.id, role:'primary', provider:'openai', alias:'primary', model:'test', apiKey:'user-only-key', requestId:'x', traceId:'x' };
    for (const baseUrl of ['http://127.0.0.1:8080', 'https://evil.example/v1', 'https://api.openai.com.evil.example/v1']) await assert.rejects(() => f.runtime.openaiSettings.save({ ...common, baseUrl }), error => error.code === 'MODEL_ORIGIN_NOT_ALLOWED');
    await assert.rejects(() => f.runtime.openaiSettings.test({ ...common, baseUrl:'https://api.openai.com/v1', probeUrl:'http://169.254.169.254' }), error => error.code === 'MODEL_ORIGIN_NOT_ALLOWED');
    const saved = await f.runtime.openaiSettings.save({ ...common, baseUrl:'https://api.openai.com/v1' });
    assert.equal(saved.apiKeyConfigured, true);
    const resolved = await f.runtime.openaiSettings.resolveForRuntime(b.id, accountB.id);
    assert.equal(resolved[0].restrictedEndpoints, true); assert.equal(resolved[0].apiKey, 'user-only-key');
    const policy = new InvitedUserModelPolicy(f.runtime.store);
    let redirect;
    await policy.fetch(async (_url, init) => { redirect=init.redirect; return new Response('{}'); })('https://api.openai.com/v1/models');
    assert.equal(redirect, 'error');
  });
});
