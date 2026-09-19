import assert from 'node:assert/strict';

const { createMockApi } = await import('../src/api/mockApi.ts');
const { createAccountsApi, createMockAccountsApi } = await import('../src/features/accounts/api.ts');
const api = createMockApi();

const accountsDomainApi = createMockAccountsApi();
const accountsDomainPage = await accountsDomainApi.list({ search: '账号 B' });
assert.equal(accountsDomainPage.items[0]?.connection.status, 'expired');
assert.equal(accountsDomainPage.items[0]?.credentialState, 'refresh_required');

const requestedPaths = [];
const canonicalAccountsApi = createAccountsApi({
  async get(path) {
    requestedPaths.push(path);
    return { items: [], total: 0, page: 2, pageSize: 10, totalPages: 1 };
  },
});
await canonicalAccountsApi.list({ search: 'A', status: 'connected', page: 2, pageSize: 10 });
assert.equal(requestedPaths[0], '/api/v1/accounts?search=A&status=connected&page=2&pageSize=10');

const snapshot = await api.dashboard.getSnapshot();
assert.equal(snapshot.pendingManualCount, 3);
assert.equal(snapshot.availableCouponCount, 1286);

const accountPage = await api.accounts.list({ search: '账号 B' });
assert.equal(accountPage.items[0]?.id, 'B');
await api.accounts.switchAccount('B');
const switchedAccounts = await api.accounts.list();
assert.equal(switchedAccounts.items.find((account) => account.id === 'B')?.enabled, true);
assert.equal(switchedAccounts.items.find((account) => account.id === 'A')?.enabled, false);

const failedOrders = await api.orders.list({ status: 'failed' });
assert.equal(failedOrders.items[0]?.deliveryStatus, 'failed');
await api.orders.retryDelivery(failedOrders.items[0].orderNo);
const recoveredOrders = await api.orders.list({ search: failedOrders.items[0].orderNo });
assert.equal(recoveredOrders.items[0]?.deliveryStatus, 'delivered');

const run = await api.workspace.startRun({
  sessionId: 'session_product_publish',
  instruction: '生成商品发布确认卡',
  idempotencyKey: 'test-publish-001',
});
assert.equal(run.status, 'waiting_confirmation');
const confirmation = await api.workspace.getConfirmation(run.id);
assert.equal(confirmation?.policyRef, 'product.publish.confirm');
const completedRun = await api.workspace.confirm(run.id, confirmation.id);
assert.equal(completedRun.status, 'succeeded');

await api.settings.update({ replyDelaySeconds: 120 });
assert.equal((await api.settings.get()).replyDelaySeconds, 120);

console.log('mock api contract flow passed');
