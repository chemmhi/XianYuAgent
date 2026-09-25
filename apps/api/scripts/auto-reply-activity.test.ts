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
  await store.updateAutoReplyRun(run.id, { status: 'generated', eventTraceId: 'trace-activity-1', eventPayload: { input: { kind: 'reply_generation', contextDigest: 'sha256:ctx' }, output: { replyDigest: 'sha256:reply', outputLength: 12 } } });
  await store.updateAutoReplyRun(run.id, { status: 'persisted', senderOutcome: 'known_success' });
  await store.updateAutoReplyRun(run.id, { replyDigest: 'sha256:reply' });
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
  assert.deepEqual(detail.events[0]?.payload.input, { kind: 'inbound_message', messageId: inbound.message.id, digest: 'sha256:in' });
  assert.deepEqual(detail.events[1]?.payload.output, { status: 'generated', decision: 'replied', intent: 'availability', replyDigest: 'sha256:reply', outputLength: 12 });
  assert.equal(detail.events[1]?.traceId, 'trace-activity-1');
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

test('auto reply activity reads repair review and policy action fields', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'activity-review@example.com', passwordHash: 'hash', displayName: 'Activity Review' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'activity-review-seller' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-review', buyerDisplayName: '复审买家' });
  const inbound = await store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '请问多少钱？', source: 'system' });
  const run = await store.createAutoReplyRun({ adminId: admin.id, accountId: account.id, conversationId: conversation.id, inboundMessageId: inbound.message.id, intent: 'price', decision: 'replied', status: 'persisted', senderOutcome: 'known_success', inputDigest: 'digest' });
  await store.appendAutoReplyRunEvent({ runId: run.id, accountId: account.id, eventType: 'repair.shadow_reviewed', stage: 'reply_generation', status: 'generated', payload: { primaryAction: 'ANSWER_FACT' } });
  const repository = new (await import('../src/auto-reply-repair-repository.js')).AutoReplyRepairRepository(store);
  await repository.insertReview({ reviewId: '11111111-1111-4111-8111-111111111111', accountId: account.id, conversationId: conversation.id, runId: run.id, goalId: '22222222-2222-4222-8222-222222222222', stateId: '33333333-3333-4333-8333-333333333333', reviewType: 'OUTCOME', decision: 'NEEDS_FOLLOWUP', resolutionStatus: 'needs_followup', reasonCodes: ['BUYER_DENIED'], evidenceRefs: ['negative-1'], evidenceTypes: ['BUYER_DENIED'], evidenceWindowStart: '2026-09-23T00:00:00.000Z', evidenceWindowEnd: '2026-09-23T00:01:00.000Z', reviewerSource: 'OUTCOME_WORKER', attempt: 1, reviewedAt: '2026-09-23T00:00:30.000Z', nextAction: 'FOLLOW_UP', idempotencyKey: 'activity-review', expectedStateVersion: 1 });
  const activity = new AutoReplyActivityService(store, repository);
  const list = await activity.list({ adminId: admin.id, query: { accountId: account.id, page: 1, pageSize: 20 } });
  assert.equal(list.items[0]?.primaryAction, 'ANSWER_FACT');
  assert.equal(list.items[0]?.nextAction, 'FOLLOW_UP');
  assert.equal(list.items[0]?.resolutionStatus, 'needs_followup');
  assert.equal(list.items[0]?.goalProgress, 'blocked');
  const detail = await activity.detail({ adminId: admin.id, runId: run.id });
  assert.equal(detail.run.primaryAction, 'ANSWER_FACT');
  assert.equal(detail.run.resolutionStatus, 'needs_followup');
});

test('auto reply activity routes return the unified envelope after session auth', async () => {
  const runtime = createApp(loadConfig({ AUTO_REPLY_AGENT_SEND_DELAY_SECONDS: '0', HOST: '127.0.0.1', PORT: '0', DATABASE_URL: '', REDIS_URL: '', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process' }));
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
