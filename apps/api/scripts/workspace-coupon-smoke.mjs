import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const port = 18600 + (process.pid % 200);
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
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'workspace-coupon-bootstrap' }, body: JSON.stringify({ email: 'workspace-coupon-smoke@example.com', password: 'password-123', displayName: 'Workspace Coupon Smoke' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const adminId = bootstrap.body.data.profile.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `workspace-coupon-${process.pid}`, displayName: '卡券账号' });
  const secret = 'SMOKE-SECRET-CONTENT';
  const session = await request('/api/v1/workspace/agent-sessions', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-coupon-session' }, body: JSON.stringify({ accountId: account.id, title: 'Coupon Smoke' }) });
  assert.equal(session.response.status, 201);
  const sessionId = session.body.data.id;
  const started = await request('/api/v1/workspace/runs', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-coupon-run' }, body: JSON.stringify({ accountId: account.id, sessionId, instruction: `新增卡券；名称：Smoke 卡券；类型：固定文字；内容：${secret}`, clientRunRef: 'workspace-coupon-run-1' }) });
  assert.equal(started.response.status, 201);
  const runId = started.body.data.runId;
  await waitForRun(runId, cookie, 'waiting_confirmation');
  const confirmation = await request(`/api/v1/workspace/runs/${runId}/confirmation`, { headers: { cookie } });
  assert.equal(confirmation.response.status, 200);
  assert.equal(confirmation.body.data.action, 'coupon_create');
  assert.equal(confirmation.body.data.manifest.label, 'Smoke 卡券');
  assert.equal(JSON.stringify(confirmation.body.data).includes(secret), false);
  const messages = await request(`/api/v1/workspace/agent-sessions/${sessionId}/messages`, { headers: { cookie } });
  assert.equal(JSON.stringify(messages.body).includes(secret), false);

  const confirmed = await request(`/api/v1/workspace/runs/${runId}/confirm`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-coupon-confirm' }, body: JSON.stringify({ expectedVersion: confirmation.body.data.version }) });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.body.data.run.status, 'succeeded');
  assert.equal(confirmed.body.data.outbox.status, 'succeeded');
  assert.equal(confirmed.body.data.outbox.operation, 'coupon_create');
  const replay = await request(`/api/v1/workspace/runs/${runId}/confirm`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-coupon-confirm' }, body: JSON.stringify({ expectedVersion: confirmation.body.data.version }) });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.data.outbox.outboxId, confirmed.body.data.outbox.outboxId);

  const batches = await request(`/api/v1/coupons/batches?accountId=${encodeURIComponent(account.id)}`, { headers: { cookie } });
  assert.equal(batches.response.status, 200);
  assert.equal(batches.body.data.items.length, 1);
  assert.equal(batches.body.data.items[0].label, 'Smoke 卡券');
  const batchId = batches.body.data.items[0].batchId;
  const detail = await request(`/api/v1/coupons/batches/${encodeURIComponent(batchId)}`, { headers: { cookie } });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.data.metadata.textContent, secret);
  const outbox = await request(`/api/v1/execution/outbox?runId=${encodeURIComponent(runId)}`, { headers: { cookie } });
  assert.equal(outbox.body.data.items[0].status, 'succeeded');
  console.log(JSON.stringify({ status: 'PASS', slice: 'WS-VS-03', runId, batchId, outboxId: confirmed.body.data.outbox.outboxId, redacted: !JSON.stringify(confirmation.body.data).includes(secret) }));
} finally {
  await runtime.close();
}
