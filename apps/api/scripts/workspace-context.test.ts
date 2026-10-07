import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkspaceCheckpoint, compactWorkspaceModelMessages, compactWorkspaceModelMessagesWithModel, planWorkspaceToolUse } from '../src/workspace-context.js';
import { buildWorkspaceRuntimeHistory } from '../src/workspace.js';
import type { RunEventRecord } from '../src/domain.js';

const event = (sequence: number, eventType: string, payload: Record<string, unknown>): RunEventRecord => ({
  sequence, runId: 'run-1', eventType, payload, createdAt: '2026-10-07T01:00:00.000Z',
});

test('checkpoint retains identifiers and share URL without replaying raw results', () => {
  const share = 'https://example.test/share/critical-link';
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
  assert.ok((checkpoint?.length ?? 0) <= 3_100);
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

test('large fixed Skill instructions do not trigger compaction before any tool result', async () => {
  const messages = [
    { role: 'system' as const, content: 'x'.repeat(17_000) },
    { role: 'user' as const, content: '使用 03 PPT Master 创建卡券' },
  ];
  const result = await compactWorkspaceModelMessagesWithModel(messages, {
    async complete() { throw new Error('the first round has nothing to compact'); },
  });
  assert.equal(result.summary, undefined);
  assert.equal(result.afterChars, result.beforeChars);
  assert.deepEqual(result.messages, messages);
});

test('checkpoint keeps a share URL when the same Skill later returns help text', () => {
  const checkpoint = buildWorkspaceCheckpoint([
    event(1, 'tool.result', { status: 'succeeded', toolName: 'pi_skill_exec', result: { kind: 'read', title: 'quarkclouddrive | quark-drive', summary: 'Skill execution complete', content: '分享链接 https://example.test/share/critical-link' } }),
    event(2, 'tool.result', { status: 'succeeded', toolName: 'pi_skill_exec', result: { kind: 'read', title: 'quarkclouddrive | quark-drive', summary: 'Skill execution complete', content: 'Usage: quark-drive --help' } }),
  ]);
  assert.match(checkpoint ?? '', /critical-link/);
});

test('checkpoint interprets legacy successful envelopes with failed Skill exit codes as failures', () => {
  const failed = event(1, 'tool.result', { status: 'succeeded', toolName: 'pi_skill_exec', result: { kind: 'read', title: 'Skill search', summary: 'Skill execution failed (1)', content: 'file not found', data: { status: 'failed', code: 1 } } });
  assert.match(buildWorkspaceCheckpoint([failed]) ?? '', /上次失败/);
  const corrected = event(2, 'tool.result', { status: 'succeeded', toolName: 'pi_skill_exec', result: { kind: 'read', title: 'Skill search', summary: '找到文件', content: 'fid=123', data: { status: 'succeeded', code: 0 } } });
  const checkpoint = buildWorkspaceCheckpoint([failed, corrected]) ?? '';
  assert.match(checkpoint, /fid=123/);
  assert.doesNotMatch(checkpoint, /上次失败/);
});

test('model compaction removes redundant output and retains critical identifiers', async () => {
  const messages = [
    { role: 'system' as const, content: '系统规则' },
    { role: 'user' as const, content: '创建卡券，关联 productId=product-1' },
    ...Array.from({ length: 30 }, (_, index) => ({ role: 'tool' as const, content: `${index}:${'x'.repeat(1_000)}${index === 29 ? ' https://example.test/share/critical-link batchId=18' : ''}` })),
  ];
  let calls = 0;
  const result = await compactWorkspaceModelMessagesWithModel(messages, {
    async complete(input) { calls += 1; assert.equal(input.toolChoice, 'none'); return { content: '已找到商品和分享链接；卡券待关联。', model: 'test' }; },
  });
  assert.equal(calls, 1);
  assert.equal(result.method, 'model');
  assert.ok(result.afterChars < result.beforeChars / 2);
  assert.match(result.summary ?? '', /product-1|batchId=18/);
  assert.match(result.summary ?? '', /critical-link/);
  assert.doesNotMatch(result.summary ?? '', /x{50}/);
});

test('model failure does not publish a heuristic fallback as a compressed summary', async () => {
  const messages = [
    { role: 'system' as const, content: 'Workspace rules' },
    { role: 'user' as const, content: '创建卡券并关联商品' },
    ...Array.from({ length: 30 }, (_, index) => ({ role: 'tool' as const, content: `${index}:${'x'.repeat(1_000)}` })),
  ];
  const result = await compactWorkspaceModelMessagesWithModel(messages, { async complete() { throw new Error('model unavailable'); } });
  assert.equal(result.summary, undefined);
  assert.equal(result.afterChars, result.beforeChars);
  assert.deepEqual(result.messages, messages);
});

test('model compaction rejects a marginal reduction dominated by fixed context', async () => {
  const messages = [
    { role: 'system' as const, content: 'x'.repeat(40_000) },
    { role: 'user' as const, content: '创建卡券' },
    { role: 'assistant' as const, content: 'y'.repeat(8_000) },
  ];
  const result = await compactWorkspaceModelMessagesWithModel(messages, { async complete() { return { content: '任务仍在处理中，尚未创建卡券。', model: 'test' }; } }, true);
  assert.equal(result.summary, undefined);
  assert.equal(result.afterChars, result.beforeChars);
});

test('tool planning accepts only available tools and bounded structured steps', async () => {
  const tools = [{ type: 'function' as const, function: { name: 'workspace_product_search', description: 'search', parameters: {} } }];
  const valid = await planWorkspaceToolUse('查找商品', tools, { async complete() { return { content: '{"steps":[{"tool":"workspace_product_search","goal":"按名称查找目标商品"}]}', model: 'test' }; } });
  assert.match(valid ?? '', /workspace_product_search/);
  const invalid = await planWorkspaceToolUse('查找商品', tools, { async complete() { return { content: '{"steps":[{"tool":"workspace_prepare_write","goal":"写入"}]}', model: 'test' }; } });
  assert.equal(invalid, undefined);
});

test('confirmed-run history does not replay raw tool JSON alongside its checkpoint', () => {
  const run = { id: 'run-1', instruction: '创建卡券并启用自动发货', createdAt: '2026-10-07T01:00:00.000Z' } as never;
  const messages = [
    { runId: 'run-1', type: 'user_message', content: '创建卡券并启用自动发货', sequence: 1 },
    { runId: 'run-1', type: 'tool_event', content: JSON.stringify({ data: { items: Array(100).fill('irrelevant') } }), summary: '商品搜索', sequence: 2 },
    { runId: 'run-1', type: 'reasoning_summary', content: '冗余执行进度', summary: '分析任务', sequence: 3 },
  ] as never;
  const history = buildWorkspaceRuntimeHistory(messages, run, [event(4, 'workspace.coupon.created', { status: 'succeeded', batchId: '18', label: '03 PPT Master' })]);
  assert.equal(history.length, 1);
  assert.match(history[0]!.content, /batchId=18/);
  assert.doesNotMatch(history[0]!.content, /irrelevant|冗余执行进度/);
});
