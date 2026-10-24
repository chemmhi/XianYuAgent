import { XianyuMtopClient } from '../../apps/api/src/xianyu-mtop.ts';
import { cookieHeaderFromSnapshot } from '../../apps/api/src/xianyu-cookie-jar.ts';

// Account confirmation stays in the browser that just passed, retaining its
// network service, cookies, fingerprint and platform-issued ticket.
export async function checkAccountInBrowser(context, page, input, store, { onChallenge } = {}) {
  const originalFetch = globalThis.fetch;
  try {
    await page.goto('https://www.goofish.com/robots.txt', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    for (const name of ['x5secdata', 'x5sectag', 'x5step']) await context.clearCookies({ name });
    store.json('account-check-start.json', { url: page.url(), cookies: await context.cookies() });
    globalThis.fetch = async (url, init = {}) => {
      const intended = Object.fromEntries(new Headers(init.headers).entries());
      const allowed = Object.fromEntries(Object.entries(intended).filter(([key]) =>
        !['cookie', 'origin', 'referer', 'user-agent', 'host', 'content-length'].includes(key) && !key.startsWith('sec-')));
      store.event('native.fetch.input', { url: String(url), init, allowedHeaders: allowed });
      const observedResponse = page.waitForResponse(response => response.url() === String(url) &&
        response.request().method() === (init.method ?? 'GET'), { timeout: 20_000 });
      observedResponse.catch(() => {});
      const response = await page.evaluate(async ({ url, method, headers, body }) => {
        const response = await fetch(url, { method, headers, body, credentials: 'include', mode: 'cors',
          referrer: 'https://www.goofish.com/im', signal: AbortSignal.timeout(20_000) });
        return { status: response.status, statusText: response.statusText, headers: [...response.headers],
          body: [...new Uint8Array(await response.arrayBuffer())] };
      }, { url: String(url), method: init.method ?? 'GET', headers: allowed, body: init.body });
      const networkResponse = await observedResponse;
      const actualHeaders = await networkResponse.headersArray();
      const headers = new Headers();
      for (const header of actualHeaders) headers.append(header.name, header.value);
      store.event('native.fetch.output', { ...response, actualHeaders, body: store.blob(Buffer.from(response.body)) });
      return new Response(Buffer.from(response.body), { status: response.status, statusText: response.statusText, headers });
    };
    let credential = input.credential;
    const client = new XianyuMtopClient({ timeoutMs: 20_000, loadCredential: async () => {
      const snapshot = (await context.cookies()).filter(c => /(^|\.)goofish\.com$/.test(c.domain.replace(/^\./, ''))
        && !(c.partitionKey && c._crHasCrossSiteAncestor === true));
      credential = { ...credential, cookieHeader: cookieHeaderFromSnapshot(snapshot),
        metadata: { ...credential.metadata, cookies_refresh_snapshot: JSON.stringify(snapshot) } };
      return credential;
    }, saveCookie: async (_admin, _account, cookieHeader, metadata) => { credential = { ...credential, cookieHeader, metadata }; } });
    let token = await client.fetchImToken(input.adminId, input.accountId, input.deviceId);
    if (!token.success && token.verificationUrl && onChallenge) {
      store.json('account-check-token-before-native-challenge.json', token);
      const solved = await onChallenge(token.response?.data?.url ?? token.verificationUrl);
      store.json('native-challenge-result.json', solved);
      if (solved.success) {
        await page.goto('https://www.goofish.com/robots.txt', { waitUntil: 'domcontentloaded', timeout: 30_000 });
        for (const name of ['x5secdata', 'x5sectag', 'x5step']) await context.clearCookies({ name });
        token = await client.fetchImToken(input.adminId, input.accountId, input.deviceId);
      }
    }
    store.json('account-check-token.json', token);
    const login = await client.verifyLogin(input.adminId, input.accountId);
    store.json('account-check-login.json', login);
    store.json('account-check-credential.json', credential);
    return { normal: token.success && Boolean(token.accessToken) && login.success,
      tokenSuccess: token.success, loginSuccess: login.success, hasToken: Boolean(token.accessToken),
      tokenError: token.errorCode, loginError: login.errorCode };
  } catch (error) {
    store.event('account-check.error', { error });
    return { normal: false, error: { message: error.message, stack: error.stack } };
  } finally { globalThis.fetch = originalFetch; }
}
