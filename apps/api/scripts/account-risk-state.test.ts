import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { DashboardService } from '../src/dashboard.js';

test('risk survives ordinary connected updates and is visible as a dashboard action', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'risk-state@example.com', passwordHash: 'hash', displayName: 'Risk' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-risk' });
  await store.updateAccount(admin.id, account.id, { status: 'connected' });
  const risk = await store.recordAccountRisk({ adminId: admin.id, accountId: account.id, code: 'ACCOUNT_VALIDATION_REQUIRED', source: 'seller.orders' });
  assert.equal(risk?.status, 'verification_required');
  await store.updateAccount(admin.id, account.id, { status: 'connected' });
  assert.equal((await store.getAccount(admin.id, account.id))?.status, 'verification_required');
  const snapshot = await new DashboardService(store).getSnapshot(admin.id, new Date(), { accountId: account.id });
  assert.ok(snapshot.riskTodos.some((todo) => todo.id === `account-${account.id}` && todo.severity === 'high'));
});

test('only success from the affected channel after the last challenge clears its episode', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'risk-cas@example.com', passwordHash: 'hash', displayName: 'Risk' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-risk-cas' });
  const before = '2026-01-01T00:00:00.000Z';
  const risk = await store.recordAccountRisk({ adminId: admin.id, accountId: account.id, code: 'RGV587', source: 'order.detail' });
  const episode = risk?.riskEpisode ?? '';
  await store.clearAccountRisk({ adminId: admin.id, accountId: account.id, episode, source: 'login.verify', startedAt: new Date().toISOString() });
  await store.clearAccountRisk({ adminId: admin.id, accountId: account.id, episode, source: 'order.detail', startedAt: before });
  assert.equal((await store.getAccount(admin.id, account.id))?.status, 'verification_required');
  await store.clearAccountRisk({ adminId: admin.id, accountId: account.id, episode, source: 'order.detail', startedAt: new Date(Date.now() + 1000).toISOString() });
  assert.equal((await store.getAccount(admin.id, account.id))?.status, 'disconnected');
  const next = await store.recordAccountRisk({ adminId: admin.id, accountId: account.id, code: 'RGV587', source: 'order.detail' });
  await store.clearAccountRisk({ adminId: admin.id, accountId: account.id, episode, source: 'order.detail', startedAt: new Date(Date.now() + 1000).toISOString() });
  assert.equal(next?.riskEpisode === episode, false);
  assert.equal((await store.getAccount(admin.id, account.id))?.status, 'verification_required');
});

test('degraded state clears only after a newer success from its own source', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'degraded-source@example.com', passwordHash: 'hash', displayName: 'Degraded' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-degraded-source' });
  await store.setAccountTransport({ adminId: admin.id, accountId: account.id, status: 'connected' });
  await store.recordAccountDegraded({ adminId: admin.id, accountId: account.id, source: 'sold.orders' });
  await store.setAccountTransport({ adminId: admin.id, accountId: account.id, status: 'connected' });
  await store.updateAccount(admin.id, account.id, { status: 'connected' });
  assert.equal((await store.getAccount(admin.id, account.id))?.status, 'degraded');
  assert.equal((await store.listAccounts(admin.id, { status: 'connected' })).total, 0);
  assert.equal((await store.listAccounts(admin.id, { connectionStatus: 'unknown' })).total, 0);
  assert.equal((await store.listAccounts(admin.id, { connectionStatus: 'online' })).total, 1, 'fresh message heartbeat is independent of an unresolved business operation');
  await store.clearAccountDegraded({ adminId: admin.id, accountId: account.id, source: 'im', startedAt: new Date(Date.now() + 1000).toISOString() });
  await store.clearAccountDegraded({ adminId: admin.id, accountId: account.id, source: 'sold.orders', startedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal((await store.getAccount(admin.id, account.id))?.status, 'degraded');
  await store.clearAccountDegraded({ adminId: admin.id, accountId: account.id, source: 'sold.orders', startedAt: new Date(Date.now() + 1000).toISOString() });
  assert.equal((await store.getAccount(admin.id, account.id))?.status, 'connected');
});

test('multiple risk sources remain active until each succeeds and then reveal underlying degradation', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'multi-risk@example.com', passwordHash: 'hash', displayName: 'Multi Risk' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-multi-risk' });
  await store.setAccountTransport({ adminId: admin.id, accountId: account.id, status: 'connected' });
  await store.recordAccountDegraded({ adminId: admin.id, accountId: account.id, source: 'order.detail' });
  const first = await store.recordAccountRisk({ adminId: admin.id, accountId: account.id, code: 'RGV587', source: 'sold.orders' });
  await store.recordAccountRisk({ adminId: admin.id, accountId: account.id, code: 'CAPTCHA', source: 'im' });
  const startedAt = new Date(Date.now() + 1000).toISOString();
  await store.clearAccountRisk({ adminId: admin.id, accountId: account.id, episode: first!.riskEpisode!, source: 'im', startedAt });
  assert.equal((await store.getAccount(admin.id, account.id))?.status, 'verification_required');
  assert.equal((await store.getAccount(admin.id, account.id))?.riskSource, 'sold.orders');
  await store.clearAccountRisk({ adminId: admin.id, accountId: account.id, episode: first!.riskEpisode!, source: 'sold.orders', startedAt });
  assert.equal((await store.getAccount(admin.id, account.id))?.status, 'degraded');
  await store.clearAccountDegraded({ adminId: admin.id, accountId: account.id, source: 'order.detail', startedAt });
  assert.equal((await store.getAccount(admin.id, account.id))?.status, 'connected');
});
