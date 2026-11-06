import { inspectXianyuVerification } from './xianyu-verification-response.js';

export type PasswordPlatformResult = { kind: 'succeeded' } | { kind: 'verification_required'; url?: string }
  | { kind: 'failed'; code: 'PASSWORD_REJECTED' | 'PASSWORD_LOGIN_RESPONSE_INVALID' };
export function classifyPasswordLoginResponse(value: unknown): PasswordPlatformResult {
  const root = object(value), content = object(root.content), data = object(content.data);
  const challenge = inspectXianyuVerification(value);
  if (challenge.required) return { kind: 'verification_required', url: challenge.verificationUrl };
  if (data.iframeRedirect === true || data.isCheckCodeShowed === true || data.needCheckCode === true || data.showCheckCode === true || data.needCaptcha === true
    || data.needSmsCheck === true || data.needVerify === true) {
    return { kind: 'verification_required', url: safeChallengeUrl(data.iframeRedirectUrl ?? data.url) };
  }
  // A resultCode=100 may still carry an iframe verification challenge, so success is checked last.
  if (root.hasError !== true && content.success === true && data.resultCode === 100) return { kind: 'succeeded' };
  if (content.success === false || root.hasError === true || typeof data.resultCode === 'number') return { kind: 'failed', code: 'PASSWORD_REJECTED' };
  return { kind: 'failed', code: 'PASSWORD_LOGIN_RESPONSE_INVALID' };
}
export function safeChallengeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && /(^|\.)goofish\.com$/.test(url.hostname) && !url.port && !url.username && !url.password) return url.href;
  } catch { /* Untrusted platform URLs never become arbitrary navigation targets. */ }
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
