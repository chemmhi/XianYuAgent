import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { PostgresStore } from '../src/store-postgres.js';

const databaseUrl = process.env.IM_OWNER_TEST_DATABASE_URL;
test('API and two worker OS processes share one socket; delivery and lost receipts remain durable', { skip: !databaseUrl, timeout: 60_000 }, async () => {
  const db = new URL(databaseUrl!);
  assert.ok(['127.0.0.1', 'localhost'].includes(db.hostname) && db.pathname === '/xianyu_im_owner_test', 'isolated test DB required');
  const store = new PostgresStore(databaseUrl!);
  const gateway = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(gateway, 'listening');
  let connections = 0, maxConnections = 0, registrations = 0;
  const sends: Array<{ type: number; uuid: string }> = [];
  gateway.on('connection', socket => {
    connections++; maxConnections = Math.max(maxConnections, connections);
    socket.on('close', () => { connections--; });
    socket.on('message', raw => {
      const request = JSON.parse(raw.toString());
      if (!request.lwp) return;
      if (request.lwp === '/reg') registrations++;
      let body: unknown = { userConvs: [], userMessageModels: [], hasMore: false };
      if (request.lwp === '/r/MessageSend/sendByReceiverScope') {
        const content = JSON.parse(Buffer.from(request.body[0].content.custom.data, 'base64').toString());
        sends.push({ type: content.contentType, uuid: request.body[0].uuid });
        body = { messageId: `test-${sends.length}.PNM` };
      }
      socket.send(JSON.stringify({ code: 200, headers: { mid: request.headers?.mid }, body }));
    });
  });
  const children: Array<Awaited<ReturnType<typeof child>>> = [];
  try {
    const admin = await store.createAdmin({ email: `${randomUUID()}@example.com`, passwordHash: 'hash', displayName: 'isolated' });
    const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `seller-${randomUUID()}` });
    await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=seller-process-test', accessToken: 'isolated-token', deviceId: 'isolated-device' });
    const product = await store.createProduct({ adminId: admin.id, accountId: account.id, externalProductRef: 'test-item', title: 'test', status: 'published' });
    const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'test-buyer', externalConversationRef: 'test-conversation' });
    const order = await store.createOrder({ adminId: admin.id, order: { orderNo: `TEST-${randomUUID()}`, accountId: account.id, buyerId: 'test-buyer', buyerName: 'isolated buyer', itemId: 'test-item', itemTitle: 'test', amountMinor: 100, paymentStatus: 'paid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'coupon_only', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), productId: product.id, conversationId: conversation.id } });
    const batch = await store.createCouponBatch({ adminId: admin.id, accountId: account.id, label: 'isolated', purpose: 'text', metadata: { textContent: 'isolated-card', imageUrls: ['data:image/png;base64,aGVsbG8='] } });
    const config = { paidAutoDelivery: { enabled: true, couponBatchIds: [batch.id], autoConfirm: true, maxAttempts: 1, retryBackoffSeconds: 0 }, unpaidAutoReprice: { enabled: false }, reviewGift: { enabled: false }, reviewReminder: { enabled: false } };
    const owner = await child('owner'); children.push(owner);
    const worker1 = await child('worker', owner.url); children.push(worker1);
    const worker2 = await child('worker', owner.url); children.push(worker2);
    assert.equal(new Set([owner.pid, worker1.pid, worker2.pid]).size, 3);
    await Promise.all([owner, worker1, worker2].map(process => process.call('call', { method: 'startListener', args: [admin.id, account.id] })));
    assert.equal(registrations, 1);
    const delivery = { adminId: admin.id, order, config, eventId: 'process-delivery' };
    assert.equal((await worker1.call('delivery', delivery)).status, 'succeeded');
    assert.equal((await store.getOrder(admin.id, order.orderNo, account.id))?.deliveryStatus, 'delivered');
    assert.deepEqual(sends.map(s => s.type), [2, 1], 'one image followed by one text');
    assert.equal((await worker2.call('delivery', delivery)).status, 'succeeded', 'durable ledger replays the saved result');
    assert.equal(sends.length, 2, 'another worker cannot replay a delivered order');
    assert.deepEqual(await worker1.call('stats'), { uploads: 0, shipments: 1, localSocketAttempts: 0, clients: 0 });
    assert.deepEqual(await worker2.call('stats'), { uploads: 0, shipments: 0, localSocketAttempts: 0, clients: 0 });
    const imageAndText = await store.listMessages(admin.id, conversation.id, { limit: 100 });
    assert.equal(imageAndText.items.length, 2, 'owner saved both message receipts to PostgreSQL');

    // Receipt loss after a successful wire write is recoverable without a second send.
    const args = [admin.id, account.id, conversation.id, 'receipt-test', 'lost-receipt', 'trace'];
    await owner.call('drop');
    await assert.rejects(worker1.call('call', { method: 'sendText', args }), { code: 'XIANYU_IM_SEND_OUTCOME_UNKNOWN' });
    assert.equal(sends.length, 3);
    assert.deepEqual(await worker2.call('call', { method: 'sendText', args: [...args.slice(0, 5), 'new-trace'] }), { externalMessageRef: 'test-3.PNM' });
    assert.equal(sends.length, 3);
    assert.equal(maxConnections, 1); assert.equal(registrations, 1);

    // The same transport failure during a real delivery quarantines its card
    // and blocks both the next worker and shipment confirmation.
    const uncertainOrder = { ...order, id: randomUUID(), orderNo: `TEST-${randomUUID()}`, deliveryStatus: 'pending' as const };
    await store.createOrder({ adminId: admin.id, order: uncertainOrder });
    await owner.call('drop', { after: 1 });
    const uncertainDelivery = { adminId: admin.id, order: uncertainOrder, config, eventId: 'uncertain-delivery' };
    assert.equal((await worker1.call('delivery', uncertainDelivery)).status, 'manual_review');
    assert.equal((await worker2.call('delivery', uncertainDelivery)).status, 'manual_review');
    assert.equal(sends.length, 5, 'lost text receipt does not replay the image or text');
    assert.equal((await worker1.call('stats')).shipments, 1);
    assert.equal((await store.getOrder(admin.id, uncertainOrder.orderNo, account.id))?.deliveryStatus, 'pending');
    const guard = await store.pool.query('select status from orders.delivery_send_guards where account_id=$1 and order_no=$2', [account.id, uncertainOrder.orderNo]);
    assert.equal(guard.rows[0].status, 'unknown');

    // Restart the owner and prove the saved receipt survives a process restart.
    await owner.close();
    const restarted = await child('owner'); children.push(restarted);
    const worker3 = await child('worker', restarted.url); children.push(worker3);
    assert.deepEqual(await worker3.call('call', { method: 'sendText', args }), { externalMessageRef: 'test-3.PNM' });
    assert.equal(sends.length, 5); assert.equal(registrations, 1, 'receipt replay does not even create a new socket');
  } finally {
    for (const process of children.reverse()) await process.close();
    for (const socket of gateway.clients) socket.terminate();
    await new Promise<void>(resolve => gateway.close(() => resolve()));
    await store.close();
  }

  async function child(role: 'owner' | 'worker', ownerUrl?: string) {
    const process = fork(new URL('./helpers/xianyu-im-owner-process.ts', import.meta.url), [], {
      execArgv: ['--import', 'tsx'], silent: true,
      env: { ...globalThis.process.env, DATABASE_URL: databaseUrl, REDIS_URL: '', ALLOW_IN_MEMORY: 'false', PORT: '0', HOST: '127.0.0.1', XIANYU_QR_MODE: 'stub', XIANYU_VERIFICATION_BROWSER_MODE: 'disabled', CREDENTIAL_ENCRYPTION_KEY: 'isolated-im-owner-process-test-secret', AUTO_REPLY_MODEL_ENABLED: 'false', AGENT_RUNTIME: 'in-process', IM_TEST_ROLE: role, IM_TEST_GATEWAY: `ws://127.0.0.1:${(gateway.address() as { port: number }).port}`, XIANYU_IM_OWNER_URL: ownerUrl },
    });
    let diagnostics = '';
    process.stderr?.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000); });
    process.stdout?.resume();
    const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
    const ready = new Promise<any>((resolve, reject) => {
      process.on('message', (message: any) => {
        if (message.ready) resolve(message);
        else { const job = pending.get(message.id); pending.delete(message.id); if (message.error) job?.reject(Object.assign(new Error(message.error.message), { code: message.error.code })); else job?.resolve(message.result); }
      });
      process.on('error', reject);
      process.on('exit', code => { const error = new Error(`child ${role} exited ${code}: ${diagnostics}`); reject(error); for (const job of pending.values()) job.reject(error); pending.clear(); });
    });
    const info = await ready;
    let closed = false;
    const call = (op: string, payload: unknown = {}) => new Promise<any>((resolve, reject) => {
      const id = randomUUID(); pending.set(id, { resolve, reject }); process.send({ id, op, ...payload as object });
    });
    return { pid: info.pid, url: info.url, call, close: async () => {
      if (closed) return; closed = true;
      if (process.exitCode !== null) return;
      try { await call('close'); } finally { if (process.exitCode === null) await once(process, 'exit'); }
    } };
  }
});
