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
for (const outcome of ['success', 'wrong-account', 'missing-token', 'challenge'] as const) {
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
      cookieHeader: 'unb=123456; _m_h5_tk=initial_suffix', deviceId: 'native-device', metadata: { loginMethod: 'qr_http' } });
    const baseFactory = createPatchrightVerificationBrowserFactory();
    const requests: string[] = [];
    let cookieAtLogin = '';
    let browserClosed = false;
    const browser = new XianyuVerificationBrowser({ mode: 'launch', sliderMode: 'disabled', headless: true,
      userDataDir: profile, maxWaitMs: 6_000, pollIntervalMs: 25,
      browserFactory: { launchPersistentContext: async options => {
        const context = await baseFactory.launchPersistentContext(options);
        const close = context.close.bind(context);
        context.close = async () => { await close(); browserClosed = true; };
        await (context as unknown as BrowserContext).route('**/*', async route => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.pathname === '/punish') {
            await route.fulfill({ status: 302, headers: { location: 'https://www.goofish.com/im',
              'set-cookie': 'x5sec=native-passed; Domain=.goofish.com; Path=/; Secure; SameSite=None' } });
            return;
          }
          if (!url.pathname.startsWith('/h5/')) {
            await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>ready</p>' });
            return;
          }
          const api = url.searchParams.get('api') ?? '';
          requests.push(api);
          const data = new URLSearchParams(request.postData() ?? '').get('data') ?? '';
          const signingToken = api.endsWith('login.token') ? 'initial' : 'rotated';
          assert.equal(url.searchParams.get('sign'), createHash('md5')
            .update(`${signingToken}&${url.searchParams.get('t')}&34839810&${data}`).digest('hex'));
          const headers = await request.allHeaders();
          assert.match(headers.cookie ?? '', /x5sec=native-passed/);
          const isToken = api.endsWith('login.token');
          if (isToken) assert.equal(JSON.parse(data).deviceId, 'native-device');
          else {
            assert.equal(url.searchParams.get('needLogin'), 'false');
            cookieAtLogin = headers.cookie ?? '';
          }
          const payload = isToken && outcome === 'challenge'
            ? { ret: ['FAIL_SYS_USER_VALIDATE::validation required'], data: { url: 'https://www.goofish.com/punish' } }
            : { ret: ['SUCCESS::ok'], data: isToken
              ? { ...(outcome === 'missing-token' ? {} : { accessToken: 'native-access' }), userId: '123456' }
              : { userId: outcome === 'wrong-account' ? '654321' : '123456' } };
          await route.fulfill({ status: 200, headers: { 'content-type': 'application/json',
            'access-control-allow-origin': 'https://www.goofish.com', 'access-control-allow-credentials': 'true',
            ...(isToken ? { 'set-cookie': '_m_h5_tk=rotated_suffix; Domain=.goofish.com; Path=/; Secure; SameSite=None' } : {}) },
            body: JSON.stringify(payload) });
        });
        return context;
      } } });
    let serverTokenRequests = 0;
    const service = new XianyuImService(store, { fetchImToken: async () => {
      serverTokenRequests += 1;
      return { success: false, accountInvalid: true, errorCode: 'ACCOUNT_VALIDATION_REQUIRED',
        verificationUrl: 'https://www.goofish.com/punish', cookieHeader: credential.cookieHeader };
    } } as never, {} as never, undefined, undefined, browser);
    const refresh = () => (service as unknown as {
      refreshCredential(adminId: string, account: AccountRecord, credential: CredentialRecord): Promise<CredentialRecord>;
    }).refreshCredential(admin.id, account, credential);
    try {
      if (outcome === 'success') await refresh();
      else await assert.rejects(refresh);
      assert.equal(browserClosed, true);
      assert.equal(serverTokenRequests, 1);
      // Reopen storage to prove PostgreSQL data outlives the service instance.
      const reader = databaseUrl ? new PostgresStore(databaseUrl) : store;
      try {
        const saved = await reader.getCredential(admin.id, account.id);
        if (outcome === 'success') {
          assert.equal(saved?.accessToken, 'native-access');
          assert.equal(saved?.deviceId, 'native-device');
          assert.equal(saved?.metadata?.loginMethod, 'qr_http');
          assert.match(saved?.cookieHeader ?? '', /_m_h5_tk=rotated_suffix/);
          assert.match(cookieAtLogin, /_m_h5_tk=rotated_suffix/);
          assert.equal(cookieSnapshotFromMetadata(saved?.metadata)?.find(cookie => cookie.name === '_m_h5_tk')?.value, 'rotated_suffix');
          assert.equal(requests.length, 2);
        } else {
          assert.equal(saved?.accessToken, undefined);
          assert.equal(saved?.cookieHeader, credential.cookieHeader);
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
