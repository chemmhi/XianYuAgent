import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const port = 18280 + (process.pid % 300);
const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
await runtime.listen();

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}
async function waitForRun(runId, cookie) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const current = await request(`/api/v1/workspace/runs/${runId}`, { headers: { cookie } });
    if (['succeeded', 'failed', 'cancelled', 'expired'].includes(current.body.data.status)) return current.body.data;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('workspace run did not reach terminal state');
}

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'workspace-bootstrap' }, body: JSON.stringify({ email: 'workspace@example.com', password: 'password-123', displayName: 'Workspace Test' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  assert.ok(csrf);

  const account = await request('/api/v1/accounts', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-account' }, body: JSON.stringify({ platform: 'xianyu', sellerRef: 'workspace-seller', displayName: 'Workspace Account' }) });
  assert.equal(account.response.status, 201);
  const accountId = account.body.data.id;

  const createdSession = await request('/api/v1/workspace/agent-sessions', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-session' }, body: JSON.stringify({ accountId, title: '首条 Run 会话', summary: 'workspace smoke' }) });
  assert.equal(createdSession.response.status, 201);
  const sessionId = createdSession.body.data.id;
  const listedSessions = await request(`/api/v1/workspace/agent-sessions?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  assert.equal(listedSessions.body.data.items.length, 1);

  const started = await request('/api/v1/workspace/runs', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-run-request-1' }, body: JSON.stringify({ accountId, sessionId, instruction: '查询当前账号的工作区状态', clientRunRef: 'client-run-001' }) });
  assert.equal(started.response.status, 201);
  assert.equal(started.body.data.status, 'queued');
  const runId = started.body.data.runId;
  const completed = await waitForRun(runId, cookie);
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.steps[0].status, 'succeeded');

  const events = await request(`/api/v1/workspace/runs/${runId}/events?after=0`, { headers: { cookie } });
  assert.ok(events.body.data.items.some((event) => event.eventType === 'run.queued'));
  assert.ok(events.body.data.items.some((event) => event.eventType === 'run.succeeded'));

  const duplicateClientRef = await request('/api/v1/workspace/runs', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-run-request-2' }, body: JSON.stringify({ accountId, sessionId, instruction: '同一个业务请求的重复提交', clientRunRef: 'client-run-001' }) });
  assert.equal(duplicateClientRef.response.status, 200);
  assert.equal(duplicateClientRef.body.data.runId, runId);

  const idempotencyConflict = await request('/api/v1/workspace/runs', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-run-request-1' }, body: JSON.stringify({ accountId, sessionId, instruction: '不同指纹', clientRunRef: 'client-run-002' }) });
  assert.equal(idempotencyConflict.response.status, 409);
  assert.equal(idempotencyConflict.body.error.code, 'IDEMPOTENCY_CONFLICT');

  const archived = await request(`/api/v1/workspace/agent-sessions/${sessionId}/archive`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-session-archive' }, body: JSON.stringify({}) });
  assert.equal(archived.response.status, 200);
  const blockedRun = await request('/api/v1/workspace/runs', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-run-request-3' }, body: JSON.stringify({ accountId, sessionId, instruction: '归档会话不可写', clientRunRef: 'client-run-003' }) });
  assert.equal(blockedRun.response.status, 409);

  const admin = await runtime.store.findAdminByEmail('workspace@example.com');
  assert.ok(admin);
  const activeDeleteTarget = await request('/api/v1/workspace/agent-sessions', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-session-active-delete-target' }, body: JSON.stringify({ accountId, title: '删除活动会话', summary: 'active run delete smoke' }) });
  assert.equal(activeDeleteTarget.response.status, 201);
  const activeDeleteTargetId = activeDeleteTarget.body.data.id;
  const activeRun = await runtime.store.createRun({ adminId: admin.id, accountId, sessionId: activeDeleteTargetId, instruction: '保留为活动状态以验证删除', clientRunRef: 'active-delete-smoke' });
  assert.equal(activeRun.run.status, 'queued');
  const activeDeleted = await request(`/api/v1/workspace/agent-sessions/${activeDeleteTargetId}`, { method: 'DELETE', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-session-active-delete' } });
  assert.equal(activeDeleted.response.status, 200);
  assert.deepEqual(activeDeleted.body.data, { deleted: true, sessionId: activeDeleteTargetId });

  const deletableSession = await request('/api/v1/workspace/agent-sessions', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-session-delete-target' }, body: JSON.stringify({ accountId, title: '待删除会话', summary: 'delete smoke' }) });
  assert.equal(deletableSession.response.status, 201);
  const deletableSessionId = deletableSession.body.data.id;
  const deleteRun = await request('/api/v1/workspace/runs', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-delete-run' }, body: JSON.stringify({ accountId, sessionId: deletableSessionId, instruction: '为删除链路生成终态记录', clientRunRef: 'workspace-delete-run' }) });
  assert.equal(deleteRun.response.status, 201);
  assert.equal((await waitForRun(deleteRun.body.data.runId, cookie)).status, 'succeeded');
  const deleted = await request(`/api/v1/workspace/agent-sessions/${deletableSessionId}`, { method: 'DELETE', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-session-delete' } });
  assert.equal(deleted.response.status, 200);
  assert.deepEqual(deleted.body.data, { deleted: true, sessionId: deletableSessionId });
  const deletedMessages = await request(`/api/v1/workspace/agent-sessions/${deletableSessionId}/messages`, { headers: { cookie } });
  assert.equal(deletedMessages.response.status, 404);
  const remaining = await request(`/api/v1/workspace/agent-sessions?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  assert.ok(remaining.body.data.items.every((item) => item.id !== deletableSessionId));

  console.log('workspace session/run smoke passed');
} finally {
  await runtime.close();
}
