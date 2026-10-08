import assert from 'node:assert/strict';
import test from 'node:test';
import { applyWorkspacePlanFacts, applyWorkspacePlanResult, buildWorkspaceCheckpoint, compactWorkspaceModelMessages, compactWorkspaceModelMessagesWithModel, completeConfirmedWorkspacePlanStep, createWorkspaceExecutionPlan, createWorkspaceExecutionPlanFromModel, createWorkspacePlanMessage, planWorkspaceToolUse, reopenBlockedWorkspacePlan, restoreWorkspaceExecutionPlan, reviseWorkspaceExecutionPlanFromModel } from '../src/workspace-context.js';
import { buildWorkspaceRuntimeHistory } from '../src/workspace.js';
import { allWorkspaceToolPlanMetadata } from '../src/workspace-tool-plans.js';
import type { RunEventRecord } from '../src/domain.js';

const tool = (name: string, description: string, parameters: Record<string, unknown> = {}) => ({
  type: 'function' as const,
  function: { name, description, parameters, plan: allWorkspaceToolPlanMetadata(name) },
});
const step = (toolName: string, goal: string, variant = 'default') => ({ tool: toolName, goal, variant, contractVersion: 1 });

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

test('checkpoint promotes product search item ids into stable productId facts', () => {
  const checkpoint = buildWorkspaceCheckpoint([
    event(1, 'tool.result', {
      status: 'succeeded',
      toolName: 'workspace_product_search',
      result: {
        kind: 'read',
        title: '商品搜索',
        summary: '已按名称/外部编号筛选 1 个商品',
        content: '匹配到 1 个商品',
        data: { total: 1, items: [{ id: '766c9dc7-aa05-4cc7-8f1e-cd7e35d2e97c', title: 'AI 技术咨询，需求定制开发服务', externalProductRef: '1082410574993' }] },
      },
    }),
  ]) ?? '';
  assert.match(checkpoint, /productId=766c9dc7-aa05-4cc7-8f1e-cd7e35d2e97c/);
  assert.match(checkpoint, /externalProductRef=1082410574993/);
  assert.match(checkpoint, /不要重复搜索/);
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

test('compaction preserves an early product search result after later Skill output', () => {
  const messages = [
    { role: 'system' as const, content: '系统规则' },
    { role: 'user' as const, content: '创建卡券并关联 AI 技术咨询，需求定制开发服务' },
    { role: 'tool' as const, name: 'workspace_product_search', content: JSON.stringify({ ok: true, kind: 'read', title: '商品搜索', data: { items: [{ id: 'product-early', title: 'AI 技术咨询，需求定制开发服务', externalProductRef: '1082410574993' }] } }) },
    ...Array.from({ length: 30 }, (_, index) => ({ role: 'tool' as const, name: 'pi_skill_search', content: `${index}:${'x'.repeat(1_500)}` })),
  ];
  const result = compactWorkspaceModelMessages(messages);
  assert.match(result.summary ?? '', /productId=product-early/);
  assert.match(result.summary ?? '', /1082410574993/);
});

test('model compaction injects early product facts into the model source and fallback summary', async () => {
  const messages = [
    { role: 'system' as const, content: '系统规则' },
    { role: 'user' as const, content: '创建卡券并关联 AI 技术咨询，需求定制开发服务' },
    { role: 'tool' as const, name: 'workspace_product_search', content: JSON.stringify({ ok: true, kind: 'read', title: '商品搜索', data: { items: [{ id: 'product-early', title: 'AI 技术咨询，需求定制开发服务', externalProductRef: '1082410574993' }] } }) },
    ...Array.from({ length: 30 }, (_, index) => ({ role: 'tool' as const, name: 'pi_skill_search', content: `${index}:${'x'.repeat(1_000)}` })),
  ];
  let modelInput = '';
  const result = await compactWorkspaceModelMessagesWithModel(messages, {
    async complete(input) {
      modelInput = String((input.messages[1] as { content?: unknown } | undefined)?.content ?? '');
      return { content: '已找到商品，等待后续操作。', model: 'test' };
    },
  });
  assert.equal(result.method, 'model');
  assert.match(modelInput, /productId=product-early/);
  assert.match(result.summary ?? '', /productId=product-early/);
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
  const tools = [tool('workspace_product_search', 'search')];
  const valid = await planWorkspaceToolUse('查找商品', tools, { async complete() { return { content: '{"steps":[{"tool":"workspace_product_search","variant":"default","contractVersion":1,"goal":"按名称查找目标商品"}]}', model: 'test' }; } });
  assert.match(valid ?? '', /workspace_product_search/);
  const invalid = await planWorkspaceToolUse('查找商品', tools, { async complete() { return { content: '{"steps":[{"tool":"workspace_prepare_write","variant":"default","contractVersion":1,"goal":"写入"}]}', model: 'test' }; } });
  assert.equal(invalid, undefined);
});

test('Plan Mode creates durable ordered steps and advances only the current step', async () => {
  const tools = [
    tool('workspace_product_search', 'search'),
    tool('workspace_prepare_write', 'write'),
  ];
  const plan = await createWorkspaceExecutionPlanFromModel('查找商品并准备写入', tools, {
    async complete() { return { content: '{"steps":[{"tool":"workspace_product_search","variant":"default","contractVersion":1,"goal":"定位目标商品"},{"tool":"workspace_prepare_write","variant":"coupon_create","contractVersion":1,"goal":"生成受控写入确认"}]}', model: 'test' }; },
  });
  assert.deepEqual(plan?.steps.map((step) => [step.id, step.tool, step.status]), [
    ['step-1', 'workspace_product_search', 'pending'],
    ['step-2', 'workspace_prepare_write', 'pending'],
  ]);
  assert.equal(plan?.currentStepId, 'step-1');
  const progressed = applyWorkspacePlanResult(plan!, { toolName: 'workspace_product_search', succeeded: true, evidence: 'productId=product-1' });
  assert.equal(progressed.steps[0]?.status, 'succeeded');
  assert.equal(progressed.currentStepId, 'step-2');
  assert.equal(progressed.status, 'active');
  const waiting = applyWorkspacePlanResult(progressed, { toolName: 'workspace_prepare_write', succeeded: true, waitingConfirmation: true, evidence: '等待确认' });
  assert.equal(waiting.status, 'waiting_confirmation');
  assert.equal(waiting.steps[1]?.status, 'waiting_confirmation');
  const restored = restoreWorkspaceExecutionPlan([event(1, 'workspace.plan.updated', { status: waiting.status, plan: waiting })]);
  assert.deepEqual(restored, waiting);
  assert.match(createWorkspacePlanMessage(waiting, ['商品搜索：productId=product-1']), /当前/);
  assert.match(createWorkspacePlanMessage(waiting, ['商品搜索：productId=product-1']), /不要重复调用相同工具/);
});

test('Plan Mode marks a completed plan after the final successful step', () => {
  const plan = createWorkspaceExecutionPlan({ instruction: '完成读取', steps: [step('workspace_read', '读取数据')], toolMetadata: { workspace_read: allWorkspaceToolPlanMetadata('workspace_read')! } })!;
  const completed = applyWorkspacePlanResult(plan, { toolName: 'workspace_read', succeeded: true, evidence: '读取完成' });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.currentStepId, undefined);
  assert.equal(completed.steps[0]?.status, 'succeeded');
});

test('Plan Mode reopens only the blocked step during an explicit reconnect', () => {
  const plan = createWorkspaceExecutionPlan({ instruction: '完成读取', steps: [step('workspace_read', '读取数据'), step('workspace_prepare_write', '准备写入', 'coupon_create')], toolMetadata: { workspace_read: allWorkspaceToolPlanMetadata('workspace_read')!, workspace_prepare_write: allWorkspaceToolPlanMetadata('workspace_prepare_write')! } })!;
  const blocked = applyWorkspacePlanResult(plan, { toolName: 'workspace_read', succeeded: false, evidence: '后端不可用' });
  const reopened = reopenBlockedWorkspacePlan(blocked);
  assert.equal(blocked.status, 'blocked');
  assert.equal(reopened.status, 'active');
  assert.equal(reopened.currentStepId, 'step-1');
  assert.equal(reopened.steps[0]?.status, 'pending');
  assert.equal(reopened.steps[1]?.status, 'pending');
  assert.equal(reopened.revision, blocked.revision + 1);
});

test('Plan Mode revises the remaining steps when the current tool cannot complete the task', async () => {
  const plan = createWorkspaceExecutionPlan({ instruction: '定位商品并读取状态', steps: [
    step('workspace_product_search', '定位目标商品'),
    step('workspace_read', '读取商品状态'),
  ], toolMetadata: { workspace_product_search: allWorkspaceToolPlanMetadata('workspace_product_search')!, workspace_read: allWorkspaceToolPlanMetadata('workspace_read')! } })!;
  const revised = await reviseWorkspaceExecutionPlanFromModel(plan, {
    toolName: 'workspace_product_search',
    code: 'SEARCH_BACKEND_DOWN',
    summary: '搜索后端不可用，改用工作区读取能力',
  }, [
    tool('workspace_product_search', 'search'),
    tool('workspace_read', 'read'),
  ], {
    async complete() { return { content: '{"steps":[{"tool":"workspace_read","variant":"default","contractVersion":1,"goal":"直接读取现有商品状态"}]}', model: 'replan-model' }; },
  });
  assert.equal(revised?.revision, 2);
  assert.equal(revised?.status, 'active');
  assert.equal(revised?.steps[0]?.status, 'blocked');
  assert.equal(revised?.steps[0]?.evidence, '搜索后端不可用，改用工作区读取能力');
  assert.equal(revised?.currentStepId, revised?.steps[1]?.id);
  assert.equal(revised?.steps[1]?.tool, 'workspace_read');
});

test('Plan Mode caps replanned steps at the eight-step plan limit', async () => {
  const plan = createWorkspaceExecutionPlan({ instruction: '执行完整任务', steps: [
    step('workspace_read', '已完成读取'),
    step('workspace_product_search', '当前搜索'),
    step('workspace_read', '原计划步骤 3'),
    step('workspace_read', '原计划步骤 4'),
    step('workspace_read', '原计划步骤 5'),
    step('workspace_read', '原计划步骤 6'),
    step('workspace_read', '原计划步骤 7'),
    step('workspace_read', '原计划步骤 8'),
  ], toolMetadata: { workspace_read: allWorkspaceToolPlanMetadata('workspace_read')!, workspace_product_search: allWorkspaceToolPlanMetadata('workspace_product_search')! } })!;
  const afterCompleted = applyWorkspacePlanResult(plan, { toolName: 'workspace_read', succeeded: true, evidence: '读取完成' });
  const revised = await reviseWorkspaceExecutionPlanFromModel(afterCompleted, {
    toolName: 'workspace_product_search',
    code: 'SEARCH_BACKEND_DOWN',
    summary: '搜索后端不可用',
  }, [
    tool('workspace_product_search', 'search'),
    tool('workspace_read', 'read'),
  ], {
    async complete() {
      return { content: JSON.stringify({ steps: Array.from({ length: 8 }, (_, index) => ({ tool: 'workspace_read', variant: 'default', contractVersion: 1, goal: `替代步骤 ${index + 1}` })) }), model: 'replan-model' };
    },
  });
  assert.ok(revised);
  assert.equal(revised.steps.length, 8);
  assert.equal(revised.steps.filter((step) => step.status === 'succeeded').length, 1);
  assert.equal(revised.steps.filter((step) => step.status === 'blocked').length, 1);
  assert.equal(revised.steps.filter((step) => step.status === 'pending').length, 6);
});

test('Plan Mode completes a confirmed write before continuing to the next step', () => {
  const plan = createWorkspaceExecutionPlan({ instruction: '先创建卡券再关联商品', steps: [step('workspace_prepare_write', '创建卡券', 'coupon_create'), step('workspace_product_search', '定位商品')], toolMetadata: { workspace_prepare_write: allWorkspaceToolPlanMetadata('workspace_prepare_write')!, workspace_product_search: allWorkspaceToolPlanMetadata('workspace_product_search')! } })!;
  const waiting = applyWorkspacePlanResult(plan, { toolName: 'workspace_prepare_write', succeeded: true, waitingConfirmation: true, evidence: '等待确认' });
  const continued = completeConfirmedWorkspacePlanStep(applyWorkspacePlanFacts(waiting, { couponBatchId: 'batch-1' }), '卡券已确认创建');
  assert.equal(waiting.status, 'waiting_confirmation');
  assert.equal(continued.status, 'active');
  assert.equal(continued.currentStepId, 'step-2');
  assert.equal(continued.steps[0]?.status, 'succeeded');
  assert.equal(continued.steps[0]?.evidence, '卡券已确认创建');
  assert.equal(continued.steps[1]?.status, 'pending');
});

test('Plan Mode falls back to a generic ordered tool plan when provider JSON is wrapped or invalid', async () => {
  const tools = [
    tool('pi_skill_catalog', 'catalog'),
    tool('pi_skill_read', 'read'),
    tool('pi_skill_exec', 'exec'),
    tool('workspace_product_search', 'search'),
    tool('workspace_prepare_write', 'write'),
  ];
  const plan = await createWorkspaceExecutionPlanFromModel('用网盘文件创建卡券并启用自动发货', tools, {
    async complete() { return { content: '我会按以下步骤执行：```json\n{"steps": [bad-json]\n```', model: 'test' }; },
  });
  assert.equal(plan, undefined);
});

test('fallback Plan Mode follows explicit discovery order instead of hard-coding Skill before product search', async () => {
  const tools = [
    tool('pi_skill_exec', 'exec'),
    tool('workspace_product_search', 'search'),
  ];
  const plan = await createWorkspaceExecutionPlanFromModel('查找商品并创建分享', tools, {
    async complete() { return { content: '{"steps":[]}', model: 'test' }; },
  });
  assert.equal(plan, undefined);
});

test('fallback Plan Mode does not invent tool steps from explicitly excluded nouns', async () => {
  const tools = [
    tool('workspace_product_search', 'search'),
  ];
  const plan = await createWorkspaceExecutionPlanFromModel('请用模型讲一句关于猫的冷知识，不要读取商品或订单。', tools, {
    async complete() { return { content: '{"steps":[]}', model: 'test' }; },
  });
  assert.equal(plan, undefined);
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
