import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../dist/app.js';
import { createDefaultAutoReplyRepairPolicy } from '../dist/auto-reply-repair-config.js';
import { AutoReplyRepairRepository } from '../dist/auto-reply-repair-repository.js';
import { InboundInboxWorker } from '../dist/inbound-inbox-worker.js';
import { PostgresStore } from '../dist/store-postgres.js';
import { hashPassword } from '../dist/security.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const suffix = `${process.pid}-${Date.now()}`;
const ids = { adminId: undefined, accountId: undefined, conversationId: undefined, inboundMessageId: undefined, runId: undefined };
const seedStore = new PostgresStore(databaseUrl);
let runtime;
let restarted;

try {
  const admin = await seedStore.createAdmin({ email: `ar-vs08-enforce-pg-${suffix}@example.com`, passwordHash: await hashPassword('password-123'), displayName: 'AR-VS-08 Enforce PostgreSQL Smoke' });
  ids.adminId = admin.id;
  const account = await seedStore.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `ar-vs08-enforce-pg-${suffix}` });
  ids.accountId = account.id;
  const product = await seedStore.createProduct({ adminId: admin.id, accountId: account.id, externalProductRef: `ar-vs08-enforce-product-${suffix}`, title: 'AR-VS-08 PostgreSQL 商品', priceMinor: 2_590, status: 'published' });
  const conversation = await seedStore.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: `ar-vs08-enforce-buyer-${suffix}`, buyerDisplayName: 'AR-VS-08 PostgreSQL 买家', itemRef: product.externalProductRef, itemTitle: product.title, externalConversationRef: `ar-vs08-enforce-conversation-${suffix}` });
  ids.conversationId = conversation.id;
  const policyBundle = createDefaultAutoReplyRepairPolicy(account.id, new Date('2026-09-23T00:00:00.000Z'));
  await seedStore.publishAutoReplyRepairPolicy({ accountId: account.id, bundle: policyBundle });
  await seedStore.close();

  const config = {
    host: '127.0.0.1',
    port: 0,
    databaseUrl,
    cookieSecure: false,
    allowInMemory: false,
    sessionIdleMs: 1_800_000,
    sessionAbsoluteMs: 28_800_000,
    xianyuQrMode: 'stub',
    autoReplyModelEnabled: false,
    autoReplySendMode: 'simulate',
    buyerAllowlist: ['AR-VS-08 PostgreSQL 买家'],
    autoReplyRepairMode: 'enforce',
    autoReplyPolicyJson: undefined,
    autoReplyOutcomeReviewWorkerEnabled: false,
  };

  runtime = createApp(config);
  await runtime.listen();
  const externalMessageRef = `ar-vs08-enforce-inbound-${suffix}.PNM`;
  const pushed = await runtime.xianyuIm.handleExternalEvent(ids.adminId, {
    accountId: ids.accountId,
    externalConversationRef: conversation.externalConversationRef,
    externalMessageRef,
    senderRef: conversation.buyerRef,
    senderName: conversation.buyerDisplayName,
    direction: 'inbound',
    bodyType: 'text',
    bodyText: '请问价格是多少？另外不要提供 cookie。',
    occurredAt: new Date().toISOString(),
    sourceEventId: `gateway:${suffix}`,
    sourceSequence: 1001,
  }, { deferAutoReply: true });
  assert.equal(pushed.created, true);
  const inbound = await runtime.store.findMessageByExternalRef(ids.adminId, conversation.id, externalMessageRef);
  assert.ok(inbound);
  ids.inboundMessageId = inbound.id;

  const inboxWorker = new InboundInboxWorker(runtime.store, runtime.xianyuIm, { workerId: `ar-vs08-inbox-${suffix}`, batchSize: 10, leaseMs: 30_000, pollMs: 250, maxAttempts: 3 });
  assert.equal(await inboxWorker.pollOnce(), 1);
  const run = await runtime.store.findAutoReplyRunByInboundMessage(ids.adminId, inbound.id);
  assert.ok(run);
  ids.runId = run.id;
  assert.equal(run.status, 'persisted');
  assert.equal(run.decision, 'replied');
  assert.equal(run.senderOutcome, 'simulated');
  const messages = await runtime.store.listMessages(ids.adminId, conversation.id, { limit: 20 });
  const outbound = messages.items.find((message) => message.direction === 'outbound' && message.source === 'ai');
  assert.ok(outbound);
  assert.match(outbound.bodyText ?? '', /无法提供/);
  assert.match(outbound.bodyText ?? '', /25\.90/);

  const repository = new AutoReplyRepairRepository(runtime.store);
  const state = await repository.getConversationState(account.id, conversation.id);
  const reviews = await repository.listReviews(account.id, conversation.id);
  const reviewEvents = await repository.listReviewEvents(account.id, conversation.id);
  assert.equal(state?.policyVersion, policyBundle.policyConfig.policyVersion);
  assert.equal(reviews.length, 2);
  assert.equal(reviews[1]?.resolutionStatus, 'review_pending');
  assert.equal(reviewEvents.some((event) => event.payload.policyHash === policyBundle.policyConfig.policyHash), true);

  const worker = runtime.autoReplyRepair.createOutcomeReviewWorker({
    accountId: ids.accountId,
    workerId: `ar-vs08-outcome-${suffix}`,
    batchSize: 10,
    leaseSeconds: 60,
    evidenceProvider: async () => [{ evidenceId: `domain:${suffix}`, type: 'DOMAIN_FACT_SATISFIED', observedAt: new Date().toISOString(), sourceEventId: `domain:${suffix}`, summary: '商品价格事实已回答', authoritative: true }],
    now: () => new Date(Date.now() + 65_000),
  });
  const poll = await worker.pollOnce();
  assert.equal(poll.claimed, 1);
  assert.equal(poll.completed, 1);
  const resolved = await repository.getReview(reviews[1].reviewId);
  assert.equal(resolved?.resolutionStatus, 'resolved');
  const closed = await worker.close({ record: resolved, policy: policyBundle.outcomePolicy, now: new Date(Date.parse(resolved.resolvedAt) + 901_000) });
  assert.equal(closed, 'updated');
  assert.equal((await repository.getReview(reviews[1].reviewId))?.resolutionStatus, 'closed');

  const activity = await runtime.autoReplyActivity.detail({ adminId: ids.adminId, runId: run.id });
  assert.equal(activity.run.primaryAction, 'ANSWER_FACT');
  assert.equal(activity.run.resolutionStatus, 'closed');
  assert.equal(activity.run.goalProgress, 'completed');
  assert.equal(activity.inboundMessage?.id, inbound.id);

  await runtime.close();
  runtime = undefined;
  restarted = createApp(config);
  await restarted.listen();
  const reread = await restarted.autoReplyActivity.detail({ adminId: ids.adminId, runId: run.id });
  assert.equal(reread.run.resolutionStatus, 'closed');
  assert.equal(reread.run.goalProgress, 'completed');
  console.log(JSON.stringify({ vs08EnforcePostgres: true, runStatus: 'persisted', safeBusinessAnswerPersisted: true, policyHashAudited: true, outcomeReview: 'closed', activityAfterRestart: true }));
} finally {
  await runtime?.close();
  await restarted?.close();
  const cleanup = new PostgresStore(databaseUrl);
  try {
    if (ids.accountId) {
      await cleanup.pool.query('delete from settings.auto_reply_repair_policies where account_id=$1', [ids.accountId]);
      await cleanup.pool.query('delete from auto_reply_review_events where account_id=$1', [ids.accountId]);
      await cleanup.pool.query('delete from auto_reply_review_records where account_id=$1', [ids.accountId]);
      await cleanup.pool.query('delete from auto_reply_conversation_state where account_id=$1', [ids.accountId]);
      await cleanup.pool.query('delete from messages.auto_reply_inbound_inbox where account_id=$1', [ids.accountId]);
      await cleanup.pool.query('delete from messages.auto_reply_run_events where account_id=$1', [ids.accountId]);
      await cleanup.pool.query('delete from messages.auto_reply_runs where account_id=$1', [ids.accountId]);
      await cleanup.pool.query('delete from messages.messages where account_id=$1', [ids.accountId]);
      await cleanup.pool.query('delete from messages.events where account_id=$1', [ids.accountId]);
      await cleanup.pool.query('delete from messages.conversations where account_id=$1', [ids.accountId]);
      await cleanup.pool.query('delete from products.products where account_id=$1', [ids.accountId]);
      await cleanup.pool.query('delete from observability.audit_events where account_id=$1', [ids.accountId]);
      await cleanup.pool.query('delete from auth.account_credentials where account_id=$1', [ids.accountId]);
      await cleanup.pool.query('delete from auth.account_scopes where account_id=$1', [ids.accountId]);
      await cleanup.pool.query('delete from accounts.accounts where id=$1', [ids.accountId]);
    }
    if (ids.adminId) {
      await cleanup.pool.query('delete from auth.sessions where admin_id=$1', [ids.adminId]);
      await cleanup.pool.query('delete from auth.admins where id=$1', [ids.adminId]);
    }
  } finally {
    await cleanup.close();
  }
}
