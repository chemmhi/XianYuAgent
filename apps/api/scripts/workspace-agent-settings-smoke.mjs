import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const port = 18700 + (process.pid % 200);
const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
await runtime.listen();

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}
async function waitForRun(runId, cookie, expectedStatus) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const current = await request(`/api/v1/workspace/runs/${runId}`, { headers: { cookie } });
    if (current.body.data.status === expectedStatus) return current.body.data;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`run did not reach ${expectedStatus}`);
}

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'workspace-agent-settings-bootstrap' }, body: JSON.stringify({ email: 'workspace-agent-settings-smoke@example.com', password: 'password-123', displayName: 'Workspace Agent Settings Smoke' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const adminId = bootstrap.body.data.profile.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `workspace-agent-${process.pid}`, displayName: '配置账号' });
  const session = await request('/api/v1/workspace/agent-sessions', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-agent-settings-session' }, body: JSON.stringify({ accountId: account.id, title: 'Agent Settings Smoke' }) });
  assert.equal(session.response.status, 201);
  const sessionId = session.body.data.id;
  const instruction = '修改自动回复配置；启用：否；最大循环次数：6；发送延迟：12秒';
  const started = await request('/api/v1/workspace/runs', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-agent-settings-run' }, body: JSON.stringify({ accountId: account.id, sessionId, instruction, clientRunRef: 'workspace-agent-settings-run-1' }) });
  assert.equal(started.response.status, 201);
  const runId = started.body.data.runId;
  await waitForRun(runId, cookie, 'waiting_confirmation');
  const confirmation = await request(`/api/v1/workspace/runs/${runId}/confirmation`, { headers: { cookie } });
  assert.equal(confirmation.response.status, 200);
  assert.equal(confirmation.body.data.action, 'agent_settings_update');
  assert.equal(confirmation.body.data.policyRef, 'agent.settings.update.confirm');
  assert.equal(confirmation.body.data.manifest.changes[0].field, 'enabled');
  assert.equal(JSON.stringify(confirmation.body.data).includes(instruction), false);
  const messages = await request(`/api/v1/workspace/agent-sessions/${sessionId}/messages`, { headers: { cookie } });
  assert.equal(JSON.stringify(messages.body).includes(instruction), false);
  const confirmed = await request(`/api/v1/workspace/runs/${runId}/confirm`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-agent-settings-confirm' }, body: JSON.stringify({ expectedVersion: confirmation.body.data.version }) });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.body.data.run.status, 'succeeded');
  assert.equal(confirmed.body.data.outbox.status, 'succeeded');
  assert.equal(confirmed.body.data.outbox.operation, 'agent_settings_update');
  const saved = await request(`/api/v1/settings/agent?accountId=${encodeURIComponent(account.id)}`, { headers: { cookie } });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.data.configVersion, 1);
  assert.equal(saved.body.data.enabled, false);
  assert.equal(saved.body.data.maxLoops, 6);
  assert.equal(saved.body.data.sendDelaySeconds, 12);
  console.log(JSON.stringify({ status: 'PASS', slice: 'WS-VS-04', runId, configVersion: saved.body.data.configVersion, outboxId: confirmed.body.data.outbox.outboxId, redacted: !JSON.stringify(messages.body).includes(instruction) }));
} finally {
  await runtime.close();
}
