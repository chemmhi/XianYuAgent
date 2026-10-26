import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import type { BrowserContext } from 'patchright';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPatchrightVerificationBrowserFactory } from '../src/patchright-verification-browser.js';
import { XianyuImClient, XIANYU_IM_TOKEN_API } from '../src/xianyu-im.js';
import { sha256, hashPassword } from '../src/security.js';
import { PostgresStore } from '../src/store-postgres.js';

/** Controlled platform only. All production service/HTTP/WS/Chrome paths remain real. */
export async function createVerificationServiceFixture(options: { databaseUrl?: string; webOrigin?: string; nativeChallenge?: boolean; rejectFirstSlide?: boolean; nativeFrontend?: boolean } = {}) {
  if (options.nativeFrontend && !options.nativeChallenge) throw new Error('nativeChallenge is required for native frontend fixture');
  if (options.rejectFirstSlide && !options.nativeChallenge) throw new Error('nativeChallenge is required for rejection/reset fixture');
  if (options.databaseUrl && (!['localhost', '127.0.0.1'].includes(new URL(options.databaseUrl).hostname)
    || !['/xianyu_manual_verification_test', '/xianyu_manual_verification_ui_test'].includes(new URL(options.databaseUrl).pathname))) throw new Error('isolated verification DB required');
  const profile = await mkdtemp(join(tmpdir(), 'verification-service-'));
  const gateway = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(gateway, 'listening');
  const gatewayPort = (gateway.address() as { port: number }).port;
  const stats = { browserLaunches: 0, slideAnswers: 0, registrations: 0, heartbeats: 0, serverTokenRequests: 0, browserTokenRequests: 0, pointerDowns: 0, refreshes: 0 };
  let accepted = false; const contexts: BrowserContext[] = [];
  const approved = (cookie = '') => options.nativeFrontend
    ? /(?:^|;)\s*x5sec=native-frontend-passed(?:;|$)/.test(cookie) && /(?:^|;)\s*x5sectag=fixture-context(?:;|$)/.test(cookie) : accepted;
  gateway.on('connection', socket => socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.lwp === '/reg') stats.registrations++;
    if (message.lwp === '/!') stats.heartbeats++;
    if (message.lwp) socket.send(JSON.stringify({ code: 200, headers: { mid: message.headers.mid }, body: {} }));
  }));
  const originalFetch = globalThis.fetch;
  const nativePath = '/h5/mtop.taobao.idlemessage.pc.login.token/1.0/_____tmd_____/punish';
  const validation = { ret: ['FAIL_SYS_USER_VALIDATE::verification'], data: { url: options.nativeChallenge
    ? `https://h5api.m.goofish.com${nativePath}?x5secdata=controlled-fixture&x5step=2&action=captcha` : 'https://www.goofish.com/punish' } };
  const nativeHtml = `<!doctype html><meta charset="utf-8"><body style="margin:0;width:420px;height:320px;background:white">
    <style>.nc-container .scale_text.slidetounlock>span[data-nc-lang="SLIDE"]{display:inline-block;width:100%;background:-webkit-gradient(linear,left top,right top,color-stop(0,#4d4d4d),color-stop(.4,#4d4d4d),color-stop(.5,#fff),color-stop(.6,#4d4d4d),color-stop(1,#4d4d4d));-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:slidetounlock 3s infinite}@keyframes slidetounlock{0%{background-position:-200px 0}100%{background-position:200px 0}}</style>
    <img alt="验证图标" style="position:absolute;left:160px;top:20px;width:100px;height:100px" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Ccircle cx='50' cy='50' r='48' fill='orange'/%3E%3C/svg%3E">
    <p style="position:absolute;left:0;top:133px;width:420px;text-align:center;margin:0">亲，请拖动下方滑块完成验证</p>
    <p style="position:absolute;left:0;top:160px;width:420px;text-align:center;margin:0">通过验证以确保正常访问</p>
    <div class="nc-container" style="position:absolute;left:60px;top:195px;width:300px;height:34px;background:#ddd">
      <div class="nc_wrapper" style="position:relative;width:300px;height:34px">
      <div class="nc_bg" style="position:absolute;left:0;top:0;width:0;height:34px;background:green"></div>
      <div class="scale_text slidetounlock" style="position:absolute;left:0;top:0;width:300px;height:34px;text-align:center;line-height:34px"><span data-nc-lang="SLIDE">请按住滑块，拖动完成验证</span></div>
      <span id="nc_1_n1z" role="button" tabindex="0" style="position:absolute;left:2px;top:2px;width:42px;height:30px;background:white">拖动</span></div></div>
    <img alt="验证二维码" style="position:absolute;left:180px;top:237px;width:60px;height:60px" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Cpath d='M0 0h20v20H0zM40 0h20v20H40zM0 40h20v20H0zM30 30h10v10H30zM40 40h20v20H40z' fill='black'/%3E%3C/svg%3E">
    <script>let down=false;const wrapper=document.querySelector('.nc_wrapper'),initial=wrapper.innerHTML;function bind(){document.querySelector('#nc_1_n1z').onmousedown=e=>{down=true;e.currentTarget.setAttribute('data-spm-anchor-id','fixture-tracking');fetch('/fixture-pointer-down');};}bind();
    function reject(){wrapper.innerHTML='<div id="nc_1_refresh1" class="errloading" style="height:34px;line-height:34px;text-align:center;font-size:14px">验证失败，点击框体重试<span class="nc-errcode">(300)</span></div>';wrapper.onmousedown=e=>{e.target.setAttribute('data-spm-anchor-id','fixture-refresh-tracking');wrapper.onmousedown=null;down=false;wrapper.innerHTML=initial;bind();fetch('/fixture-native-refresh');};}
    document.onmousemove=e=>{if(down){document.querySelector('.nc_bg').style.width=Math.min(300,Math.max(0,e.clientX-60))+'px';document.querySelector('#nc_1_n1z').style.left=Math.min(258,Math.max(2,e.clientX-78))+'px';}};document.onmouseup=async e=>{const wasDown=down;down=false;if(wasDown&&e.clientX>320){const answer=await(await fetch('/slide')).json();if(answer.code===0&&answer.success===true){document.cookie='x5sec=passed; path=/; secure';${options.nativeFrontend ? `parent.postMessage(JSON.stringify({type:'child',content:JSON.stringify({smToken:'token',queryToken:'sm',sm:'sm',x5sec:JSON.stringify({value:'native-frontend-passed',expire:String(Date.now()+600000),host:location.host})})}),'*');` : ''}}else reject();}};</script>`;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    if (url.hostname !== 'h5api.m.goofish.com') return originalFetch(input, init);
    const api = url.searchParams.get('api') ?? '';
    if (api === XIANYU_IM_TOKEN_API) { stats.serverTokenRequests++; return new Response(JSON.stringify(approved(new Headers(init?.headers).get('cookie') ?? '') ? { ret: ['SUCCESS::OK'], data: { accessToken: 'fixture-access', userId: 'seller-1' } } : validation), { headers: { 'content-type': 'application/json' } }); }
    return new Response(JSON.stringify({ ret: ['SUCCESS::OK'], data: { userId: 'seller-1' } }), { headers: { 'content-type': 'application/json' } });
  };
  const factory = createPatchrightVerificationBrowserFactory();
  const runtime = createApp(loadConfig({ HOST: '127.0.0.1', PORT: '0', DATABASE_URL: options.databaseUrl ?? '', REDIS_URL: '',
    ALLOW_IN_MEMORY: options.databaseUrl ? 'false' : 'true', COOKIE_SECURE: 'false', XIANYU_QR_MODE: 'stub',
    XIANYU_VERIFICATION_BROWSER_MODE: 'launch', XIANYU_VERIFICATION_SLIDER_MODE: 'auto', XIANYU_VERIFICATION_BROWSER_HEADLESS: 'true',
    XIANYU_VERIFICATION_BROWSER_USER_DATA_DIR: profile, XIANYU_VERIFICATION_REMOTE_ENABLED: 'true',
    XIANYU_VERIFICATION_NATIVE_ENABLED: options.nativeFrontend ? 'true' : 'false',
    WS_ALLOWED_ORIGINS: options.webOrigin ?? 'http://127.0.0.1:5173', AGENT_RUNTIME: 'in-process', AUTO_REPLY_MODEL_ENABLED: 'false',
    AUTO_REPLY_OUTCOME_REVIEW_WORKER_ENABLED: 'false', AUTO_REPLY_POLICY_BOOTSTRAP_DEFAULT: 'false',
  }), {
    imClientFactory: input => new XianyuImClient({ ...input, webSocketFactory: () => new WebSocket(`ws://127.0.0.1:${gatewayPort}`) as never }),
    verificationBrowserFactory: { launchPersistentContext: async launch => {
      stats.browserLaunches++;
      const context = await factory.launchPersistentContext(launch); const raw = context as unknown as BrowserContext; contexts.push(raw);
      await raw.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/fixture-pointer-down') { stats.pointerDowns++; await route.fulfill({ body: 'ok' }); return; }
        if (url.pathname === '/fixture-native-refresh') { stats.refreshes++; await route.fulfill({ body: 'ok' }); return; }
        if (url.pathname === '/slide') { stats.slideAnswers++; accepted = !options.rejectFirstSlide || stats.slideAnswers > 1; await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: accepted ? 0 : 300, success: true }) }); return; }
        if (url.pathname === nativePath && options.nativeChallenge) {
          const embedded = !!route.request().frame().parentFrame() && url.searchParams.has('pureCaptcha');
          await route.fulfill({ contentType: 'text/html;charset=utf-8', body: embedded ? nativeHtml : '<header>unknown standalone logo</header><p>请完成安全验证</p><footer>unknown copyright must not be accepted</footer>' }); return;
        }
        if (url.hostname === 'h5api.m.goofish.com') {
          const api = url.searchParams.get('api'); if (api === XIANYU_IM_TOKEN_API) stats.browserTokenRequests++;
          await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://www.goofish.com', 'access-control-allow-credentials': 'true' },
            body: JSON.stringify(api === XIANYU_IM_TOKEN_API && !approved(route.request().headers().cookie) ? validation : { ret: ['SUCCESS::OK'], data: api === XIANYU_IM_TOKEN_API ? { accessToken: 'fixture-access', userId: 'seller-1' } : { userId: 'seller-1' } }) }); return;
        }
        await route.fulfill({ contentType: 'text/html;charset=utf-8', body: url.pathname === '/punish'
          ? '<!doctype html><input type="text" hidden disabled id="fixture-pointer-pressed" value="false"><div class="nc-container" style="position:relative;margin:30px;width:320px;height:50px;background:#ddd"><div id="nc_1_n1t" style="width:320px;height:50px"><button id="nc_1_n1z" style="width:40px;height:50px">拖动</button></div></div><script>let down=false;window.__pointerDowns=0;document.getElementById("fixture-pointer-pressed").value="false";const reset=()=>{down=false;document.getElementById("fixture-pointer-pressed").value="false";};window.addEventListener("blur",reset);window.addEventListener("pagehide",reset);document.addEventListener("pointercancel",reset);document.querySelector("button").onmousedown=()=>{down=true;document.getElementById("fixture-pointer-pressed").value="true";window.__pointerDowns++;fetch("/fixture-pointer-down");};document.onmouseup=async e=>{const wasDown=down;reset();if(wasDown&&e.clientX>250){await fetch("/slide");document.cookie="x5sec=passed; path=/; secure";}};</script>'
          : '<!doctype html><p>controlled platform</p>' });
      });
      return context;
    } },
  });
  const admin = await runtime.store.createAdmin({ email: `${randomUUID()}@example.test`, passwordHash: await hashPassword('verification-fixture-only-123'), displayName: 'Verification fixture', role: 'admin' });
  const csrf = randomUUID();
  const session = await runtime.store.createSession({ adminId: admin.id, csrfTokenHash: sha256(csrf), expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  const account = await runtime.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `fixture-${randomUUID()}`, displayName: '受控验证账号' });
  // The platform identity is stable and separate from the unique DB seller key.
  await runtime.store.updateAccount(admin.id, account.id, { platformUserId: 'seller-1' });
  await runtime.store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: `unb=seller-1; _m_h5_tk=fixture_suffix${options.nativeFrontend ? '; x5sectag=fixture-context' : ''}`, deviceId: 'device-1', accessToken: 'old-access' });
  await runtime.store.recordAccountRisk({ adminId: admin.id, accountId: account.id, source: XIANYU_IM_TOKEN_API, code: 'ACCOUNT_VALIDATION_REQUIRED' });
  await runtime.listen();
  const baseUrl = `http://127.0.0.1:${(runtime.server.address() as { port: number }).port}`;
  return { runtime, baseUrl, admin, session, account, csrf, cookie: `session_id=${session.id}; csrf_token=${csrf}`, stats, contexts,
    nativeChallenge: options.nativeChallenge === true, nativeChallengeHtml: nativeHtml,
    refreshPointer: { x: 210 / 419, y: 210 / 319 },
    pointer: options.nativeChallenge ? { start: { x: 80 / 419, y: 210 / 319 }, end: { x: 340 / 419, y: 210 / 319 } } : { start: { x: .05, y: .5 }, end: { x: .95, y: .5 } },
    async close() {
      await runtime.verification?.cancel(account.id);
      await runtime.xianyuIm.close();
      const store = runtime.store;
      if (store instanceof PostgresStore) {
        // Only this fixture's IDs are removed; the isolated database is shared
        // with independent regression runs and is never truncated.
        await store.pool.query('delete from accounts.verification_budget_attempts where session_id in (select id from accounts.verification_sessions where account_id=$1)', [account.id]);
        await store.pool.query('delete from accounts.verification_sessions where account_id=$1', [account.id]);
        await store.pool.query('delete from accounts.risk_alert_outbox where account_id=$1', [account.id]);
        await store.pool.query('delete from accounts.health_signals where account_id=$1', [account.id]);
        await store.pool.query('delete from auth.account_credentials where account_id=$1', [account.id]);
        await store.pool.query('delete from auth.account_scopes where account_id=$1', [account.id]);
        await store.pool.query('delete from accounts.accounts where id=$1', [account.id]);
        await store.pool.query('delete from auth.sessions where admin_id=$1', [admin.id]);
        await store.pool.query('delete from observability.audit_events where actor_id=$1', [admin.id]);
        await store.pool.query('delete from auth.admins where id=$1', [admin.id]);
      }
      await runtime.close(); globalThis.fetch = originalFetch;
      for (const socket of gateway.clients) socket.terminate(); await new Promise<void>(resolve => gateway.close(() => resolve()));
      await rm(profile, { recursive: true, force: true });
    },
  };
}
