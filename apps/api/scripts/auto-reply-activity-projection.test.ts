import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAutoReplyRun } from '../src/auto-reply-activity-projection.js';
import type { AutoReplyRunRecord } from '../src/domain.js';

function run(overrides: Partial<AutoReplyRunRecord> = {}): AutoReplyRunRecord {
  return { id: 'run-1', adminId: 'admin-1', accountId: 'account-1', conversationId: 'conversation-1', inboundMessageId: 'message-1', intent: 'price', decision: 'replied', status: 'persisted', riskFlags: [], orderRefs: [], inputDigest: 'digest', senderOutcome: 'known_success', createdAt: '2026-09-22T01:00:00.000Z', updatedAt: '2026-09-22T01:00:01.000Z', ...overrides };
}

test('legacy persisted success projects to review_pending, not resolved', () => {
  const result = projectAutoReplyRun(run());
  assert.equal(result.transportStatus, 'persisted');
  assert.equal(result.resolutionStatus, 'review_pending');
  assert.equal(result.legacyActionKind, 'LEGACY_REPLIED');
});

test('unknown or handoff legacy runs remain non-resolved and preserve reason', () => {
  const unknown = projectAutoReplyRun(run({ status: 'failed', senderOutcome: 'unknown', failureCode: 'SEND_UNKNOWN' }));
  assert.equal(unknown.resolutionStatus, 'unknown');
  assert.equal(unknown.transportStatus, 'known_failure');
  const handoff = projectAutoReplyRun(run({ decision: 'handoff', status: 'handoff', senderOutcome: undefined, failureCode: undefined }));
  assert.equal(handoff.legacyActionKind, 'LEGACY_HANDOFF');
  assert.equal(handoff.legacyHandoffReason, 'LEGACY_UNCLASSIFIED');
});
