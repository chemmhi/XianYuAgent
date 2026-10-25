import { createHash } from 'node:crypto';
import { browserStageError, completeBrowserChallenge } from './xianyu-browser-challenge-handoff.js';
import type { XianyuVerificationContext, XianyuVerificationPage } from './xianyu-browser-port.js';
import { inspectXianyuVerification } from './xianyu-verification-response.js';
import { resolveVerificationReadRequest, type XianyuReadRequest } from './xianyu-verification-request.js';

interface BrowserRequest { api: string; version: string; data: Record<string, unknown>; extraParams?: Record<string, string>; referer: string }

/** Native Chrome transport shared by IM recovery and read API recovery. */
export function createBrowserMtopTransport(context: XianyuVerificationContext, page: XianyuVerificationPage,
  onChallenge?: (url: string) => Promise<void>, prefix = 'XIANYU_BROWSER_MTOP') {
  let challenges = 0;
  return async (request: BrowserRequest): Promise<Record<string, unknown>> => {
    const prepare = async () => {
      const origin = new URL(request.referer).origin;
      // A challenge callback can stay on the same origin. Leaving that page
      // immediately after code=0 aborts its session exchange.
      if (!page.url().startsWith(`${origin}/`)) {
        try { await page.goto(`${origin}/robots.txt`, { waitUntil: 'domcontentloaded', timeout: 30_000 }); }
        catch (error) { throw browserStageError(prefix, 'PREPARE_NAVIGATION', error); }
      }
      try {
        const stale = (await context.cookies()).filter(cookie => ['x5secdata', 'x5sectag', 'x5step'].includes(cookie.name));
        if (stale.length) await context.addCookies(stale.map(cookie => ({ ...cookie, value: '', expires: 1 })));
      } catch (error) { throw browserStageError(prefix, 'PREPARE_COOKIES', error); }
    };
    await prepare();
    for (let attempt = 0; attempt < 6; attempt++) {
      let cookieHeader: string;
      try { cookieHeader = await page.evaluate(() => document.cookie); }
      catch (error) { throw browserStageError(prefix, 'READ_COOKIES', error); }
      const token = cookieHeader.split(';').map(value => value.trim()).find(value => value.startsWith('_m_h5_tk='))
        ?.slice('_m_h5_tk='.length).split('_', 1)[0] ?? '';
      const data = JSON.stringify(request.data);
      const t = String(Date.now());
      const sign = createHash('md5').update(`${token}&${t}&34839810&${data}`).digest('hex');
      const sold = request.api === 'mtop.taobao.idle.trade.merchant.sold.get';
      const params = new URLSearchParams({ jsv: '2.7.2', appKey: '34839810', t, sign, v: request.version,
        type: sold ? 'json' : 'originaljson', accountSite: 'xianyu', dataType: 'json', timeout: '20000', api: request.api,
        sessionOption: 'AutoLoginOnly', spm_cnt: sold ? 'a21107h.42831410.0.0' : 'a21ybx.im.0.0',
        ...(sold ? { valueType: 'string' } : {}), ...request.extraParams });
      let response: { status: number; payload?: { ret?: unknown; data?: Record<string, unknown> }; failure?: string; raw?: string; finalUrl?: string };
      try {
        response = await page.evaluate(async ({ url, body, referer }) => {
          try {
            const result = await fetch(url, { method: 'POST', credentials: 'include', mode: 'cors',
              headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
              referrer: referer, body, signal: AbortSignal.timeout(20_000) });
            const raw = await result.text();
            try { return { status: result.status, payload: JSON.parse(raw) }; }
            catch { return { status: result.status, raw: raw.slice(0, 65_536), finalUrl: result.url }; }
          } catch { return { status: 0, failure: 'NETWORK_FAILED' }; }
        }, { url: `https://h5api.m.goofish.com/h5/${request.api}/${request.version}/?${params}`,
          body: new URLSearchParams({ data }).toString(), referer: request.referer });
      } catch { throw new Error(`${prefix}_CONTEXT_FAILED`); }
      if (response.failure) throw new Error(`${prefix}_${response.failure}`);
      const ret = Array.isArray(response.payload?.ret) ? response.payload.ret.map(String) : [];
      const verification = inspectXianyuVerification(response.payload ?? { url: response.finalUrl }, response.raw);
      if (!verification.required && ret.length && ret.every(value => value.startsWith('SUCCESS::')) && response.status >= 200 && response.status < 300) return response.payload?.data ?? {};
      const retCodes = ret.map(value => value.split('::', 1)[0]).filter(value => /^[A-Z0-9_]{1,80}$/.test(value));
      console.warn(JSON.stringify({ component: 'xianyu-browser-mtop', event: 'request_rejected', api: request.api, status: response.status, retCodes }));
      if (ret.some(value => /FAIL_SYS_TOKEN_(?:EMPTY|EXOIRED|EXPIRED)/.test(value)) && attempt < 5) continue;
      if (ret.some(value => /FAIL_SYS_SESSION_EXPIRED/.test(value)) || response.status === 401) throw new Error(`${prefix}_SESSION_EXPIRED`);
      const candidate = verification.verificationUrl;
      if (verification.required && candidate && onChallenge) {
        let url: URL;
        try { url = new URL(candidate, 'https://h5api.m.goofish.com'); } catch { throw new Error(`${prefix}_CHALLENGE_URL_INVALID`); }
        if (url.protocol !== 'https:' || !/(^|\.)goofish\.com$/.test(url.hostname) || url.username || url.password || url.port) throw new Error(`${prefix}_CHALLENGE_URL_INVALID`);
        if (challenges >= 2 || attempt >= 5) throw new Error(`${prefix}_CHALLENGE_UNRESOLVED`);
        challenges++;
        await completeBrowserChallenge(page, () => onChallenge(url.href), prefix);
        await prepare();
        continue;
      }
      if (verification.required) throw new Error(`${prefix}_CHALLENGE_REQUIRED`);
      if (!response.payload) throw new Error(`${prefix}_INVALID_RESPONSE`);
      throw new Error(`${prefix}_REQUEST_FAILED`);
    }
    throw new Error(`${prefix}_RETRY_EXHAUSTED`);
  };
}

export async function verifyXianyuBrowserRead(context: XianyuVerificationContext, page: XianyuVerificationPage,
  request: XianyuReadRequest, expectedUserId: string, onChallenge: (url: string) => Promise<void>): Promise<{ api: string; userId: string }> {
  const checked = resolveVerificationReadRequest(request.api, request);
  if (!checked) throw new Error('XIANYU_VERIFICATION_REQUEST_INVALID');
  const call = createBrowserMtopTransport(context, page, onChallenge);
  await call(checked);
  const login = await call({ api: 'mtop.taobao.idlemessage.pc.loginuser.get', version: '1.0', data: {},
    extraParams: { needLogin: 'false' }, referer: 'https://www.goofish.com/im' });
  if (!expectedUserId || String(login.userId ?? '') !== expectedUserId) throw new Error('XIANYU_BROWSER_MTOP_IDENTITY_MISMATCH');
  return { api: checked.api, userId: expectedUserId };
}
