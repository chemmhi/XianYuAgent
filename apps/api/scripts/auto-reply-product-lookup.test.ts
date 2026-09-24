import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresStore } from '../src/store-postgres.js';
import { MemoryStore } from '../src/store-memory.js';

test('memory exact product lookup returns the complete auto-reply context', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'product-lookup@example.com', passwordHash: 'hash', displayName: 'Product Lookup' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'product-lookup-seller' });
  await store.createProduct({
    adminId: admin.id,
    accountId: account.id,
    externalProductRef: 'ITEM-LOOKUP',
    title: '精确查询商品',
    description: '完整商品描述',
    defaultReplyTemplate: '可以直接拍下。',
    knowledgeBase: '支持数字资料交付。',
    priceMinor: 1_999,
    status: 'published',
    attributes: { xianyu: { detail: { summary: { browseCount: 321, wantCount: 33, collectCount: 8 } } } },
  });

  const product = await store.getAutoReplyProduct(admin.id, { accountId: account.id, externalProductRef: 'ITEM-LOOKUP' });
  assert.equal(product?.title, '精确查询商品');
  assert.equal(product?.description, '完整商品描述');
  assert.equal(product?.browseCount, 321);
  assert.equal(product?.wantCount, 33);
  assert.equal(product?.collectCount, 8);
  assert.equal(product?.defaultReplyTemplate, '可以直接拍下。');
  assert.equal(product?.knowledgeBase, '支持数字资料交付。');
  assert.equal(product?.priceMinor, 1_999);
  assert.equal(product?.status, 'published');
});

test('postgres exact product lookup executes one row query without count', async () => {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    external_product_ref: 'ITEM-LOOKUP',
    title: '精确查询商品',
    description: '完整商品描述',
    default_reply_template: '可以直接拍下。',
    knowledge_base: '支持数字资料交付。',
    price_minor: 1_999,
    status: 'published',
    browse_count: 321,
    want_count: 33,
    collect_count: 8,
  };
  const store = Object.create(PostgresStore.prototype) as PostgresStore;
  (store as unknown as { pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> } }).pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [row] };
    },
  };

  const product = await store.getAutoReplyProduct('admin-1', { accountId: 'account-1', externalProductRef: 'ITEM-LOOKUP' });
  assert.equal(product?.description, '完整商品描述');
  assert.equal(queries.length, 1);
  assert.match(queries[0]?.sql ?? '', /limit 1/i);
  assert.doesNotMatch(queries[0]?.sql ?? '', /count\s*\(/i);
  assert.deepEqual(queries[0]?.params, ['admin-1', 'account-1', 'ITEM-LOOKUP']);

  queries.length = 0;
  await store.getAutoReplyProduct('admin-1', { accountId: 'account-1', productId: row.id });
  assert.equal(queries.length, 1);
  assert.match(queries[0]?.sql ?? '', /p\.id=\$3::uuid/);
  assert.doesNotMatch(queries[0]?.sql ?? '', /count\s*\(/i);
  assert.deepEqual(queries[0]?.params, ['admin-1', 'account-1', row.id]);
});

test('memory product search lets the Agent retry core terms after an exact phrase miss', async () => {
  const store = new MemoryStore();
  const admin = await store.createAdmin({ email: 'product-search@example.com', passwordHash: 'hash', displayName: 'Product Search' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'product-search-seller' });
  const otherAccount = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'product-search-other' });
  await store.createProduct({ adminId: admin.id, accountId: account.id, title: 'Hermes Agent 企业级实战', description: '夸克网盘 24 小时自动发货，支持 Word/Excel/PPT 自动化。', status: 'published' });
  await store.createProduct({ adminId: admin.id, accountId: otherAccount.id, title: '其他账号夸克自动化', description: '夸克 自动化', status: 'published' });

  const result = await store.listAutoReplyProducts(admin.id, { accountId: account.id, keyword: '夸克自动化', keywords: ['夸克', '自动化'], limit: 20 });
  assert.equal(result.searchMode, 'core_terms');
  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.title, 'Hermes Agent 企业级实战');

  const noResult = await store.listAutoReplyProducts(admin.id, { accountId: account.id, keyword: '不存在的商品', keywords: ['不存在', '商品'], limit: 20 });
  assert.equal(noResult.total, 0);
  assert.deepEqual(noResult.items, []);
});

test('postgres product search queries the full phrase before Agent-provided core terms', async () => {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const store = Object.create(PostgresStore.prototype) as PostgresStore;
  (store as unknown as { pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> } }).pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (queries.length === 1) return { rows: [{ total: 0 }] };
      if (queries.length === 2) return { rows: [] };
      if (queries.length === 3) return { rows: [{ total: 1 }] };
      return { rows: [{ id: 'product-1', external_product_ref: 'ITEM-1', title: '夸克网盘自动化', description: '夸克 自动化', status: 'published', price_minor: 100 }] };
    },
  };

  const result = await store.listAutoReplyProducts('admin-1', { accountId: 'account-1', keyword: '夸克自动化', keywords: ['夸克', '自动化'], limit: 20 });
  assert.equal(result.searchMode, 'core_terms');
  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.title, '夸克网盘自动化');
  assert.equal(queries.length, 4);
  assert.deepEqual(queries[0]?.params, ['admin-1', 'account-1', '%夸克自动化%']);
  assert.deepEqual(queries[2]?.params, ['admin-1', 'account-1', '%夸克%', '%自动化%']);
  assert.match(queries[2]?.sql ?? '', /or/);
});
