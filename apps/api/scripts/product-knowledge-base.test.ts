import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryStore } from '../src/store-memory.js';
import { ProductService } from '../src/services.js';
import { ProductKnowledgeBaseService, selectKnowledgeMessages } from '../src/product-knowledge-base.js';
import type { ModelClient } from '../src/pi-runtime.js';

test('product knowledge base only sends buyer questions and human replies to the model', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'kb@example.com', passwordHash: 'hash', displayName: 'KB' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'kb-seller' });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, externalProductRef: 'item-kb', title: '知识库商品', status: 'ready', knowledgeBase: '已有交付说明。' });
  const conversation = await store.createConversation({ adminId: admin.id, accountId: account.id, buyerRef: 'buyer-1', itemRef: product.externalProductRef, itemTitle: product.title });
  await store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '多久发货？', source: 'system' });
  await store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'outbound', senderRole: 'agent', bodyType: 'text', bodyText: 'AI 回复不应进入知识库。', source: 'ai' });
  await store.createMessage({ adminId: admin.id, conversationId: conversation.id, direction: 'outbound', senderRole: 'agent', bodyType: 'text', bodyText: '付款后马上发送。', source: 'human' });

  let prompt = '';
  const model: ModelClient = { async complete(input) { prompt = input.messages.map((message) => String(message.content)).join('\n'); return { content: JSON.stringify({ knowledgeBase: '常见问题：多久发货？\n答案：付款后马上发送。' }), model: 'test-model' }; } };
  const products = new ProductService(store, async () => 'audit');
  const service = new ProductKnowledgeBaseService(store, products, async () => model, async () => 'audit');
  const result = await service.appendFromConversations({ adminId: admin.id, productId: product.id, accountId: account.id, expectedConfigVersion: product.configVersion, requestId: 'kb-generate', traceId: 'kb-generate' });

  assert.equal(result.changed, true);
  assert.equal(result.questionCount, 1);
  assert.equal(result.humanReplyCount, 1);
  assert.match(result.product.knowledgeBase ?? '', /多久发货/);
  assert.match(prompt, /付款后马上发送/);
  assert.doesNotMatch(prompt, /AI 回复不应进入/);
});

test('knowledge base optimizer deduplicates model output and respects versioned writes', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'kb-opt@example.com', passwordHash: 'hash', displayName: 'KB' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'kb-opt-seller' });
  const product = await store.createProduct({ adminId: admin.id, accountId: account.id, title: '优化商品', status: 'ready', knowledgeBase: '重复条目\n重复条目\n交付方式：付款后发送。' });
  const model: ModelClient = { async complete() { return { content: JSON.stringify({ knowledgeBase: '交付方式：付款后发送。\n适用范围：仅限本商品。' }), model: 'test-model' }; } };
  const products = new ProductService(store, async () => 'audit');
  const service = new ProductKnowledgeBaseService(store, products, async () => model, async () => 'audit');
  const result = await service.optimize({ adminId: admin.id, productId: product.id, accountId: account.id, expectedConfigVersion: product.configVersion, requestId: 'kb-optimize', traceId: 'kb-optimize' });

  assert.equal(result.changed, true);
  assert.deepEqual(result.product.knowledgeBase, '交付方式：付款后发送。\n适用范围：仅限本商品。');
  assert.equal(result.product.configVersion, product.configVersion + 1);
});

test('knowledge message selection excludes AI, system, and non-text outbound records', () => {
  const selected = selectKnowledgeMessages([
    { conversationId: 'c1', message: { id: 'm1', conversationId: 'c1', accountId: 'a1', direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '问题', redactionState: 'visible', status: 'created', readStatus: 0, riskFlags: [], handlingMode: 'ai', createdAt: '2026-09-28T00:00:00.000Z' } },
    { conversationId: 'c1', message: { id: 'm2', conversationId: 'c1', accountId: 'a1', direction: 'outbound', senderRole: 'agent', bodyType: 'text', bodyText: 'AI', redactionState: 'visible', status: 'created', readStatus: 0, riskFlags: [], handlingMode: 'ai', source: 'ai', createdAt: '2026-09-28T00:00:01.000Z' } },
    { conversationId: 'c1', message: { id: 'm3', conversationId: 'c1', accountId: 'a1', direction: 'outbound', senderRole: 'agent', bodyType: 'text', bodyText: '人工', redactionState: 'visible', status: 'created', readStatus: 0, riskFlags: [], handlingMode: 'human', source: 'human', createdAt: '2026-09-28T00:00:02.000Z' } },
    { conversationId: 'c1', message: { id: 'm4', conversationId: 'c1', accountId: 'a1', direction: 'outbound', senderRole: 'system', bodyType: 'system', bodyText: '系统', redactionState: 'visible', status: 'created', readStatus: 0, riskFlags: [], handlingMode: 'ai', source: 'system', createdAt: '2026-09-28T00:00:03.000Z' } },
  ]);
  assert.deepEqual(selected.map((item) => [item.kind, item.text]), [['buyer_question', '问题'], ['human_reply', '人工']]);
});
