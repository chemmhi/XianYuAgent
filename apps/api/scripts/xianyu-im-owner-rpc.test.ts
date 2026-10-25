import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ServiceError } from '../src/services.js';
import { XianyuImService, XianyuImSendNotStartedError } from '../src/xianyu-im-service.js';
import { IM_OWNER_RPC_PATH, XianyuImOwnerClient, XianyuImOwnerServer } from '../src/xianyu-im-owner-rpc.js';

const secret = 'isolated-test-im-owner-secret-32-bytes';

test('app wiring shares a separate RPC secret without rotating credential encryption', async () => {
  const config = { ...loadConfig({ NODE_ENV: 'test', ALLOW_IN_MEMORY: 'true',
    XIANYU_QR_MODE: 'stub', AGENT_RUNTIME: 'in-process', AUTO_REPLY_MODEL_ENABLED: 'false',
    XIANYU_IM_OWNER_SECRET: secret }), port: 0, host: '127.0.0.1' };
  assert.equal(config.credentialEncryptionKey, 'development-only-credential-key-change-me');
  const api = createApp(config);
  let worker: ReturnType<typeof createApp> | undefined;
  try {
    await api.listen();
    const url = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
    worker = createApp(config, { imOwnerUrl: url, verificationRecoveryOwner: false });
    const admin = await api.store.createAdmin({ email: `${randomUUID()}@example.com`, passwordHash: 'hash', displayName: 'test' });
    const account = await api.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'dev-secret-test' });
    let calls = 0;
    api.xianyuIm.isReady = async () => { calls++; return true; };
    assert.equal(await worker.xianyuIm.isReady(admin.id, account.id), true);
    assert.equal(calls, 1);
    const wrongClient = new XianyuImOwnerClient(url, 'wrong-secret-that-is-at-least-32-characters');
    await assert.rejects(wrongClient.call('isReady', [admin.id, account.id]), { code: 'IM_OWNER_AUTH_FAILED' });
  } finally {
    await worker?.close();
    await api.close();
  }
});

test('RPC rejects the development encryption fallback when no separate secret is configured', () => {
  const config = loadConfig({ NODE_ENV: 'test', ALLOW_IN_MEMORY: 'true' });
  assert.equal(config.imOwnerSecret, undefined);
  assert.throws(() => new XianyuImOwnerClient('http://127.0.0.1:8080', config.credentialEncryptionKey), /XIANYU_IM_OWNER_SECRET_REQUIRED/);
});
async function harness(operations: Partial<XianyuImService>, intercept?: (req: IncomingMessage, res: ServerResponse) => boolean) {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: `${randomUUID()}@example.com`, passwordHash: 'hash', displayName: 'test' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'owner-test' });
  const owner = new XianyuImOwnerServer(secret, operations as XianyuImService, store);
  const server = createServer((req, res) => { if (!intercept?.(req, res)) void owner.handle(req, res); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const client = new XianyuImOwnerClient(url, secret, 5000);
  const args = [admin.id, account.id, 'conversation', 'private-test-content', 'request', 'trace'] as const;
  return { store, client, url, args, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
function signed(body: string) {
  const timestamp = String(Date.now()), nonce = randomUUID();
  const key = createHmac('sha256', secret).update('xianyu-im-owner:v1').digest();
  return { 'content-type': 'application/json', 'x-im-time': timestamp, 'x-im-nonce': nonce,
    'x-im-signature': createHmac('sha256', key).update(`${timestamp}\n${nonce}\n${body}`).digest('hex') };
}

test('owner authenticates requests, rejects replays and enforces account scope', async () => {
  let calls = 0;
  const h = await harness({ isReady: async () => { calls++; return true; } });
  try {
    const body = JSON.stringify({ method: 'isReady', args: h.args.slice(0, 2) });
    assert.equal((await fetch(h.url + IM_OWNER_RPC_PATH, { method: 'POST', body })).status, 403);
    const headers = signed(body);
    assert.equal((await fetch(h.url + IM_OWNER_RPC_PATH, { method: 'POST', headers, body: body + ' ' })).status, 403);
    assert.equal((await fetch(h.url + IM_OWNER_RPC_PATH, { method: 'POST', headers, body })).status, 200);
    assert.equal((await fetch(h.url + IM_OWNER_RPC_PATH, { method: 'POST', headers, body })).status, 403);
    await assert.rejects(h.client.call('isReady', [randomUUID(), h.args[1]]), { code: 'ACCOUNT_SCOPE_FORBIDDEN' });
    assert.equal(calls, 1);
  } finally { await h.close(); }
});

test('send deduplication uses message request ID across different traces and rejects changed content', async () => {
  let calls = 0;
  const h = await harness({ sendText: async () => { calls++; return { externalMessageRef: 'one.PNM', bodyText: 'private-test-content' }; } });
  try {
    assert.deepEqual(await h.client.call('sendText', [...h.args]), { externalMessageRef: 'one.PNM' });
    assert.deepEqual(await h.client.call('sendText', [...h.args.slice(0, 5), 'another-trace'] as Parameters<XianyuImService['sendText']>), { externalMessageRef: 'one.PNM' });
    await assert.rejects(h.client.call('sendText', [h.args[0], h.args[1], h.args[2], 'changed', h.args[4], h.args[5]]), { code: 'IDEMPOTENCY_CONFLICT' });
    assert.equal(calls, 1);
    const record = await h.store.getIdempotency(`xianyu-im-owner:${h.args[0]}:${h.args[1]}:sendText`, 'request');
    assert.ok(!JSON.stringify(record).includes('private-test-content'));
  } finally { await h.close(); }
});

test('image bytes survive HTTP forwarding and duplicate requests reuse the receipt', async () => {
  const file = { filename: 'test.png', contentType: 'image/png', data: Buffer.from([0, 128, 255, 2]) };
  let calls = 0;
  const h = await harness({ sendImage: async (_a, _b, _c, actual) => { calls++; assert.deepEqual(actual, file); return { externalMessageRef: 'image.PNM' }; } });
  try {
    const args: Parameters<XianyuImService['sendImage']> = [h.args[0], h.args[1], h.args[2], file, 'image-request', 'trace'];
    await h.client.call('sendImage', args); await h.client.call('sendImage', args);
    assert.equal(calls, 1);
  } finally { await h.close(); }
});

test('known pre-send failures can recover using the same request ID', async () => {
  let calls = 0;
  const h = await harness({ sendExternalText: async () => {
    calls++;
    if (calls === 1) throw new XianyuImSendNotStartedError(new Error('XIANYU_IM_WS_OPEN_TIMEOUT'));
    return { externalMessageRef: 'recovered.PNM' };
  } });
  try {
    await assert.rejects(h.client.call('sendExternalText', [...h.args]), { code: 'XIANYU_IM_WS_OPEN_TIMEOUT' });
    assert.deepEqual(await h.client.call('sendExternalText', [...h.args]), { externalMessageRef: 'recovered.PNM' });
    assert.equal(calls, 2);
  } finally { await h.close(); }
});

for (const phase of ['acquire', 'release']) test(`real service distinguishes ${phase} lock failure from an uncertain send`, async () => {
  const operations: Partial<XianyuImService> = {};
  const h = await harness(operations);
  const service = new XianyuImService(h.store, {} as never, {} as never);
  let locks = 0, sends = 0;
  try {
    const conversation = await h.store.createConversation({ adminId: h.args[0], accountId: h.args[1], buyerRef: 'buyer', externalConversationRef: 'external' });
    h.store.withOutboundConversationLock = async (_a, _b, work) => {
      locks++;
      if (phase === 'acquire' && locks === 1) throw new Error('lock timeout');
      const result = await work();
      if (phase === 'release') throw new Error('unlock failed');
      return result;
    };
    (service as any).ensureClient = async () => ({ sendText: async () => { sends++; return { externalMessageRef: 'locked.PNM' }; } });
    operations.sendExternalText = service.sendExternalText.bind(service);
    const args: Parameters<XianyuImService['sendExternalText']> = [h.args[0], h.args[1], conversation.id, 'test', 'lock-test', 'trace'];
    await assert.rejects(h.client.call('sendExternalText', args), { code: phase === 'acquire' ? 'XIANYU_IM_NOT_READY' : 'XIANYU_IM_SEND_OUTCOME_UNKNOWN' });
    if (phase === 'acquire') assert.deepEqual(await h.client.call('sendExternalText', args), { externalMessageRef: 'locked.PNM' });
    else await assert.rejects(h.client.call('sendExternalText', args), { code: 'XIANYU_IM_SEND_OUTCOME_UNKNOWN' });
    assert.equal(sends, 1);
    assert.equal(locks, phase === 'acquire' ? 2 : 1);
  } finally { await service.close(); await h.close(); }
});

test('unknown sends and in-flight sends remain fenced instead of becoming retryable', async () => {
  let calls = 0;
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const h = await harness({ sendExternalText: async () => { calls++; started(); await gate; throw new ServiceError(502, 'XIANYU_IM_SEND_OUTCOME_UNKNOWN', 'unknown'); } });
  try {
    const first = assert.rejects(h.client.call('sendExternalText', [...h.args]), { code: 'XIANYU_IM_SEND_OUTCOME_UNKNOWN' });
    await entered;
    await assert.rejects(h.client.call('sendExternalText', [...h.args]), { code: 'XIANYU_IM_SEND_OUTCOME_UNKNOWN' });
    release(); await first;
    await assert.rejects(h.client.call('sendExternalText', [...h.args]), { code: 'XIANYU_IM_SEND_OUTCOME_UNKNOWN' });
    assert.equal(calls, 1);
  } finally { release(); await h.close(); }
});

test('lost HTTP receipt never causes an automatic transport retry or a local worker socket', async () => {
  let requests = 0;
  const h = await harness({}, (req) => { requests++; req.socket.destroy(); return true; });
  try {
    const worker = new XianyuImService({} as never, {} as never, {} as never, undefined, undefined, undefined, undefined, undefined, h.client);
    await assert.rejects(worker.sendText(...h.args), { code: 'XIANYU_IM_SEND_OUTCOME_UNKNOWN' });
    assert.equal(requests, 1);
    assert.equal(await worker.isReady(h.args[0], h.args[1]), false);
    assert.equal((worker as any).clients.size, 0);
    await assert.rejects((worker as any).ensureClient(h.args[0], h.args[1]), { code: 'XIANYU_IM_OWNER_REQUIRED' });
    await worker.close();
  } finally { await h.close(); }
});

test('every public worker socket operation is forwarded without touching local dependencies', async () => {
  const calls: string[] = [];
  const operations = Object.fromEntries(['isReady', 'startListener', 'resetClient', 'listConversations', 'listMessages', 'markConversationRead', 'recoverRecentMessages']
    .map(method => [method, async (...args: unknown[]) => {
      calls.push(method);
      if (method === 'listConversations') { assert.equal(args[2], undefined); assert.equal(args[3], 25); }
      return method === 'isReady' ? true : null;
    }]));
  const h = await harness(operations);
  try {
    const worker = new XianyuImService({} as never, {} as never, {} as never, undefined, undefined, undefined, undefined, undefined, h.client);
    const [a, b, c] = h.args;
    await worker.isReady(a, b); await worker.startListener(a, b); await worker.resetClient(a, b);
    await worker.listConversations(a, b, undefined, 25); await worker.listMessages(a, b, c);
    await worker.markConversationRead(a, b, c, 'request', 'trace'); await worker.recoverRecentMessages(a, b);
    assert.deepEqual(calls, ['isReady', 'startListener', 'resetClient', 'listConversations', 'listMessages', 'markConversationRead', 'recoverRecentMessages']);
    await worker.close();
  } finally { await h.close(); }
});
