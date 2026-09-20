import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { XianyuImClient } from '../src/xianyu-im.js';

test('xianyu listener drives product and general auto-reply chains without real send', async () => {
  const runtime = createApp(loadConfig({
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '0',
    DATABASE_URL: '',
    REDIS_URL: '',
    ALLOW_IN_MEMORY: 'true',
    COOKIE_SECURE: 'false',
    XIANYU_QR_MODE: 'stub',
    AGENT_RUNTIME: 'in-process',
  }));
  await runtime.listen();
  let client: XianyuImClient | undefined;

  try {
    const boot = await runtime.auth.bootstrap({ email: 'auto-reply@example.com', password: 'password-123', displayName: 'Auto Reply Admin' });
    const adminId = boot.admin.id;
    const account = await runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef: 'seller-1', displayName: '测试店铺' });
    await runtime.store.upsertCredential({ adminId, accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=seller-1', accessToken: 'access-token', deviceId: 'device-1' });
    const product = await runtime.store.createProduct({ adminId, accountId: account.id, externalProductRef: 'item-1', title: '资料包', description: '数字资料', priceMinor: 1_999, status: 'draft' });
    const productConversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-1', buyerDisplayName: '买家一号', itemRef: 'item-1', itemTitle: '资料包', externalConversationRef: 'conv-product' });
    const generalConversation = await runtime.store.createConversation({ adminId, accountId: account.id, buyerRef: 'buyer-2', buyerDisplayName: '买家二号', externalConversationRef: 'conv-general' });
    const order = await runtime.store.createOrder({ adminId, order: { orderNo: 'ORDER-AUTO-1', accountId: account.id, buyerId: 'buyer-1', buyerName: '买家一号', conversationId: productConversation.id, itemId: 'item-1', itemTitle: '资料包', amountMinor: 1_999, paymentStatus: 'unpaid', orderStatus: 'open', deliveryStatus: 'pending', afterSalesStatus: 'none', deliveryType: 'manual' } });

    const socket = new FakeSocket();
    const completed: Array<{ created: boolean; autoReply?: { run: { status: string; decision: string; intent: string; senderOutcome?: string; productId?: string; outboundMessageId?: string }; inboundMessage: { id: string }; outboundMessage?: { bodyText?: string } } }> = [];
    client = new XianyuImClient({
      accountId: account.id,
      credential: { cookieHeader: 'unb=seller-1', accessToken: 'access-token', deviceId: 'device-1' },
      heartbeatIntervalMs: 60_000,
      webSocketFactory: () => socket,
      onEvent: async (event) => {
        const result = await runtime.xianyuIm.handleExternalEvent(adminId, event);
        completed.push(result as typeof completed[number]);
      },
    });

    const connectPromise = client.connect();
    queueMicrotask(() => socket.emit('open'));
    await connectPromise;
    assert.equal(client.connected, true);

    socket.emit('message', pushFrame('push-product-1', 'conv-product', 'inbound-product-1.PNM', 'buyer-1', '请问多少钱？'));
    await waitFor(() => completed.length >= 1);
    const productResult = completed[0]!;
    assert.equal(productResult.created, true);
    assert.equal(productResult.autoReply?.run.intent, 'price');
    assert.equal(productResult.autoReply?.run.decision, 'replied');
    assert.equal(productResult.autoReply?.run.status, 'persisted');
    assert.equal(productResult.autoReply?.run.senderOutcome, 'simulated');
    assert.equal(productResult.autoReply?.run.productId, product.id);
    assert.equal(productResult.autoReply?.context?.orders.some((candidate) => candidate.orderNo === order.orderNo), true);
    assert.match(productResult.autoReply?.outboundMessage?.bodyText ?? '', /资料包当前价格是19\.99元/);

    const productMessages = await runtime.messages.listMessages(adminId, productConversation.id, { limit: 20 });
    assert.equal(productMessages.items.filter((message) => message.direction === 'inbound').length, 1);
    assert.equal(productMessages.items.filter((message) => message.direction === 'outbound').length, 1);
    assert.equal(productMessages.items.find((message) => message.direction === 'outbound')?.source, 'ai');
    assert.equal((await runtime.store.findAutoReplyRunByInboundMessage(adminId, productResult.autoReply!.inboundMessage.id))?.outboundMessageId, productResult.autoReply?.run.outboundMessageId);

    socket.emit('message', pushFrame('push-general-1', 'conv-general', 'inbound-general-1.PNM', 'buyer-2', '你好'));
    await waitFor(() => completed.length >= 2);
    const generalResult = completed[1]!;
    assert.equal(generalResult.created, true);
    assert.equal(generalResult.autoReply?.run.intent, 'general');
    assert.equal(generalResult.autoReply?.run.status, 'persisted');
    assert.equal(generalResult.autoReply?.run.productId, undefined);
    assert.match(generalResult.autoReply?.outboundMessage?.bodyText ?? '', /已收到你的消息/);
    const generalMessages = await runtime.messages.listMessages(adminId, generalConversation.id, { limit: 20 });
    assert.equal(generalMessages.items.filter((message) => message.direction === 'outbound').length, 1);

    socket.emit('message', pushFrame('push-product-duplicate', 'conv-product', 'inbound-product-1.PNM', 'buyer-1', '请问多少钱？'));
    await waitFor(() => completed.length >= 3);
    assert.equal(completed[2]?.created, false);
    assert.equal((await runtime.messages.listMessages(adminId, productConversation.id, { limit: 20 })).items.filter((message) => message.direction === 'outbound').length, 1);

    const sendRequests = socket.sent.filter((message) => message.lwp === '/r/MessageSend/sendByReceiverScope');
    assert.equal(sendRequests.length, 0, 'dry-run must never call the Xianyu send endpoint');
    await client.disconnect();
  } finally {
    // Disconnect even when an assertion fails so the heartbeat timer cannot
    // keep the test process alive and hide the original failure.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    await client?.disconnect();
    runtime.server.closeAllConnections?.();
    runtime.server.closeIdleConnections?.();
    await runtime.close();
  }
});

function pushFrame(mid: string, conversationRef: string, messageRef: string, senderRef: string, text: string): string {
  const content = Buffer.from(JSON.stringify({ contentType: 1, text: { text } }), 'utf8').toString('base64');
  const payload = {
    '1': {
      '2': conversationRef,
      '3': messageRef,
      '5': Date.now(),
      '6': { '3': { '5': content } },
      '10': { senderUserId: senderRef, extJson: JSON.stringify({ messageId: messageRef }) },
    },
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  return JSON.stringify({ headers: { mid }, body: { syncPushPackage: { data: [{ data: encoded }] } } });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for auto-reply chain');
}

class FakeSocket {
  readyState = 0;
  sent: Array<Record<string, any>> = [];
  private readonly listeners = new Map<string, Array<(...args: any[]) => void>>();

  send(data: string): void {
    const message = JSON.parse(data) as Record<string, any>;
    this.sent.push(message);
    if (message.lwp === '/reg') {
      queueMicrotask(() => this.emit('message', JSON.stringify({ code: 200, headers: { mid: message.headers.mid }, body: {} })));
    }
  }

  close(): void { this.readyState = 3; this.emit('close'); }

  on(event: string, listener: (...args: any[]) => void): this {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
    return this;
  }

  once(event: string, listener: (...args: any[]) => void): this {
    const wrapped = (...args: any[]) => {
      this.removeListener(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  removeListener(event: string, listener: (...args: any[]) => void): this {
    const current = this.listeners.get(event) ?? [];
    this.listeners.set(event, current.filter((candidate) => candidate !== listener));
    return this;
  }

  emit(event: string, ...args: any[]): void {
    if (event === 'open') this.readyState = 1;
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }
}
