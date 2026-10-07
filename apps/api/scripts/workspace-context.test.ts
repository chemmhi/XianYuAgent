import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkspaceCheckpoint, compactWorkspaceModelMessages } from '../src/workspace-context.js';
import type { RunEventRecord } from '../src/domain.js';

const event = (sequence: number, eventType: string, payload: Record<string, unknown>): RunEventRecord => ({
  sequence, runId: 'run-1', eventType, payload, createdAt: '2026-10-07T01:00:00.000Z',
});

test('checkpoint retains full product and Skill results plus the confirmed coupon ID', () => {
  const share = `https://example.test/share/${'x'.repeat(3_000)}`;
  const checkpoint = buildWorkspaceCheckpoint([
    event(1, 'tool.result', { status: 'succeeded', toolName: 'workspace_product_search', result: { kind: 'read', title: '商品搜索', summary: '找到商品', content: '商品详情', data: { productId: 'product-1', title: 'AI 技术咨询' } } }),
    event(2, 'tool.result', { status: 'succeeded', toolName: 'pi_skill_exec', result: { kind: 'read', title: '网盘分享', summary: '已创建分享', content: share } }),
    event(3, 'tool.result', { status: 'succeeded', toolName: 'workspace_prepare_write', result: { kind: 'write_plan', title: '卡券确认', summary: '等待确认', content: '尚未执行' } }),
    event(4, 'workspace.coupon.created', { status: 'succeeded', batchId: '18', label: '03 PPT Master' }),
  ]);
  assert.match(checkpoint ?? '', /product-1/);
  assert.match(checkpoint ?? '', /batchId=18/);
  assert.ok(checkpoint?.includes(share));
  assert.ok(!checkpoint?.includes('尚未执行'));
});

test('compaction keeps the original goal and recent results within the model budget', () => {
  const messages = [
    { role: 'system' as const, content: '系统规则' },
    { role: 'user' as const, content: '创建卡券并关联商品，启用自动发货' },
    ...Array.from({ length: 30 }, (_, index) => ({ role: 'tool' as const, name: 'pi_skill_exec', toolCallId: `call-${index}`, content: `${index}:${'a'.repeat(1_500)}${index === 29 ? ' https://example.test/share/critical-link' : ''}` })),
  ];
  const result = compactWorkspaceModelMessages(messages);
  assert.ok(result.summary);
  assert.match(result.summary, /创建卡券并关联商品/);
  assert.match(result.summary, /29:/);
  assert.match(result.summary, /https:\/\/example\.test\/share\/critical-link/);
  assert.equal(result.messages[0]?.role, 'system');
  assert.equal(result.messages.at(-1)?.role, 'user');
  assert.ok(JSON.stringify(result.messages).length < JSON.stringify(messages).length);
});
