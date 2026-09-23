import assert from 'node:assert/strict';
import { ReleaseGateEngine } from '../dist/auto-reply-release.js';
import { ReliableExternalAutoReplySender } from '../dist/auto-reply-outbox.js';
import { MessageService } from '../dist/messages.js';
import { MemoryStore } from '../dist/store-memory.js';

const policy = {
  releaseVersion: 'ar-vs08-enforce-v1',
  previousPolicyVersion: 'ar-vs08-shadow-v1',
  canaryPercent: 10,
  observationSeconds: 60,
  killSwitchRef: 'kill-switch:auto-reply:enforce-v1',
  requiredCheckIds: ['typecheck', 'unit', 'vs08-postgres', 'canary-sample', 'outbox', 'rollback'],
  stopConditions: [
    { metric: 'reviewRejectRate', operator: 'gte', threshold: 0.2, reasonCode: 'REVIEW_REJECT_RATE_HIGH' },
    { metric: 'sensitiveLeakRate', operator: 'gt', threshold: 0, reasonCode: 'SENSITIVE_LEAK_DETECTED' },
  ],
};

const checks = policy.requiredCheckIds.map((checkId) => ({ checkId, status: 'PASS', evidenceRef: `smoke:${checkId}` }));
const gate = new ReleaseGateEngine();
const ready = gate.assess({ policy, checks, metrics: { reviewRejectRate: 0, sensitiveLeakRate: 0 } });
assert.equal(ready.status, 'READY');
assert.equal(policy.canaryPercent, 10);

const blockedByCanaryMetric = gate.assess({ policy, checks, metrics: { reviewRejectRate: 0.25, sensitiveLeakRate: 0 } });
assert.equal(blockedByCanaryMetric.status, 'BLOCKED');
assert.deepEqual(blockedByCanaryMetric.stopReasons, ['REVIEW_REJECT_RATE_HIGH']);

const blockedByMissingMetric = gate.assess({ policy, checks, metrics: { reviewRejectRate: 0 } });
assert.equal(blockedByMissingMetric.status, 'BLOCKED');
assert.deepEqual(blockedByMissingMetric.stopReasons, ['METRIC_UNAVAILABLE:sensitiveLeakRate']);

const rolledBack = gate.rollback(policy, 'CANARY_STOPPED');
assert.equal(rolledBack.status, 'ROLLED_BACK');
assert.equal(rolledBack.releaseVersion, policy.previousPolicyVersion);
assert.deepEqual(rolledBack.evidenceRefs, [policy.killSwitchRef]);

const store = new MemoryStore();
const admin = await store.createAdmin({ email: `release-gate-smoke-${process.pid}@example.com`, passwordHash: 'hash', displayName: 'Release Gate Smoke' });
const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `release-gate-smoke-${process.pid}` });
const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: `buyer-${process.pid}`, buyerDisplayName: 'Release Gate Buyer', externalConversationRef: `conversation-${process.pid}` });
const messages = new MessageService(store, async () => 'release-gate-smoke-audit');
let externalCalls = 0;
const sender = new ReliableExternalAutoReplySender(store, messages, async (input) => {
  externalCalls += 1;
  return { externalMessageRef: `release-gate-${input.requestId}.PNM` };
}, { workerId: `release-gate-smoke:${process.pid}` });
const sendInput = {
  adminId: admin.id,
  accountId: account.id,
  requestId: `release-gate-request-${process.pid}`,
  traceId: `release-gate-trace-${process.pid}`,
  runId: `release-gate-run-${process.pid}`,
  inboundMessageId: `release-gate-inbound-${process.pid}`,
  conversation,
  recipientRef: conversation.buyerRef,
  text: '发布门禁 outbox 回放。',
  mode: 'live',
};
const firstSend = await sender.send(sendInput);
const replaySend = await sender.send(sendInput);
assert.equal(firstSend.outcome, 'known_success');
assert.equal(replaySend.outcome, 'known_success');
assert.equal(replaySend.externalMessageRef, firstSend.externalMessageRef);
assert.equal(externalCalls, 1);

const recovered = await sender.recoverRun({ adminId: admin.id, runId: sendInput.runId });
assert.equal(recovered.outboundMessageIds.length, 1);
const outbox = await store.getAutoReplyOutbox('auto_reply_send', sendInput.requestId);
assert.equal(outbox?.status, 'succeeded');
assert.equal(outbox?.externalMessageRef, firstSend.externalMessageRef);
const outbound = await store.findMessageByExternalRef(admin.id, conversation.id, firstSend.externalMessageRef);
assert.ok(outbound);

console.log(JSON.stringify({
  releaseGateReady: true,
  canaryStopConditionBlocked: true,
  missingMetricFailClosed: true,
  killSwitchRollback: rolledBack.releaseVersion === policy.previousPolicyVersion,
  outboxIdempotent: externalCalls === 1,
  outboxRecovered: recovered.outboundMessageIds.length === 1,
  outboxPersisted: outbox?.status === 'succeeded' && Boolean(outbound),
  externalAccountRequired: false,
}));
