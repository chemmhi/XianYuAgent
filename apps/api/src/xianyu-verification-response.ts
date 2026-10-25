import { classifyXianyuFailure } from './xianyu-account-health.js';

/** Shared by Node MTOP, uploads and browser MTOP. Never return payload text in logs. */
export function inspectXianyuVerification(response: unknown, raw = ''): { required: boolean; verificationUrl?: string } {
  const root = object(response);
  const data = object(root.data);
  const ret = Array.isArray(root.ret) ? root.ret.map(String) : [];
  if (ret.some(value => /FAIL_SYS_SESSION_EXPIRED|SESSION_EXPIRED/i.test(value))) return { required: false };
  const htmlTargets = raw.match(/https:\/\/[a-z0-9.-]*goofish\.com\/[^\s"'<>\\]+/gi) ?? [];
  for (const candidate of [data.url, data.verificationUrl, data.verifyUrl, root.url, root.verificationUrl, root.verifyUrl,
    ...htmlTargets.map(value => value.replaceAll('&amp;', '&'))]) {
    if (typeof candidate !== 'string') continue;
    try {
      const url = new URL(candidate, 'https://h5api.m.goofish.com');
      if (url.protocol === 'https:' && /(^|\.)goofish\.com$/.test(url.hostname) && !url.username && !url.password && !url.port
        && /punish|captcha|verify|security/i.test(`${url.pathname}${url.search}${url.hash}`)) return { required: true, verificationUrl: url.href };
    } catch { /* malformed platform field is not a navigation target */ }
  }
  return { required: ret.some(message => classifyXianyuFailure({ message }).kind === 'verification_required')
    || /FAIL_SYS_USER_VALIDATE|RGV587|FAIL_SYS_ILLEGAL_ACCESS|WUA_IS_MACHINE|["'/](?:captcha|punish)|x5sec/i.test(raw) };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
