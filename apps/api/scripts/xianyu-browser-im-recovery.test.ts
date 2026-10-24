import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from 'pg';
import type { BrowserContext } from 'patchright';
import { MemoryStore } from '../src/store-memory.js';
import { PostgresStore } from '../src/store-postgres.js';
import { XianyuImService } from '../src/xianyu-im-service.js';
import { XianyuVerificationBrowser } from '../src/xianyu-verification-browser.js';
import { createPatchrightVerificationBrowserFactory } from '../src/patchright-verification-browser.js';
import { cookieSnapshotFromMetadata } from '../src/xianyu-cookie-jar.js';
import type { AccountRecord, CredentialRecord } from '../src/domain.js';

// External platform responses are controlled; Chrome, signatures, cookie
// rotation, verification lifecycle, IM service and credential storage are real.
for (const outcome of ['success', 'expired-signing-cookie', 'bootstrap-after-challenge', 'wrong-account', 'missing-token', 'challenge', 'rejected-slider'] as const) {
  test(`browser native IM recovery ${outcome} (${process.env.NATIVE_RECOVERY_TEST_DATABASE_URL ? 'PostgreSQL' : 'MemoryStore'})`, async () => {
    const databaseUrl = process.env.NATIVE_RECOVERY_TEST_DATABASE_URL;
    if (databaseUrl) {
      const url = new URL(databaseUrl);
      assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
      assert.equal(url.pathname, '/xianyu_native_recovery_test');
    }
    const store = databaseUrl ? new PostgresStore(databaseUrl) : new MemoryStore();
    const profile = await mkdtemp(join(tmpdir(), 'xianyu-native-db-test-'));
    const admin = await store.createAdmin({ email: `native-${randomUUID()}@example.com`, passwordHash: 'test', displayName: 'Native recovery' });
    const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: '123456' });
    const credential = await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu',
      cookieHeader: 'unb=123456; _m_h5_tk=initial_suffix', deviceId: 'native-device', metadata: { loginMethod: 'qr_http',
        ...(['expired-signing-cookie', 'bootstrap-after-challenge'].includes(outcome) ? { cookies_refresh_snapshot: JSON.stringify([
          { name: 'unb', value: '123456', domain: '.goofish.com', path: '/' },
          { name: '_m_h5_tk', value: 'initial_suffix', domain: '.goofish.com', path: '/', expires: 1 },
        ]) } : {}) } });
    const baseFactory = createPatchrightVerificationBrowserFactory();
    const requests: string[] = [];
    let cookieAtLogin = '';
    let browserClosed = false;
    let slideAttempts = 0;
    const browser = new XianyuVerificationBrowser({ mode: 'launch', sliderMode: 'auto', headless: true,
      userDataDir: profile, maxWaitMs: 6_000, pollIntervalMs: 25,
      browserFactory: { launchPersistentContext: async options => {
        const context = await baseFactory.launchPersistentContext(options);
        const close = context.close.bind(context);
        context.close = async () => { await close(); browserClosed = true; };
        await (context as unknown as BrowserContext).route('**/*', async route => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.pathname === '/punish') {
            assert.equal(url.searchParams.get('source'), 'browser', 'must solve the challenge issued by native fetch');
            await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><style>
              .nc-container{position:fixed;left:200px;top:200px;width:300px;height:34px}
              .nc_scale{position:relative;width:300px;height:34px;background:#ccc}
              #nc_1_n1z{position:absolute;left:0;top:2px;width:42px;height:30px;background:#444;user-select:none}
              </style><div class="nc-container"><div id="nc_1_n1t" class="nc_scale"><div id="nc_1_n1z"></div></div><span id="nc_1_refresh1" hidden>验证失败 点击重试</span></div>
              <script>
              const button=document.querySelector('#nc_1_n1z'); let held=false,released=false,start=0,distance=0,trusted=0;
              document.querySelector('#nc_1_refresh1').onclick=()=>{button.style.left='0px';distance=0;released=false;document.querySelector('#nc_1_refresh1').hidden=true;};
              button.addEventListener('mousedown',e=>{held=true;start=e.clientX;});
              document.addEventListener('mousemove',e=>{if(held){distance=e.clientX-start;trusted+=Number(e.isTrusted);button.style.left=Math.min(258,Math.max(0,distance))+'px';}});
              document.addEventListener('mouseup',()=>{released=held;held=false;});
              button.addEventListener('click',async()=>{if(!released||distance<258)return; released=false;
                const result=await fetch('/slide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({distance,trusted})});
                const verdict=await result.json();if(verdict.code===0)setTimeout(()=>location.href='/im',150);else document.querySelector('#nc_1_refresh1').hidden=false;
              });</script>` });
            return;
          }
          if (url.pathname === '/slide') {
            slideAttempts++;
            const gesture = request.postDataJSON();
            assert.ok(gesture.distance >= 258 && gesture.distance <= 279);
            assert.ok(gesture.trusted > 20, 'must replay real Chrome pointer events');
            await route.fulfill({ status: 200, headers: { 'content-type': 'application/json',
              ...(outcome !== 'rejected-slider' ? { 'set-cookie': `x5sec=native-passed-${slideAttempts}; Domain=.goofish.com; Path=/; Secure; SameSite=None` } : {}) },
              body: JSON.stringify({ code: outcome === 'rejected-slider' ? 300 : 0, success: true }) });
            return;
          }
          if (!url.pathname.startsWith('/h5/')) {
            await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>ready</p>' });
            return;
          }
          const api = url.searchParams.get('api') ?? '';
          requests.push(api);
          const data = new URLSearchParams(request.postData() ?? '').get('data') ?? '';
          const headers = await request.allHeaders();
          const signingToken = (headers.cookie ?? '').split(';').map(value => value.trim())
            .find(value => value.startsWith('_m_h5_tk='))?.split('=')[1].split('_')[0] ?? '';
          assert.equal(url.searchParams.get('sign'), createHash('md5')
            .update(`${signingToken}&${url.searchParams.get('t')}&34839810&${data}`).digest('hex'));
          const isToken = api.endsWith('login.token');
          if (isToken) assert.equal(JSON.parse(data).deviceId, 'native-device');
          else {
            assert.equal(url.searchParams.get('needLogin'), 'false');
            cookieAtLogin = headers.cookie ?? '';
          }
          const needsSigningCookie = !signingToken && (outcome !== 'bootstrap-after-challenge' || slideAttempts > 0);
          const needsChallenge = isToken && (!(headers.cookie ?? '').includes('x5sec=native-passed') || outcome === 'challenge'
            || (outcome === 'bootstrap-after-challenge' && slideAttempts < 2));
          if (!needsChallenge && !needsSigningCookie) assert.match(headers.cookie ?? '', /x5sec=native-passed/);
          const payload = needsSigningCookie ? { ret: ['FAIL_SYS_TOKEN_EMPTY::token bootstrap'], data: {} } : needsChallenge
            ? { ret: ['FAIL_SYS_USER_VALIDATE::validation required'], data: { url: `https://www.goofish.com/punish?source=browser&step=${outcome === 'bootstrap-after-challenge' ? slideAttempts + 1 : 1}` } }
            : { ret: ['SUCCESS::ok'], data: isToken
              ? { ...(outcome === 'missing-token' ? {} : { accessToken: 'native-access' }), userId: '123456' }
              : { userId: outcome === 'wrong-account' ? '654321' : '123456' } };
          await route.fulfill({ status: 200, headers: { 'content-type': 'application/json',
            'access-control-allow-origin': 'https://www.goofish.com', 'access-control-allow-credentials': 'true',
            ...(needsSigningCookie ? { 'set-cookie': '_m_h5_tk=initial_suffix; Domain=.goofish.com; Path=/; Secure; SameSite=None' }
              : isToken && !needsChallenge ? { 'set-cookie': '_m_h5_tk=rotated_suffix; Domain=.goofish.com; Path=/; Secure; SameSite=None' } : {}) },
            body: JSON.stringify(payload) });
        });
        return context;
      } } });
    let serverTokenRequests = 0;
    const service = new XianyuImService(store, { fetchImToken: async () => {
      serverTokenRequests += 1;
      return { success: false, accountInvalid: true, errorCode: 'ACCOUNT_VALIDATION_REQUIRED',
        verificationUrl: 'https://www.goofish.com/punish?source=server', cookieHeader: credential.cookieHeader };
    } } as never, {} as never, undefined, undefined, browser);
    const refresh = () => (service as unknown as {
      refreshCredential(adminId: string, account: AccountRecord, credential: CredentialRecord): Promise<CredentialRecord>;
    }).refreshCredential(admin.id, account, credential);
    try {
      if (['success', 'expired-signing-cookie', 'bootstrap-after-challenge'].includes(outcome)) await refresh();
      else await assert.rejects(refresh);
      assert.equal(browserClosed, true);
      assert.equal(serverTokenRequests, 1);
      // Reopen storage to prove PostgreSQL data outlives the service instance.
      const reader = databaseUrl ? new PostgresStore(databaseUrl) : store;
      try {
        const saved = await reader.getCredential(admin.id, account.id);
        if (['success', 'expired-signing-cookie', 'bootstrap-after-challenge'].includes(outcome)) {
          assert.equal(saved?.accessToken, 'native-access');
          assert.equal(saved?.deviceId, 'native-device');
          assert.equal(saved?.metadata?.loginMethod, 'qr_http');
          assert.match(saved?.cookieHeader ?? '', /_m_h5_tk=rotated_suffix/);
          assert.match(cookieAtLogin, /_m_h5_tk=rotated_suffix/);
          assert.equal(cookieSnapshotFromMetadata(saved?.metadata)?.find(cookie => cookie.name === '_m_h5_tk')?.value, 'rotated_suffix');
          assert.equal(requests.length, outcome === 'bootstrap-after-challenge' ? 5 : outcome === 'expired-signing-cookie' ? 4 : 3);
        } else {
          assert.equal(saved?.accessToken, undefined);
          assert.equal(saved?.cookieHeader, credential.cookieHeader);
          if (outcome === 'rejected-slider') assert.equal(slideAttempts, 3);
        }
      } finally { if (reader !== store) await (reader as PostgresStore).close(); }
    } finally {
      await service.close();
      if (databaseUrl) {
        const cleanup = new Client({ connectionString: databaseUrl });
        try {
          await cleanup.connect();
          await cleanup.query('delete from auth.account_credentials where account_id=$1', [account.id]);
          await cleanup.query('delete from auth.account_scopes where account_id=$1', [account.id]);
          await cleanup.query('delete from accounts.accounts where id=$1', [account.id]);
          await cleanup.query('delete from auth.admins where id=$1', [admin.id]);
        } finally { await cleanup.end(); await (store as PostgresStore).close(); }
      }
      await rm(profile, { recursive: true, force: true });
    }
  });
}
