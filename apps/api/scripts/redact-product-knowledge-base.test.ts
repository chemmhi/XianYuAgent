import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideProductKnowledgeBaseRedaction } from '../src/product-knowledge-base-redaction.js';

test('redaction decision removes delivery links and credentials while preserving safe content', () => {
  const decision = decideProductKnowledgeBaseRedaction({ knowledgeBase: '付款后发送。\n夸克网盘：https://pan.quark.cn/s/STOCK-SECRET\n提取码：QK42' });
  assert.equal(decision.changed, true);
  assert.match(decision.sanitized, /付款后发送/);
  assert.doesNotMatch(decision.sanitized, /STOCK-SECRET|QK42|pan\.quark\.cn/);
  assert.equal(decision.removedChars > 0, true);
});

test('redaction decision is idempotent for already safe content', () => {
  const decision = decideProductKnowledgeBaseRedaction({ knowledgeBase: '支持数字资料交付。' });
  assert.deepEqual(decision, { changed: false, current: '支持数字资料交付。', sanitized: '支持数字资料交付。', removedChars: 0 });
});

test('redaction decision clears knowledge bases containing only delivery credentials', () => {
  const decision = decideProductKnowledgeBaseRedaction({ knowledgeBase: '百度网盘：https://pan.baidu.com/s/STOCK-BAIDU\n访问码：B42X' });
  assert.equal(decision.changed, true);
  assert.equal(decision.sanitized, '');
});
