import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PostgresStore } from '../dist/store-postgres.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const suffix = `${process.pid}-${Date.now()}`;
const store = new PostgresStore(databaseUrl);
let admin;
let account;
let conversation;

try {
  admin = await store.createAdmin({ email: `xianyu-system-reconcile-${suffix}@example.com`, passwordHash: 'test-hash', displayName: 'Xianyu System Reconcile' });
  account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `xianyu-system-reconcile-${suffix}` });
  conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: `buyer-${suffix}`, buyerDisplayName: 'Reconcile Buyer', externalConversationRef: `conversation-${suffix}` });
  const seeded = await store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '[卖家已发货]', externalMessageRef: `system-reconcile-${suffix}.PNM`, source: 'system', traceId: 'system-reconcile-seed' });
  const reconciled = await store.reconcileExternalMessage({ adminId: admin.id, conversationId: conversation.id, externalMessageRef: seeded.message.externalMessageRef, senderRole: 'system', bodyType: 'system', source: 'system', riskFlags: ['xianyu_system_message'], traceId: 'system-reconcile-test' });
  assert.ok(reconciled);
  assert.equal(reconciled.message.senderRole, 'system');
  assert.equal(reconciled.message.bodyType, 'system');
  assert.equal(reconciled.message.bodyText, '[卖家已发货]');
  assert.equal(reconciled.message.riskFlags.includes('xianyu_system_message'), true);
  assert.equal(reconciled.event?.type, 'chat.message.updated');

  const repeated = await store.reconcileExternalMessage({ adminId: admin.id, conversationId: conversation.id, externalMessageRef: seeded.message.externalMessageRef, senderRole: 'system', bodyType: 'system', source: 'system', riskFlags: ['xianyu_system_message'], traceId: 'system-reconcile-repeat' });
  assert.ok(repeated);
  assert.equal(repeated.event, undefined);
  console.log(JSON.stringify({ ok: true, messageId: reconciled.message.id, eventType: reconciled.event?.type, idempotent: true }));
} finally {
  if (admin && account && conversation) {
    await store.pool.query('begin');
    try {
      await store.pool.query('delete from messages.events where conversation_id=$1', [conversation.id]);
      await store.pool.query('delete from messages.messages where conversation_id=$1', [conversation.id]);
      await store.pool.query('delete from messages.conversations where id=$1', [conversation.id]);
      await store.pool.query('delete from auth.account_scopes where account_id=$1', [account.id]);
      await store.pool.query('delete from accounts.accounts where id=$1', [account.id]);
      await store.pool.query('delete from auth.admins where id=$1', [admin.id]);
      await store.pool.query('commit');
    } catch (error) {
      await store.pool.query('rollback');
      throw error;
    }
  }
  await store.pool.end();
}
