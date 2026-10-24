import fs from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'patchright';
import { createRecordingStore } from './store.mjs';
import { installBrowserRecording } from './browser.mjs';
import { installHttpRecording } from './http.mjs';
import { createTarProfileSnapshot } from './profile-archive.mjs';
import { cookieHeaderFromSnapshot } from '../../apps/api/src/xianyu-cookie-jar.ts';
import { XianyuMtopClient } from '../../apps/api/src/xianyu-mtop.ts';
import { checkAccountInBrowser } from './ydisks-native-account.mjs';
import { solveNativeChallenge } from './ydisks-context-solver.mjs';

const directory = process.env.XIANYU_COPY_INPUT_DIR;
const root = process.env.XIANYU_RECORD_DIR;
if (directory !== '/copy' || !root?.startsWith('/evidence/')) throw Error('Isolated Linux evidence paths required');
const store = createRecordingStore(root);
const nativeRecovery = process.env.XIANYU_COPY_NATIVE_RECOVERY === 'true';
const input = JSON.parse(fs.readFileSync(join(directory, nativeRecovery ? 'native-recovery-input.json' : 'restored-after-challenge-input.json'), 'utf8'));
const configuration = JSON.parse(fs.readFileSync(join(directory, `${process.env.XIANYU_COPY_PASS_CASE ?? 'linux-scope-retry'}-challenge/input.json`), 'utf8')).configuration;
store.json('input.json', { input, env: process.env, configuration });
store.json('executed-source.json', { body: store.blob(fs.readFileSync(new URL(import.meta.url)), 'mjs') });
await installBrowserRecording(store, { snapshotProfile: createTarProfileSnapshot(store),
  traceOptions: { screenshots: false, snapshots: false, sources: true } });
let context;
const drain = installHttpRecording(store);
try {
  context = await chromium.launchPersistentContext('/browser-data/copied/1d274de5-38b8-4c9b-83ed-d8ba803685ac', {
    channel: 'chrome', headless: false, viewport: null, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: 'light',
    args: [...configuration.launchArgs, '--use-angle=swiftshader'], proxy: { server: process.env.XIANYU_COPY_PROXY },
  });
  const page = context.pages()[0] ?? await context.newPage();
  await page.addInitScript(configuration.stealthScript);
  if (process.env.XIANYU_COPY_REUSE_PROFILE_ONLY !== 'true') await context.addCookies(nativeRecovery ? input.cookieSnapshot.filter(c => !c.name.startsWith('x5') &&
    !['_m_h5_tk', '_m_h5_tk_enc', 'mtop_partitioned_detect'].includes(c.name)) : input.cookieSnapshot);
  if (nativeRecovery) for (const name of ['x5sec', 'x5secdata', 'x5sectag', 'x5step']) await context.clearCookies({ name });
  if (process.env.XIANYU_COPY_USE_SHARED_CHECK === 'true') {
    const verdict = await checkAccountInBrowser(context, page, input, store, nativeRecovery ? {
      onChallenge: url => solveNativeChallenge(context, page, url, join(directory, 'upstream'), store),
    } : {});
    store.json('account-verdict.json', verdict);
    console.log(JSON.stringify(verdict));
  } else {
  // A static document supplies the legitimate web origin without starting a
  // second application/SDK token refresh concurrently with this check.
  await page.goto('https://www.goofish.com/robots.txt', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  for (const name of ['x5secdata', 'x5sectag', 'x5step']) await context.clearCookies({ name });
  store.json('before-check-cookies.json', await context.cookies());
  globalThis.fetch = async (url, init = {}) => {
    const intended = Object.fromEntries(new Headers(init.headers).entries());
    const allowed = Object.fromEntries(Object.entries(intended).filter(([key]) =>
      !['cookie', 'origin', 'referer', 'user-agent', 'host', 'content-length'].includes(key) && !key.startsWith('sec-')));
    store.event('native.fetch.input', { url: String(url), init, allowedHeaders: allowed });
    const response = await page.evaluate(async ({ url, method, headers, body }) => {
      const response = await fetch(url, { method, headers, body, credentials: 'include', mode: 'cors',
        referrer: 'https://www.goofish.com/im', signal: AbortSignal.timeout(20000) });
      return { status: response.status, statusText: response.statusText, headers: [...response.headers],
        body: [...new Uint8Array(await response.arrayBuffer())] };
    }, { url: String(url), method: init.method ?? 'GET', headers: allowed, body: init.body });
    store.event('native.fetch.output', { ...response, body: store.blob(Buffer.from(response.body)) });
    return new Response(Buffer.from(response.body), { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  let credential = input.credential;
  const client = new XianyuMtopClient({ timeoutMs: 20_000, loadCredential: async () => {
    const snapshot = (await context.cookies()).filter(c => /(^|\.)goofish\.com$/.test(c.domain.replace(/^\./, '')));
    credential = { ...credential, cookieHeader: cookieHeaderFromSnapshot(snapshot),
      metadata: { ...credential.metadata, cookies_refresh_snapshot: JSON.stringify(snapshot) } };
    return credential;
  }, saveCookie: async (_admin, _account, cookieHeader, metadata) => { credential = { ...credential, cookieHeader, metadata }; } });
  for (const step of ['fetchImToken', 'verifyLogin']) {
    const result = step === 'fetchImToken' ? await client.fetchImToken(input.adminId, input.accountId, input.deviceId)
      : await client.verifyLogin(input.adminId, input.accountId);
    store.json(`${step}.json`, result);
    console.log(JSON.stringify({ step, success: result.success, errorCode: result.errorCode, hasToken: Boolean(result.accessToken), hasChallenge: Boolean(result.verificationUrl) }));
  }
  store.json('final-credential.json', credential);
  store.json('final-cookies.json', await context.cookies());
  await page.screenshot({ path: join(root, 'account-page.png'), fullPage: true });
  }
} finally { if (context) await context.close(); await drain(); }
