import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { resolveAutoReplyAgentConfig } from '../dist/auto-reply-agent-config.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const suffix = `${process.pid}-${Date.now()}`;
let runtime;
let adminId;
let accountId;
let conversationId;
let runId;

try {
  runtime = createApp({
    host: '127.0.0.1', port: 0, databaseUrl, redisUrl: '', cookieSecure: false, allowInMemory: false,
    sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub',
    agentRuntime: 'in-process', modelTimeoutMs: 5_000, autoReplyModelEnabled: false,
    autoReplySendMode: 'simulate', buyerAllowlist: [], autoReplyRepairMode: 'enforce',
    autoReplyOutcomeReviewWorkerEnabled: false, autoReplyOutcomeReviewWorkerPollMs: 1_000,
    autoReplyOutcomeReviewWorkerBatchSize: 10, autoReplyOutcomeReviewWorkerLeaseSeconds: 60,
    autoReplyAgent: resolveAutoReplyAgentConfig({ AUTO_REPLY_AGENT_SEND_DELAY_SECONDS: '0', AUTO_REPLY_AGENT_DEBOUNCE_MS: '0', AUTO_REPLY_AGENT_REPLY_SEGMENT_DELAY_MS: '0' }),
    credentialEncryptionKey: 'activity-review-postgres-smoke', objectStorageEndpoint: 'http://127.0.0.1:19000',
    objectStorageAccessKey: 'xianyu', objectStorageSecretKey: 'xianyu_dev_only', objectStorageBucket: 'xianyu-assets', objectStorageRegion: 'us-east-1',
  });
  await runtime.listen();
  const admin = await runtime.store.createAdmin({ email: `activity-review-pg-${suffix}@example.com`, passwordHash: 'hash', displayName: 'Activity Review PG' });
  adminId = admin.id;
  const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: `activity-review-pg-${suffix}` });
  accountId = account.id;
  const product = await runtime.store.createProduct({ adminId, accountId, externalProductRef: `activity-review-item-${suffix}`, title: 'Activity Review 商品', priceMinor: 2_590, status: 'published' });
  const conversation = await runtime.store.createConversation({ adminId, accountId, buyerRef: `activity-review-buyer-${suffix}`, buyerDisplayName: 'Activity Review Buyer', itemRef: product.externalProductRef, itemTitle: product.title, externalConversationRef: `activity-review-conversation-${suffix}` });
  conversationId = conversation.id;
  const inbound = await runtime.store.createMessage({ adminId, conversationId, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '请问多少钱？', source: 'human', externalMessageRef: `activity-review-message-${suffix}.PNM` });
  const result = await runtime.autoReply.processInbound({ adminId, conversationId, inboundMessageId: inbound.message.id, requestId: `activity-review-request-${suffix}`, traceId: `activity-review-trace-${suffix}` });
  runId = result.run.id;
  const from = new Date(Date.now() - 60_000).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  const list = await runtime.autoReplyActivity.list({ adminId, query: { accountId, from, to, page: 1, pageSize: 20 } });
  const detail = await runtime.autoReplyActivity.detail({ adminId, runId });
  const reviewRows = await runtime.store.pool.query('select review_type, resolution_status from auto_reply_review_records where run_id=$1 order by review_type', [runId]);
  assert.equal(list.total, 1);
  assert.equal(list.items[0]?.resolutionStatus, 'review_pending');
  assert.equal(list.items[0]?.primaryAction, 'ANSWER_FACT');
  assert.equal(detail.run.resolutionStatus, 'review_pending');
  assert.equal(detail.run.primaryAction, 'ANSWER_FACT');
  assert.deepEqual(reviewRows.rows.map((row) => row.review_type), ['OUTCOME', 'PRE_SEND']);
  assert.ok(reviewRows.rows.every((row) => row.resolution_status === 'review_pending' || row.resolution_status === 'unknown'));
  console.log(JSON.stringify({ activityReviewPostgres: true, runId, resolutionStatus: detail.run.resolutionStatus, primaryAction: detail.run.primaryAction }));
} finally {
  if (runtime?.store?.pool) {
    if (runId) await runtime.store.pool.query('delete from messages.auto_reply_run_events where run_id=$1', [runId]);
    if (runId) await runtime.store.pool.query('delete from messages.auto_reply_runs where id=$1', [runId]);
    if (accountId) await runtime.store.pool.query('delete from auto_reply_review_events where account_id=$1', [accountId]);
    if (accountId) await runtime.store.pool.query('delete from auto_reply_review_records where account_id=$1', [accountId]);
    if (accountId) await runtime.store.pool.query('delete from auto_reply_conversation_state where account_id=$1', [accountId]);
    if (accountId) await runtime.store.pool.query('delete from settings.auto_reply_repair_policies where account_id=$1', [accountId]);
    if (accountId) await runtime.store.pool.query('delete from messages.messages where account_id=$1', [accountId]);
    if (accountId) await runtime.store.pool.query('delete from messages.events where account_id=$1', [accountId]);
    if (conversationId) await runtime.store.pool.query('delete from messages.conversations where id=$1', [conversationId]);
    if (accountId) await runtime.store.pool.query('delete from products.products where account_id=$1', [accountId]);
    if (accountId) await runtime.store.pool.query('delete from observability.audit_events where account_id=$1', [accountId]);
    if (accountId) await runtime.store.pool.query('delete from auth.account_scopes where account_id=$1', [accountId]);
    if (accountId) await runtime.store.pool.query('delete from accounts.accounts where id=$1', [accountId]);
    if (adminId) await runtime.store.pool.query('delete from auth.sessions where admin_id=$1', [adminId]);
    if (adminId) await runtime.store.pool.query('delete from auth.admins where id=$1', [adminId]);
  }
  if (runtime) await runtime.close();
}
