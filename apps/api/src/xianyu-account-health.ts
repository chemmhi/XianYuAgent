import type { AccountStatus } from './domain.js';

export type XianyuFailureKind = 'verification_required' | 'reauth_required' | 'degraded';

export interface XianyuFailureClassification {
  kind: XianyuFailureKind;
  accountStatus?: Extract<AccountStatus, 'expired' | 'degraded'>;
}

export function classifyXianyuFailure(input: { errorCode?: string; message?: string; accountInvalid?: boolean }): XianyuFailureClassification {
  const text = `${input.errorCode ?? ''} ${input.message ?? ''}`;
  const requiresVerification = /ACCOUNT_VALIDATION_REQUIRED|FAIL_SYS_USER_VALIDATE|X5SEC|CAPTCHA|SLIDER/i.test(text);
  if (requiresVerification) return { kind: 'verification_required' };

  const requiresReauth = Boolean(input.accountInvalid)
    || /CREDENTIAL_MISSING|SESSION_EXPIRED|MTOP_TOKEN_(MISSING|EXPIRED)|IM_TOKEN_FAILED|XIANYU_IM_TOKEN_FAILED|REQUEST_REJECTED:401|USER_VALIDATE|LOGIN.*INVALID/i.test(text);
  if (requiresReauth) return { kind: 'reauth_required', accountStatus: 'expired' };

  return { kind: 'degraded', accountStatus: 'degraded' };
}
