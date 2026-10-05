import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

const port = 18600 + (process.pid % 200);
const runtime = createApp({ host: '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
await runtime.listen();

function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }
async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  return { response, body: await response.json() };
}
async function waitFor(runId, cookie, status) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const current = await request(`/api/v1/workspace/runs/${runId}`, { headers: { cookie } });
    if (current.body.data.status === status) return current.body.data;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`run ${runId} did not reach ${status}`);
}
async function runCommand({ cookie, csrf, accountId, sessionId, instruction, key }) {
  const started = await request('/api/v1/workspace/runs', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': key }, body: JSON.stringify({ accountId, sessionId, instruction, clientRunRef: key }) });
  assert.equal(started.response.status, 201);
  return waitFor(started.body.data.runId, cookie, 'succeeded');
}

try {
  const bootstrap = await request('/api/v1/auth/bootstrap', { method: 'POST', headers: { 'Idempotency-Key': 'workspace-platform-bootstrap' }, body: JSON.stringify({ email: 'workspace-platform@example.com', password: 'password-123', displayName: 'Workspace Platform' }) });
  assert.equal(bootstrap.response.status, 200);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = decodeURIComponent(cookie.match(/csrf_token=([^;]+)/)?.[1] ?? '');
  const adminId = bootstrap.body.data.profile.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `workspace-platform-${process.pid}`, displayName: 'Workspace Platform Account' });
  const coupon = await runtime.store.createCouponBatch({ adminId, accountId: account.id, label: 'Workspace coupon', purpose: 'text', metadata: { textContent: 'test coupon' }, status: 'paused' });
  const session = await request('/api/v1/workspace/agent-sessions', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-platform-session' }, body: JSON.stringify({ accountId: account.id, title: 'Platform takeover' }) });
  assert.equal(session.response.status, 201);
  const sessionId = session.body.data.id;

  runtime.xianyu.fetchItemsAll = async () => ({ pages: [{ success: true, accountInvalid: false, cookieHeader: '', pageNumber: 1, pageSize: 20, items: [], hasMore: false }], items: [], hasMore: false });
  runtime.xianyu.fetchOrdersAll = async () => ({ pages: [{ success: true, accountInvalid: false, pageNumber: 1, pageSize: 30, items: [], hasMore: false }], items: [], hasMore: false });
  runtime.xianyu.verifyLogin = async () => ({ success: false, accountInvalid: true, errorCode: 'ACCOUNT_EXPIRED', message: 'fixture account expired' });

  const accountHealth = await runCommand({ cookie, csrf, accountId: account.id, sessionId, instruction: '检查账号连接状态', key: 'workspace-platform-account-health' });
  assert.match(accountHealth.resultSummary, /重新授权|连接/);
  const accountRecovery = await runCommand({ cookie, csrf, accountId: account.id, sessionId, instruction: '账号失效，创建二维码登录恢复', key: 'workspace-platform-account-recovery' });
  assert.match(accountRecovery.resultSummary, /登录恢复/);
  const dashboard = await runCommand({ cookie, csrf, accountId: account.id, sessionId, instruction: '分析近7天经营情况', key: 'workspace-platform-dashboard' });
  assert.match(dashboard.resultSummary, /经营|销售|运营/);
  const products = await runCommand({ cookie, csrf, accountId: account.id, sessionId, instruction: '刷新商品列表', key: 'workspace-platform-products' });
  assert.match(products.resultSummary, /同步|商品/);
  const orders = await runCommand({ cookie, csrf, accountId: account.id, sessionId, instruction: '同步闲鱼订单', key: 'workspace-platform-orders' });
  assert.match(orders.resultSummary, /同步|订单/);
  const agent = await runCommand({ cookie, csrf, accountId: account.id, sessionId, instruction: '检查 Agent 工作流程', key: 'workspace-platform-agent' });
  assert.match(agent.resultSummary, /Agent/);

  const pending = await request('/api/v1/workspace/runs', { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-platform-coupon-run' }, body: JSON.stringify({ accountId: account.id, sessionId, instruction: `启用卡券 ${coupon.id}`, clientRunRef: 'workspace-platform-coupon-run' }) });
  assert.equal(pending.response.status, 201);
  const waiting = await waitFor(pending.body.data.runId, cookie, 'waiting_confirmation');
  const confirmation = await request(`/api/v1/workspace/runs/${waiting.runId}/confirmation`, { headers: { cookie } });
  assert.equal(confirmation.body.data.action, 'coupon_enable');
  const confirmed = await request(`/api/v1/workspace/runs/${waiting.runId}/confirm`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': 'workspace-platform-coupon-confirm' }, body: JSON.stringify({ expectedVersion: confirmation.body.data.version }) });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.body.data.run.status, 'succeeded');
  assert.equal(confirmed.body.data.outbox.status, 'succeeded');
  const refreshedCoupon = await runtime.store.getCouponBatch(adminId, coupon.id);
  assert.equal(refreshedCoupon?.status, 'active');
  console.log('workspace platform takeover smoke passed');
} finally {
  await runtime.close();
}
