import assert from 'node:assert/strict';
import test from 'node:test';
import { ReleaseGateEngine, ReleasePolicyError, type ReleasePolicy } from '../src/auto-reply-release.js';

const policy: ReleasePolicy = {
  releaseVersion: 'policy-v2',
  previousPolicyVersion: 'policy-v1',
  canaryPercent: 10,
  observationSeconds: 900,
  killSwitchRef: 'kill-switch:auto-reply-v2',
  requiredCheckIds: ['unit', 'integration', 'rollback'],
  stopConditions: [
    { metric: 'reviewRejectRate', operator: 'gte', threshold: 0.2, reasonCode: 'REVIEW_REJECT_RATE_HIGH' },
    { metric: 'sensitiveLeakRate', operator: 'gt', threshold: 0, reasonCode: 'SENSITIVE_LEAK_DETECTED' },
  ],
};

test('release gate is ready only when all required checks pass and stop metrics are clear', () => {
  const result = new ReleaseGateEngine().assess({ policy, checks: [{ checkId: 'unit', status: 'PASS', evidenceRef: 'test:unit' }, { checkId: 'integration', status: 'PASS', evidenceRef: 'test:integration' }, { checkId: 'rollback', status: 'PASS', evidenceRef: 'test:rollback' }], metrics: { reviewRejectRate: 0.05, sensitiveLeakRate: 0 } });
  assert.equal(result.status, 'READY');
  assert.deepEqual(result.failedChecks, []);
});

test('failed checks and configured stop conditions block release', () => {
  const result = new ReleaseGateEngine().assess({ policy, checks: [{ checkId: 'unit', status: 'PASS', evidenceRef: 'test:unit' }, { checkId: 'integration', status: 'FAIL', evidenceRef: 'test:integration' }, { checkId: 'rollback', status: 'BLOCKED', evidenceRef: 'test:rollback' }], metrics: { reviewRejectRate: 0.25, sensitiveLeakRate: 0 } });
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.failedChecks, ['integration', 'rollback']);
  assert.deepEqual(result.stopReasons, ['REVIEW_REJECT_RATE_HIGH']);
});

test('rollback returns the previous policy and records kill switch evidence', () => {
  const result = new ReleaseGateEngine().rollback(policy, 'CANARY_STOPPED');
  assert.equal(result.status, 'ROLLED_BACK');
  assert.equal(result.releaseVersion, 'policy-v1');
  assert.deepEqual(result.evidenceRefs, ['kill-switch:auto-reply-v2']);
});

test('missing kill switch or policy fails closed', () => {
  assert.throws(() => new ReleaseGateEngine().assess({ policy: undefined, checks: [], metrics: {} }), (error: unknown) => error instanceof ReleasePolicyError && error.code === 'RELEASE_POLICY_UNAVAILABLE');
  assert.throws(() => new ReleaseGateEngine().rollback({ ...policy, killSwitchRef: '' }, 'x'), (error: unknown) => error instanceof ReleasePolicyError && error.code === 'RELEASE_POLICY_UNAVAILABLE');
});
