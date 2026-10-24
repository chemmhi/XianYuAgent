import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { XianyuImClient } from '../src/xianyu-im.js';
import { cookieSnapshotFromMetadata, metadataWithCookieSnapshot } from '../src/xianyu-cookie-jar.js';
import { refreshXianyuChatRequests } from '../src/xianyu-chat-refresh.js';
import { ServiceError } from '../src/services.js';

async function until(condition: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('fixture condition timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('HTTP refresh rotates cookies and persists token while real WS messages and simulated auto replies continue', async () => {
  const runtime = createApp(loadConfig({
    ...process.env, HOST: '127.0.0.1', PORT: '0', DATABASE_URL: '', REDIS_URL: '', ALLOW_IN_MEMORY: 'true', COOKIE_SECURE: 'false',
    XIANYU_QR_MODE: 'stub', XIANYU_VERIFICATION_BROWSER_MODE: 'disabled', AGENT_RUNTIME: 'in-process',
    AUTO_REPLY_MODEL_ENABLED: 'false', AUTO_REPLY_SEND_MODE: 'simulate', AUTO_REPLY_AGENT_DEBOUNCE_MS: '0', AUTO_REPLY_AGENT_SEND_DELAY_SECONDS: '0',
  }));
  const realFetch = globalThis.fetch;
  const apis: string[] = [];
  const fixtureErrors: unknown[] = [];
  let loginAttempts = 0;
  let releaseToken!: () => void;
  const holdToken = new Promise<void>(resolve => { releaseToken = resolve; });
  let tokenStarted = false;
  const http = createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const url = new URL(req.url!, 'http://fixture');
      const api = url.searchParams.get('api')!;
      apis.push(api);
      assert.equal(req.method, 'POST');
      assert.equal(req.headers.origin, 'https://www.goofish.com');
      assert.equal(req.headers.referer, 'https://www.goofish.com/im');
      const data = new URLSearchParams(raw).get('data')!;
      const signingToken = /_m_h5_tk=([^;]+)/.exec(req.headers.cookie!)![1].split('_')[0];
      assert.equal(url.searchParams.get('sign'), createHash('md5')
        .update(`${signingToken}&${url.searchParams.get('t')}&34839810&${data}`).digest('hex'));
      res.setHeader('content-type', 'application/json');
      if (api.endsWith('loginuser.get')) {
        loginAttempts++;
        if (loginAttempts === 1) {
          res.setHeader('set-cookie', '_m_h5_tk=rotated_suffix; Domain=.goofish.com; Path=/; Secure; SameSite=None');
          res.end(JSON.stringify({ ret: ['FAIL_SYS_TOKEN_EXOIRED::token expired'], data: {} }));
        } else {
          assert.equal(signingToken, 'rotated');
          res.end(JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { userId: 'seller-1' } }));
        }
      } else {
        assert.equal(api, 'mtop.taobao.idlemessage.pc.login.token');
        assert.equal(signingToken, 'rotated');
        assert.equal(JSON.parse(data).deviceId, 'device-1');
        tokenStarted = true;
        await holdToken;
        res.end(JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { accessToken: 'renewed-access', accessTokenExpiredTime: '86400000' } }));
      }
    } catch (error) { fixtureErrors.push(error); res.statusCode = 500; res.end('{}'); }
  });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  const httpPort = (http.address() as { port: number }).port;
  const ws = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(ws, 'listening');
  let live: WebSocket | undefined;
  let connections = 0;
  const registrations: string[] = [];
  ws.on('connection', socket => {
    connections++; live = socket;
    socket.on('message', raw => {
      const frame = JSON.parse(String(raw));
      if (frame.lwp === '/reg') registrations.push(frame.headers.token);
      if (frame.lwp) socket.send(JSON.stringify({ code: 200, headers: { mid: frame.headers.mid }, body: {} }));
    });
  });
  const internal = runtime.xianyuIm as any;
  // Catch-up is independently covered; this fixture sends live events only.
  internal.scheduleRecentMessageRecovery = () => undefined;
  try {
    await runtime.listen();
    const boot = await runtime.auth.bootstrap({ email: 'refresh-chain@example.com', password: 'password-123', displayName: 'Refresh integration' });
    const adminId = boot.admin.id;
    const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'seller-1' });
    const credential = await runtime.store.upsertCredential({ adminId, accountId: account.id, platform: 'xianyu',
      cookieHeader: 'unb=seller-1; cookie2=session; _m_h5_tk=original_suffix', accessToken: 'original-access', deviceId: 'device-1',
      metadata: metadataWithCookieSnapshot({ loginMethod: 'test' }, [
        { name: 'unb', value: 'seller-1', domain: '.goofish.com', path: '/' },
        { name: 'cookie2', value: 'session', domain: '.goofish.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
        { name: '_m_h5_tk', value: 'original_suffix', domain: '.goofish.com', path: '/', secure: true },
      ]) });
    const conversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-1',
      buyerDisplayName: 'Fixture Buyer', externalConversationRef: 'refresh-conversation' });
    globalThis.fetch = (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://h5api.m.goofish.com', 'fixture must never contact a live external service');
      return realFetch(`http://127.0.0.1:${httpPort}${url.pathname}${url.search}`, init);
    };
    const handled: Promise<unknown>[] = [];
    const client = new XianyuImClient({ accountId: account.id,
      credential: { cookieHeader: credential.cookieHeader!, accessToken: credential.accessToken, deviceId: 'device-1' },
      webSocketFactory: () => new WebSocket(`ws://127.0.0.1:${(ws.address() as { port: number }).port}`) as never,
      onEvent: event => {
        if ('kind' in event) return;
        const work = runtime.xianyuIm.handleExternalEvent(adminId, event);
        handled.push(work); return work.then(() => undefined);
      } });
    internal.clients.set(`${adminId}:${account.id}`, client);
    await client.connect();
    await runtime.xianyuIm.startListener(adminId, account.id);
    const push = async (index: number) => {
      const message = { '1': { '2': 'refresh-conversation@goofish', '3': `refresh-${index}.PNM`, '5': Date.now(),
        '6': { '3': { '5': Buffer.from(JSON.stringify({ contentType: 1, text: { text: `请问怎么使用 ${index}` } })).toString('base64') } },
        '10': { senderUserId: 'buyer-1', senderNick: 'Fixture Buyer' } } };
      live!.send(JSON.stringify({ lwp: '/s/sync', headers: { mid: `push-${index}` }, body: { syncPushPackage: { data: [
        { data: Buffer.from(JSON.stringify(message)).toString('base64') },
      ] } } }));
      await until(() => handled.length >= index);
      await handled[index - 1];
    };
    await push(1);
    const refresh = internal.refreshChatSession(adminId, account.id);
    await until(() => tokenStarted);
    await push(2);
    assert.equal(client.connected, true);
    assert.equal(connections, 1);
    releaseToken(); await refresh;
    await push(3);
    const messages = await runtime.messages.listMessages(adminId, conversation.id, { limit: 20 });
    assert.equal(messages.items.filter(item => item.direction === 'inbound').length, 3);
    assert.equal(messages.items.filter(item => item.direction === 'outbound').length, 3, 'auto reply persists before, during and after refresh');
    assert.equal(connections, 1, 'healthy listener must never be disconnected by scheduled maintenance');
    const saved = await runtime.store.getCredential(adminId, account.id);
    assert.equal(saved?.accessToken, 'renewed-access');
    assert.match(saved?.cookieHeader ?? '', /cookie2=session/);
    assert.equal(cookieSnapshotFromMetadata(saved?.metadata)?.find(cookie => cookie.name === 'cookie2')?.httpOnly, true);
    assert.equal(cookieSnapshotFromMetadata(saved?.metadata)?.find(cookie => cookie.name === '_m_h5_tk')?.value, 'rotated_suffix');
    await client.disconnect(); await client.connect();
    assert.deepEqual(registrations, ['original-access', 'renewed-access']);
    assert.deepEqual(apis, ['mtop.taobao.idlemessage.pc.loginuser.get', 'mtop.taobao.idlemessage.pc.loginuser.get', 'mtop.taobao.idlemessage.pc.login.token']);
    assert.deepEqual(fixtureErrors, []);
  } finally {
    releaseToken();
    await runtime.close();
    globalThis.fetch = realFetch;
    for (const socket of ws.clients) socket.terminate();
    await new Promise<void>(resolve => ws.close(() => resolve()));
    http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve()));
  }
});

test('HTTP session refresh rejects wrong identities, missing tokens and verification challenges without inventing success', async () => {
  const account = { id: 'account', platformUserId: 'seller-1', sellerRef: 'seller-1' } as never;
  const credential = { deviceId: 'device-1' } as never;
  for (const outcome of ['wrong-user', 'missing-token', 'challenge', 'transient']) {
    let tokenCalls = 0;
    const mtop = {
      createCredentialSession: () => ({ client: mtop, getCredential: () => ({ metadata: {} }) }),
      verifyLogin: async () => ({ success: true, response: { data: { userId: outcome === 'wrong-user' ? 'another-seller' : 'seller-1' } } }),
      fetchImToken: async () => { tokenCalls++; return { success: outcome === 'missing-token', accountInvalid: outcome === 'challenge',
        errorCode: outcome === 'challenge' ? 'ACCOUNT_VALIDATION_REQUIRED' : outcome === 'transient' ? 'MTOP_RETRY_EXHAUSTED' : undefined }; },
    };
    await assert.rejects(() => refreshXianyuChatRequests(mtop as never, 'admin', account, credential),
      (error: unknown) => error instanceof ServiceError && error.code === (outcome === 'wrong-user' ? 'XIANYU_CHAT_IDENTITY_MISMATCH'
        : outcome === 'missing-token' ? 'IM_TOKEN_MISSING' : outcome === 'challenge' ? 'ACCOUNT_VALIDATION_REQUIRED' : 'MTOP_RETRY_EXHAUSTED'));
    assert.equal(tokenCalls, outcome === 'wrong-user' ? 0 : 1);
  }
});
