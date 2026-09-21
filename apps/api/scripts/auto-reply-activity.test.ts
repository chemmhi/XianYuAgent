import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from 'node:http';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { AutoReplyActivityService } from '../src/auto-reply-activity.js';
import { MemoryStore } from '../src/store-memory.js';

test('auto reply activity persists events and exposes summary/list/detail', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'activity@example.com', passwordHash: 'hash', displayName: 'Activity' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'activity-seller' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-1', buyerDisplayName: '买家一', itemTitle: '资料包' });
  const inbound = await store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '有货吗', source: 'human' });
  const run = await store.createAutoReplyRun({ adminId: admin.id, accountId: account.id, conversationId: conversation.id, inboundMessageId: inbound.message.id, intent: 'availability', decision: 'replied', status: 'received', inputDigest: 'sha256:in' });
  await store.updateAutoReplyRun(run.id, { status: 'generated' });
  await store.updateAutoReplyRun(run.id, { status: 'persisted', senderOutcome: 'known_success' });
  const activity = new AutoReplyActivityService(store);
  const from = new Date(Date.now() - 60_000).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  const list = await activity.list({ adminId: admin.id, query: { accountId: account.id, from, to, page: 1, pageSize: 20 } });
  assert.equal(list.total, 1);
  assert.equal(list.items[0]?.stage, 'persisted');
  const detail = await activity.detail({ adminId: admin.id, runId: run.id });
  assert.equal(detail.run.id, run.id);
  assert.equal(detail.events.length, 3);
  assert.equal(detail.inboundMessage?.bodyText, '有货吗');
  const summary = await activity.summary({ adminId: admin.id, accountId: account.id, from, to });
  assert.equal(summary.inboundCount, 1);
  assert.equal(summary.persistedCount, 1);
  assert.equal(summary.completionRate, 1);
});

test('auto reply activity enforces account scope and date validation', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'activity-validation@example.com', passwordHash: 'hash', displayName: 'Activity' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'activity-validation-seller' });
  const service = new AutoReplyActivityService(store);
  await assert.rejects(() => service.list({ adminId: admin.id, query: { accountId: 'missing', page: 1, pageSize: 20 } }), /account scope required/);
  await assert.rejects(() => service.summary({ adminId: admin.id, accountId: account.id, from: '2026-09-22T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z' }), /from must be before/);
});

test('auto reply activity routes return the unified envelope after session auth', async () => {
  const runtime = createApp(loadConfig({ HOST: '127.0.0.1', PORT: '0', DATABASE_URL: '', REDIS_URL: '', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process' }));
  await runtime.listen();
  try {
    const address = runtime.server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const boot = await httpJson(`${base}/api/v1/auth/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'activity-route-bootstrap' }, body: JSON.stringify({ email: 'activity-route@example.com', password: 'password-123', displayName: 'Activity Route' }) });
    assert.equal(boot.status, 200);
    const cookie = (boot.headers['set-cookie'] ?? []).map((value) => value.split(';', 1)[0]).join('; ');
    const account = await runtime.store.createAccount({ adminId: String(boot.body.data.profile.id), platform: 'xianyu', sellerRef: 'activity-route-seller' });
    const now = new Date();
    const summary = await httpJson(`${base}/api/v1/auto-reply/activity/summary?accountId=${encodeURIComponent(account.id)}&from=${encodeURIComponent(new Date(now.getTime() - 60_000).toISOString())}&to=${encodeURIComponent(new Date(now.getTime() + 60_000).toISOString())}`, { headers: { cookie } });
    assert.equal(summary.status, 200);
    assert.equal(summary.body.success, true);
    assert.equal(summary.body.data.inboundCount, 0);
  } finally {
    await runtime.close();
  }
});

async function httpJson(url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: any }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = request({ hostname: target.hostname, port: Number(target.port), path: `${target.pathname}${target.search}`, method: options.method ?? 'GET', headers: options.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); resolve({ status: res.statusCode ?? 0, headers: res.headers as Record<string, string | string[] | undefined>, body: text ? JSON.parse(text) : undefined }); });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
