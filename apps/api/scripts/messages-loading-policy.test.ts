import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationRefreshMode, messageRefreshMode } from '../src/messages-loading-policy.ts';

test('conversation list defaults to local-first background refresh', () => {
  assert.equal(conversationRefreshMode({}), 'background');
  assert.equal(conversationRefreshMode({ refreshExternal: false }), 'local');
  assert.equal(conversationRefreshMode({ refreshExternal: true }), 'await');
  assert.equal(conversationRefreshMode({ cursor: 'opaque' }), 'local');
});

test('message cursor reconciliation never refreshes Xianyu history', () => {
  assert.equal(messageRefreshMode({ cursor: 42 }), 'local');
  assert.equal(messageRefreshMode({ cursor: 42, refreshExternal: true }), 'local');
  assert.equal(messageRefreshMode({}), 'background');
  assert.equal(messageRefreshMode({ beforeCursor: 'history-cursor' }), 'await');
});
