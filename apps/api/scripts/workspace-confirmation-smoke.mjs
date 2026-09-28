import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const port = 18500 + (process.pid % 200);
const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
await runtime.listen();

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const body = await response.json();
  return { response, body };
}
async function waitForRun(runId, cookie, expectedStatus) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const current = await request(`/api/v1/workspace/runs/${runId}`, { headers: { cookie } });
    if (current.body.data.status === expectedStatus) return current.body.data;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`run did not reach ${expectedStatus}`);
}

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'workspace-confirm-bootstrap' }, body: JSON.stringify({ email: 'workspace-confirm-smoke@example.com', password: 'password-123', displayName: 'Workspace Confirm Smoke' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const adminId = bootstrap.body.data.profile.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `workspace-confirm-${process.pid}`, displayName: '确认账号' });
  const product = await runtime.store.createProduct({ adminId, accountId: account.id, title: 'Workspace 待发布商品', description: 'confirmation smoke', priceMinor: 12900, status: 'draft' });
  const session = await request('/api/v1/workspace/agent-sessions', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-confirm-session' }, body: JSON.stringify({ accountId: account.id, title: 'Confirmation Smoke' }) });
  assert.equal(session.response.status, 201);
  const sessionId = session.body.data.id;
  const started = await request('/api/v1/workspace/runs', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-confirm-run' }, body: JSON.stringify({ accountId: account.id, sessionId, instruction: `发布商品 ${product.id}`, clientRunRef: 'workspace-confirm-run-1' }) });
  assert.equal(started.response.status, 201);
  const runId = started.body.data.runId;
  await waitForRun(runId, cookie, 'waiting_confirmation');
  const confirmation = await request(`/api/v1/workspace/runs/${runId}/confirmation`, { headers: { cookie } });
  assert.equal(confirmation.response.status, 200);
  assert.equal(confirmation.body.data.status, 'active');
  assert.equal(confirmation.body.data.manifest.productId, product.id);
  const confirmed = await request(`/api/v1/workspace/runs/${runId}/confirm`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-confirm-action' }, body: JSON.stringify({ expectedVersion: confirmation.body.data.version }) });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.body.data.run.status, 'executing');
  assert.equal(confirmed.body.data.outbox.status, 'pending');
  const replay = await request(`/api/v1/workspace/runs/${runId}/confirm`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-confirm-action' }, body: JSON.stringify({ expectedVersion: confirmation.body.data.version }) });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.data.outbox.outboxId, confirmed.body.data.outbox.outboxId);
  const jobs = await request(`/api/v1/execution/outbox?runId=${encodeURIComponent(runId)}`, { headers: { cookie } });
  assert.equal(jobs.response.status, 200);
  assert.equal(jobs.body.data.items.length, 1);

  const cancelRun = await request('/api/v1/workspace/runs', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-cancel-run' }, body: JSON.stringify({ accountId: account.id, sessionId, instruction: `发布商品 ${product.id}`, clientRunRef: 'workspace-confirm-run-2' }) });
  await waitForRun(cancelRun.body.data.runId, cookie, 'waiting_confirmation');
  const cancelConfirmation = await request(`/api/v1/workspace/runs/${cancelRun.body.data.runId}/confirmation`, { headers: { cookie } });
  const cancelled = await request(`/api/v1/workspace/runs/${cancelRun.body.data.runId}/cancel`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-cancel-action' }, body: JSON.stringify({ expectedVersion: cancelConfirmation.body.data.version }) });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.body.data.run.status, 'cancelled');
  assert.equal(cancelled.body.data.confirmation.status, 'cancelled');
  console.log(JSON.stringify({ productId: product.id, confirmedRun: runId, cancelRun: cancelRun.body.data.runId, outbox: confirmed.body.data.outbox.outboxId, replayedOutbox: replay.body.data.outbox.outboxId }));
} finally {
  await runtime.close();
}
