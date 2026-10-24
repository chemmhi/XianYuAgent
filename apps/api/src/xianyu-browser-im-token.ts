import { createHash } from 'node:crypto';
import type { XianyuVerificationContext, XianyuVerificationPage } from './xianyu-browser-port.js';
import { XIANYU_IM_APP_ID, XIANYU_IM_APP_KEY, XIANYU_IM_TOKEN_API } from './xianyu-im.js';

export interface XianyuBrowserImTokenRequest {
  deviceId: string;
  expectedUserId: string;
}

export interface XianyuBrowserImToken {
  accessToken: string;
  deviceId: string;
  userId: string;
}

class BrowserChallengeRequired extends Error {
  constructor(readonly verificationUrl: string) { super('XIANYU_BROWSER_IM_CHALLENGE_REQUIRED'); }
}
class BrowserSigningCookieRequired extends Error {
  constructor() { super('XIANYU_BROWSER_SIGNING_COOKIE_REFRESH_REQUIRED'); }
}

/** Keep requests in the Chrome session that passed the challenge. */
export async function fetchXianyuBrowserImToken(
  context: XianyuVerificationContext,
  page: XianyuVerificationPage,
  input: XianyuBrowserImTokenRequest,
  onChallenge?: (verificationUrl: string) => Promise<void>,
): Promise<XianyuBrowserImToken> {
  const prepareRequest = async () => {
    await page.goto('https://www.goofish.com/robots.txt', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const stale = (await context.cookies()).filter(cookie => ['x5secdata', 'x5sectag', 'x5step'].includes(cookie.name));
    if (stale.length) await context.addCookies(stale.map(cookie => ({ ...cookie, value: '', expires: 1 })));
  };
  await prepareRequest();

  const call = async (api: string, data: Record<string, string>, extraParams: Record<string, string> = {}): Promise<Record<string, unknown>> => {
    // Read the signing cookie as the page sees it, including Chrome partitions.
    const cookieHeader = await page.evaluate(() => document.cookie);
    const token = cookieHeader.split(';').map(value => value.trim()).find(value => value.startsWith('_m_h5_tk='))
      ?.slice('_m_h5_tk='.length).split('_', 1)[0] ?? '';
    if (!token && api !== XIANYU_IM_TOKEN_API) throw new Error('XIANYU_BROWSER_IM_TOKEN_MISSING');
    const dataValue = JSON.stringify(data);
    const timestamp = String(Date.now());
    const sign = createHash('md5').update(`${token}&${timestamp}&${XIANYU_IM_APP_KEY}&${dataValue}`).digest('hex');
    const params = new URLSearchParams({ jsv: '2.7.2', appKey: XIANYU_IM_APP_KEY, t: timestamp, sign,
      v: '1.0', type: 'originaljson', accountSite: 'xianyu', dataType: 'json', timeout: '20000', api,
      sessionOption: 'AutoLoginOnly', spm_cnt: 'a21ybx.im.0.0', ...extraParams });
    const response = await page.evaluate(async ({ url, body }) => {
      const result = await fetch(url, { method: 'POST', credentials: 'include', mode: 'cors',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        referrer: 'https://www.goofish.com/im', body, signal: AbortSignal.timeout(20_000) });
      if (!result.ok) throw new Error('XIANYU_BROWSER_IM_HTTP_FAILED');
      return await result.json() as { ret?: string[]; data?: Record<string, unknown> };
    }, { url: `https://h5api.m.goofish.com/h5/${api}/1.0/?${params}`, body: new URLSearchParams({ data: dataValue }).toString() });
    if (!response.ret?.some(value => value.startsWith('SUCCESS::'))) {
      // Let native MTOP bootstrap/rotate an expired signing cookie. Chrome
      // applies Set-Cookie before the next request reads document.cookie.
      if (response.ret?.some(value => /FAIL_SYS_TOKEN_(?:EMPTY|EXOIRED|EXPIRED)/.test(value))) throw new BrowserSigningCookieRequired();
      const challengeUrl = response.data?.url;
      if (api === XIANYU_IM_TOKEN_API && typeof challengeUrl === 'string'
        && response.ret?.some(value => /FAIL_SYS_USER_VALIDATE|RGV587_ERROR/.test(value))) {
        const url = new URL(challengeUrl);
        if (url.protocol === 'https:' && /(^|\.)goofish\.com$/.test(url.hostname)) throw new BrowserChallengeRequired(challengeUrl);
      }
      throw new Error('XIANYU_BROWSER_IM_REQUEST_FAILED');
    }
    return response.data ?? {};
  };

  const fetchToken = () => call(XIANYU_IM_TOKEN_API, { appKey: XIANYU_IM_APP_ID, deviceId: input.deviceId });
  let token: Record<string, unknown> | undefined;
  const solvedChallenges = new Set<string>();
  for (let attempt = 0; attempt < 6; attempt++) {
    try { token = await fetchToken(); break; }
    catch (error) {
      if (error instanceof BrowserSigningCookieRequired && attempt < 5) continue;
      if (!(error instanceof BrowserChallengeRequired) || !onChallenge
        || solvedChallenges.size >= 2 || solvedChallenges.has(error.verificationUrl)) throw error;
      solvedChallenges.add(error.verificationUrl);
      await onChallenge(error.verificationUrl);
      await prepareRequest();
    }
  }
  if (typeof token?.accessToken !== 'string' || !token.accessToken.trim()) throw new Error('XIANYU_BROWSER_IM_TOKEN_MISSING');
  const login = await call('mtop.taobao.idlemessage.pc.loginuser.get', {}, { needLogin: 'false' });
  const userId = String(login.userId ?? token.userId ?? '');
  if (!input.expectedUserId || userId !== input.expectedUserId
    || (token.userId !== undefined && String(token.userId) !== input.expectedUserId)) {
    throw new Error('XIANYU_BROWSER_IM_IDENTITY_MISMATCH');
  }
  return { accessToken: token.accessToken, deviceId: input.deviceId, userId };
}
