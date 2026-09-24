import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyXianyuFailure } from '../src/xianyu-account-health.js';

describe('xianyu account failure classification', () => {
  it('treats slider validation as a recoverable verification challenge', () => {
    assert.deepEqual(classifyXianyuFailure({ errorCode: 'ACCOUNT_VALIDATION_REQUIRED', message: 'FAIL_SYS_USER_VALIDATE', accountInvalid: true }), { kind: 'verification_required' });
  });

  it('still expires credentials for real re-auth failures', () => {
    assert.deepEqual(classifyXianyuFailure({ errorCode: 'CREDENTIAL_MISSING' }), { kind: 'reauth_required', accountStatus: 'expired' });
  });

  it('keeps unrelated adapter failures degraded', () => {
    assert.deepEqual(classifyXianyuFailure({ errorCode: 'REQUEST_TIMEOUT' }), { kind: 'degraded', accountStatus: 'degraded' });
  });
});
