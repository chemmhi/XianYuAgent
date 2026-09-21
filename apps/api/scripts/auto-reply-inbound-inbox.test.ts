import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store-memory.js';

type InboxRecord = {
  id: string;
  adminId: string;
  accountId: string;
  conversationId: string;
  inboundMessageId: string;
  externalConversationRef: string;
  externalMessageRef: string;
  status: string;
  attempt: number;
  leaseOwner?: string;
};

type InboundInboxStore = {
  enqueueInboundInbox(input: {
    adminId: string;
    accountId: string;
    conversationId: string;
    inboundMessageId: string;
    externalConversationRef: string;
    externalMessageRef: string;
    availableAt?: string;
  }): Promise<{ record: InboxRecord; created: boolean }>;
  claimInboundInbox(input: { workerId: string; limit: number; leaseMs: number }): Promise<InboxRecord[]>;
  ackInboundInbox(input: { id: string; workerId: string }): Promise<boolean>;
};

type Fixture = {
  store: MemoryStore;
  inbox: InboundInboxStore;
  adminId: string;
  accountId: string;
  conversationId: string;
  externalConversationRef: string;
  firstMessageId: string;
  secondMessageId: string;
};

async function createFixture(): Promise<Fixture> {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'inbox-tests@example.com', passwordHash: 'test-hash', displayName: 'Inbox Test' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'seller-inbox-tests' });
  const externalConversationRef = 'conversation-inbox-tests';
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-inbox-tests', externalConversationRef });
  const first = await store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '第一条', externalMessageRef: 'message-1.PNM', createdAt: '2026-09-21T00:00:00.000Z' });
  const second = await store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '第二条', externalMessageRef: 'message-2.PNM', createdAt: '2026-09-21T00:00:01.000Z' });
  return { store, inbox: store as unknown as InboundInboxStore, adminId: admin.id, accountId: account.id, conversationId: conversation.id, externalConversationRef, firstMessageId: first.message.id, secondMessageId: second.message.id };
}

function enqueueInput(fixture: Fixture, messageId: string, externalMessageRef: string) {
  return {
    adminId: fixture.adminId,
    accountId: fixture.accountId,
    conversationId: fixture.conversationId,
    inboundMessageId: messageId,
    externalConversationRef: fixture.externalConversationRef,
    externalMessageRef,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('inbound inbox enqueue is idempotent by account and external message ref', async () => {
  const fixture = await createFixture();
  const first = await fixture.inbox.enqueueInboundInbox(enqueueInput(fixture, fixture.firstMessageId, 'message-1.PNM'));
  const duplicate = await fixture.inbox.enqueueInboundInbox(enqueueInput(fixture, fixture.secondMessageId, 'message-1.PNM'));

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.record.id, first.record.id);
  assert.equal(duplicate.record.inboundMessageId, fixture.firstMessageId);
  assert.equal(duplicate.record.attempt, 0);
  assert.equal(duplicate.record.status, 'pending');
});

test('claim enforces same-conversation serial ordering and worker fencing', async () => {
  const fixture = await createFixture();
  const first = await fixture.inbox.enqueueInboundInbox(enqueueInput(fixture, fixture.firstMessageId, 'message-1.PNM'));
  await wait(10);
  const second = await fixture.inbox.enqueueInboundInbox(enqueueInput(fixture, fixture.secondMessageId, 'message-2.PNM'));

  const claimedByFirstWorker = await fixture.inbox.claimInboundInbox({ workerId: 'worker-1', limit: 10, leaseMs: 5_000 });
  assert.deepEqual(claimedByFirstWorker.map((record) => record.externalMessageRef), ['message-1.PNM']);
  assert.equal(claimedByFirstWorker[0]?.id, first.record.id);
  assert.equal(claimedByFirstWorker[0]?.attempt, 1);
  assert.equal(claimedByFirstWorker[0]?.leaseOwner, 'worker-1');

  const blockedConcurrentClaim = await fixture.inbox.claimInboundInbox({ workerId: 'worker-2', limit: 10, leaseMs: 5_000 });
  assert.deepEqual(blockedConcurrentClaim, []);

  assert.equal(await fixture.inbox.ackInboundInbox({ id: first.record.id, workerId: 'worker-1' }), true);
  const claimedAfterAck = await fixture.inbox.claimInboundInbox({ workerId: 'worker-2', limit: 10, leaseMs: 5_000 });
  assert.deepEqual(claimedAfterAck.map((record) => record.externalMessageRef), ['message-2.PNM']);
  assert.equal(claimedAfterAck[0]?.id, second.record.id);
  assert.equal(claimedAfterAck[0]?.attempt, 1);
});

test('expired lease can be reclaimed once and the old worker loses ownership', async () => {
  const fixture = await createFixture();
  const queued = await fixture.inbox.enqueueInboundInbox(enqueueInput(fixture, fixture.firstMessageId, 'message-1.PNM'));
  const claimedByFirstWorker = await fixture.inbox.claimInboundInbox({ workerId: 'worker-1', limit: 1, leaseMs: 5_000 });
  assert.equal(claimedByFirstWorker[0]?.id, queued.record.id);

  const beforeExpiry = await fixture.inbox.claimInboundInbox({ workerId: 'worker-2', limit: 1, leaseMs: 5_000 });
  assert.deepEqual(beforeExpiry, []);

  // The implementation clamps leases to a five-second minimum. Keep a small margin
  // so this regression test exercises stale-lease recovery instead of a race at the boundary.
  await wait(5_500);
  const reclaimed = await fixture.inbox.claimInboundInbox({ workerId: 'worker-2', limit: 1, leaseMs: 5_000 });
  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0]?.id, queued.record.id);
  assert.equal(reclaimed[0]?.attempt, 2);
  assert.equal(reclaimed[0]?.leaseOwner, 'worker-2');

  assert.equal(await fixture.inbox.ackInboundInbox({ id: queued.record.id, workerId: 'worker-1' }), false);
  assert.equal(await fixture.inbox.ackInboundInbox({ id: queued.record.id, workerId: 'worker-2' }), true);
});
