import type { XianyuVerificationContext, XianyuVerificationPage } from './xianyu-browser-port.js';
import { XIANYU_IM_APP_ID, XIANYU_IM_TOKEN_API } from './xianyu-im.js';
import { createBrowserMtopTransport } from './xianyu-browser-mtop.js';

export interface XianyuBrowserImTokenRequest { deviceId: string; expectedUserId: string }
export interface XianyuBrowserImToken { accessToken: string; deviceId: string; userId: string }

/** Keep token and identity requests in the Chrome session that passed verification. */
export async function fetchXianyuBrowserImToken(context: XianyuVerificationContext, page: XianyuVerificationPage,
  input: XianyuBrowserImTokenRequest, onChallenge?: (url: string) => Promise<void>): Promise<XianyuBrowserImToken> {
  const call = createBrowserMtopTransport(context, page, onChallenge, 'XIANYU_BROWSER_IM');
  const referer = 'https://www.goofish.com/im';
  const token = await call({ api: XIANYU_IM_TOKEN_API, version: '1.0', data: { appKey: XIANYU_IM_APP_ID, deviceId: input.deviceId }, referer });
  if (typeof token.accessToken !== 'string' || !token.accessToken.trim()) throw new Error('XIANYU_BROWSER_IM_TOKEN_MISSING');
  const login = await call({ api: 'mtop.taobao.idlemessage.pc.loginuser.get', version: '1.0', data: {}, extraParams: { needLogin: 'false' }, referer });
  const userId = String(login.userId ?? token.userId ?? '');
  if (!input.expectedUserId || userId !== input.expectedUserId || (token.userId !== undefined && String(token.userId) !== input.expectedUserId)) throw new Error('XIANYU_BROWSER_IM_IDENTITY_MISMATCH');
  return { accessToken: token.accessToken, deviceId: input.deviceId, userId };
}
