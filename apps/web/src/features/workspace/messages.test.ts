import { describe, expect, it } from 'vitest';
import { buildWorkspaceMessages, deriveWorkspaceSessionTitle, groupWorkspaceMessages } from './messages';
import type { WorkspaceRunVM, WorkspaceRunEventVM } from './types';

const run: WorkspaceRunVM = {
  runId: 'run-1', sessionId: 'session-1', accountId: 'account-1', status: 'succeeded', instructionSummary: 'Check the shop state',
  createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:04.000Z', finishedAt: '2026-09-20T00:00:04.000Z', resultSummary: 'The controlled run completed.',
  steps: [{ stepId: 'step-1', runId: 'run-1', sequence: 1, kind: 'plan', label: 'Prepare execution context', status: 'succeeded', startedAt: '2026-09-20T00:00:01.000Z', outputSummary: 'Execution context prepared.' }],
};

const events: WorkspaceRunEventVM[] = [{ sequence: 2, runId: 'run-1', eventType: 'step.succeeded', payload: { status: 'succeeded' }, createdAt: '2026-09-20T00:00:02.000Z' }];

describe('workspace session title fallback', () => {
  it('keeps the first instruction readable while title generation is pending', () => {
    expect(deriveWorkspaceSessionTitle('  检查当前商品的自动发货规则  ')).toBe('检查当前商品的自动发货规则');
    expect(deriveWorkspaceSessionTitle('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十')).toBe('一二三四五六七八九十一二三四五六七八九十一二三四五六七…');
  });
});

describe('workspace message projection', () => {
  it('groups adjacent reasoning and tool events into one collapsed trace', () => {
    const projected = buildWorkspaceMessages(run, [
      { sequence: 2, runId: 'run-1', eventType: 'run.executing', payload: { status: 'executing' }, createdAt: '2026-09-20T00:00:01.500Z' },
      { sequence: 3, runId: 'run-1', eventType: 'step.executing', payload: { status: 'executing' }, createdAt: '2026-09-20T00:00:01.600Z' },
      { sequence: 4, runId: 'run-1', eventType: 'runtime.succeeded', payload: { messageType: 'final_answer', content: 'The controlled run completed.' }, createdAt: '2026-09-20T00:00:03.000Z' },
    ]);
    const blocks = groupWorkspaceMessages(projected);
    expect(blocks.map((block) => block.type)).toEqual(['user_message', 'agent_trace', 'final_answer']);
    expect(blocks[1]).toMatchObject({ type: 'agent_trace', messages: expect.arrayContaining([expect.objectContaining({ type: 'reasoning_summary' })]) });
  });

  it('renders the four canonical message types in chronological order', () => {
    const messages = buildWorkspaceMessages(run, events);
    expect(messages.map((message) => message.type)).toEqual(['user_message', 'reasoning_summary', 'final_answer']);
    expect(messages[1]).toMatchObject({ collapsible: true, summary: 'Prepare execution context · 已完成' });
    expect(messages[2]).toMatchObject({ type: 'final_answer' });
  });

  it('does not project lifecycle events as fake tool messages', () => {
    const projected = buildWorkspaceMessages({ ...run, status: 'running' }, [
      { sequence: 2, runId: 'run-1', eventType: 'run.queued', payload: { status: 'queued' }, createdAt: '2026-09-20T00:00:00.100Z' },
      { sequence: 3, runId: 'run-1', eventType: 'run.started', payload: { status: 'running' }, createdAt: '2026-09-20T00:00:00.200Z' },
      { sequence: 4, runId: 'run-1', eventType: 'runtime.started', payload: { status: 'running', messageType: 'tool_event' }, createdAt: '2026-09-20T00:00:00.300Z' },
      { sequence: 5, runId: 'run-1', eventType: 'stream.started', payload: { status: 'running' }, createdAt: '2026-09-20T00:00:00.400Z' },
      { sequence: 6, runId: 'run-1', eventType: 'step.executing', payload: { status: 'executing', messageType: 'tool_event' }, createdAt: '2026-09-20T00:00:00.500Z' },
    ]);
    expect(projected.filter((message) => message.type === 'tool_event')).toHaveLength(0);
    expect(projected.map((message) => message.type)).toEqual(['user_message', 'reasoning_summary']);
  });

  it('does not create a second trace from terminal reasoning events after the final answer', () => {
    const projected = buildWorkspaceMessages(run, [
      { sequence: 2, runId: 'run-1', eventType: 'message.appended', payload: { messageType: 'reasoning_summary', content: '正在分析请求。', summary: '已创建高层推理摘要' }, createdAt: '2026-09-20T00:00:01.500Z' },
      { sequence: 3, runId: 'run-1', eventType: 'message.appended', payload: { messageType: 'final_answer', content: 'The controlled run completed.' }, createdAt: '2026-09-20T00:00:03.000Z' },
      { sequence: 4, runId: 'run-1', eventType: 'step.succeeded', payload: { status: 'succeeded', messageType: 'reasoning_summary', summary: 'Prepare execution context' }, createdAt: '2026-09-20T00:00:04.000Z' },
    ]);

    expect(groupWorkspaceMessages(projected).map((block) => block.type)).toEqual(['user_message', 'agent_trace', 'final_answer']);
  });

  it('keeps the final answer after trace messages even when event timestamps race', () => {
    const projected = buildWorkspaceMessages(run, [
      { sequence: 2, runId: 'run-1', eventType: 'step.succeeded', payload: { status: 'succeeded', messageType: 'reasoning_summary', summary: 'Prepare execution context' }, createdAt: '2026-09-20T00:00:02.000Z' },
      { sequence: 3, runId: 'run-1', eventType: 'message.appended', payload: { messageType: 'final_answer', content: 'The controlled run completed.' }, createdAt: '2026-09-20T00:00:01.000Z' },
    ]);

    expect(projected.map((message) => message.type)).toEqual(['user_message', 'reasoning_summary', 'final_answer']);
    expect(groupWorkspaceMessages(projected).map((block) => block.type)).toEqual(['user_message', 'agent_trace', 'final_answer']);
  });

  it('keeps reasoning content high-level and excludes raw instruction input summaries', () => {
    const withRawInput = { ...run, steps: [{ ...run.steps[0], inputSummary: 'Check the shop state and expose sensitive details.' }] };
    const messages = buildWorkspaceMessages(withRawInput, []);
    expect(messages.find((message) => message.type === 'reasoning_summary')?.content).not.toContain('sensitive details');
  });

  it('renders the actual safe execution summary content instead of the generic label', () => {
    const messages = buildWorkspaceMessages(run, [{
      sequence: 2,
      runId: 'run-1',
      eventType: 'message.appended',
      payload: { messageType: 'reasoning_summary', content: '已识别为商品自动化命令，正在读取商品配置。', summary: '执行工作区命令' },
      createdAt: '2026-09-20T00:00:01.500Z',
    }]);
    expect(messages.find((message) => message.content === '已识别为商品自动化命令，正在读取商品配置。')?.type).toBe('reasoning_summary');
  });

  it('keeps persisted Pi reasoning summaries visible after live tool events arrive', () => {
    const messages = buildWorkspaceMessages(run, [
      { sequence: 2, runId: 'run-1', eventType: 'workspace.message', payload: { messageType: 'reasoning_summary', content: '已确认目标商品唯一匹配。现在读取分享命令与卡券所需字段。', summary: '核对商品并读取字段' }, createdAt: '2026-09-20T00:00:01.000Z' },
      { sequence: 3, runId: 'run-1', eventType: 'tool.call.started', payload: { toolCallId: 'call-1', toolName: 'pi_skill_search', summary: '检索 Skill 使用说明' }, createdAt: '2026-09-20T00:00:01.100Z' },
      { sequence: 4, runId: 'run-1', eventType: 'tool.result', payload: { toolCallId: 'call-1', toolName: 'pi_skill_search', summary: '已找到字段读取命令', result: { summary: '已找到字段读取命令', content: 'share create' } }, createdAt: '2026-09-20T00:00:01.500Z' },
    ]);
    const reasoning = messages.find((message) => message.type === 'reasoning_summary');
    expect(reasoning?.content).toContain('已确认目标商品唯一匹配');
    expect(messages.filter((message) => message.type === 'tool_event')).toHaveLength(1);
  });

  it('merges tool and answer deltas without rendering provider reasoning', () => {
    const messages = buildWorkspaceMessages(run, [
      { sequence: 2, runId: 'run-1', eventType: 'reasoning.delta', payload: { streamId: 's-1', messageId: 's-1:reasoning', contentDelta: '先读取' }, createdAt: '2026-09-20T00:00:01.000Z' },
      { sequence: 3, runId: 'run-1', eventType: 'reasoning.delta', payload: { streamId: 's-1', messageId: 's-1:reasoning', contentDelta: '商品。' }, createdAt: '2026-09-20T00:00:01.100Z' },
      { sequence: 4, runId: 'run-1', eventType: 'tool.call.started', payload: { toolCallId: 'call-1', toolName: 'workspace_read', arguments: '{"instruction":"查看商品"}' }, createdAt: '2026-09-20T00:00:01.200Z' },
      { sequence: 5, runId: 'run-1', eventType: 'tool.result', payload: { toolCallId: 'call-1', toolName: 'workspace_read', result: { content: '商品 1 个' } }, createdAt: '2026-09-20T00:00:02.000Z' },
      { sequence: 6, runId: 'run-1', eventType: 'assistant.delta', payload: { streamId: 's-2', messageId: 's-2:assistant', contentDelta: '已找到' }, createdAt: '2026-09-20T00:00:02.100Z' },
      { sequence: 7, runId: 'run-1', eventType: 'assistant.delta', payload: { streamId: 's-2', messageId: 's-2:assistant', contentDelta: ' 1 个商品。' }, createdAt: '2026-09-20T00:00:02.200Z' },
    ]);
    expect(messages.some((message) => message.content.includes('先读取商品。'))).toBe(false);
    expect(messages.find((message) => message.type === 'tool_event')?.content).toContain('商品 1 个');
    expect(messages.find((message) => message.type === 'final_answer')?.content).toBe('已找到 1 个商品。');
  });

  it('prefers the persisted failure answer over provisional assistant streaming text', () => {
    const failedRun: WorkspaceRunVM = {
      ...run,
      status: 'failed',
      errorCode: 'WORKSPACE_PRODUCT_SEARCH_REQUIRED',
      resultSummary: '工具 workspace_read 调用失败：请改用 workspace_product_search。',
      finishedAt: '2026-09-20T00:00:03.000Z',
    };
    const messages = buildWorkspaceMessages(failedRun, [
      { sequence: 2, runId: 'run-1', eventType: 'assistant.delta', payload: { messageType: 'final_answer', messageId: 'stream:assistant', contentDelta: '我先定位这个商品，再为你生成变更确认单。', status: 'running' }, createdAt: '2026-09-20T00:00:01.000Z' },
      { sequence: 3, runId: 'run-1', eventType: 'workspace.message', payload: { messageType: 'final_answer', content: '工具 workspace_read 调用失败：请改用 workspace_product_search。' }, createdAt: '2026-09-20T00:00:02.000Z' },
      { sequence: 4, runId: 'run-1', eventType: 'run.failed', payload: { status: 'failed', messageType: 'final_answer', content: '工具 workspace_read 调用失败：请改用 workspace_product_search。' }, createdAt: '2026-09-20T00:00:03.000Z' },
    ]);

    const finalAnswers = messages.filter((message) => message.type === 'final_answer');
    expect(finalAnswers).toHaveLength(1);
    expect(finalAnswers[0]?.content).toContain('工具 workspace_read 调用失败');
    expect(finalAnswers[0]?.content).not.toContain('我先定位这个商品');
  });

  it('shows the concrete tool name and final tool result event type', () => {
    const messages = buildWorkspaceMessages(run, [
      { sequence: 2, runId: 'run-1', eventType: 'tool.call.delta', payload: { toolCallId: 'call-2', argumentsDelta: '{"query":', status: 'streaming' }, createdAt: '2026-09-20T00:00:01.000Z' },
      { sequence: 3, runId: 'run-1', eventType: 'tool.result', payload: { toolCallId: 'call-2', toolName: 'workspace_product_search', result: { ok: true, content: '匹配到 1 个商品' }, status: 'succeeded' }, createdAt: '2026-09-20T00:00:01.500Z' },
    ]);
    const tool = messages.find((message) => message.type === 'tool_event');
    expect(tool).toMatchObject({ title: 'workspace_product_search', eventType: 'tool.result' });
    expect(tool?.content).toContain('匹配到 1 个商品');
  });

  it('keeps execution summaries beside useful tool results in event order', () => {
    const messages = buildWorkspaceMessages(run, [
      { sequence: 2, runId: 'run-1', eventType: 'workspace.execution.summary', payload: { messageType: 'reasoning_summary', summary: '检索商品信息', content: '正在检索商品信息，等待工具返回真实结果。', status: 'running' }, createdAt: '2026-09-20T00:00:01.000Z' },
      { sequence: 3, runId: 'run-1', eventType: 'tool.call.started', payload: { toolCallId: 'call-1', toolName: 'workspace_product_search', summary: '检索商品信息', status: 'running' }, createdAt: '2026-09-20T00:00:01.100Z' },
      { sequence: 4, runId: 'run-1', eventType: 'tool.result', payload: { toolCallId: 'call-1', toolName: 'workspace_product_search', summary: '已按名称筛选 1 个商品', result: { summary: '已按名称筛选 1 个商品', content: '匹配到 1 个商品' }, status: 'succeeded' }, createdAt: '2026-09-20T00:00:02.000Z' },
      { sequence: 5, runId: 'run-1', eventType: 'workspace.execution.summary', payload: { messageType: 'reasoning_summary', summary: '准备受控写入', content: '正在准备受控写入，等待工具返回真实结果。', status: 'running' }, createdAt: '2026-09-20T00:00:02.100Z' },
      { sequence: 6, runId: 'run-1', eventType: 'tool.call.started', payload: { toolCallId: 'call-2', toolName: 'workspace_prepare_write', summary: '准备受控写入', status: 'running' }, createdAt: '2026-09-20T00:00:02.200Z' },
    ]);
    const execution = messages.filter((message) => message.type === 'reasoning_summary' || message.type === 'tool_event');
    expect(execution.map((message) => message.type)).toEqual(['reasoning_summary', 'tool_event', 'reasoning_summary', 'tool_event']);
    expect(execution[0]).toMatchObject({ summary: '检索商品信息', content: '正在检索商品信息，等待工具返回真实结果。' });
    expect(execution[2]?.summary).toBe('准备受控写入');
    expect(execution[1]?.content).toContain('已按名称筛选 1 个商品');
  });

  it('shows result-based summaries between tools and hides provisional assistant text from tool rounds', () => {
    const messages = buildWorkspaceMessages(run, [
      { sequence: 2, runId: 'run-1', eventType: 'workspace.execution.summary', payload: { streamId: 'round-1', messageType: 'reasoning_summary', summary: '分析任务', content: '核对目标' }, createdAt: '2026-09-20T00:00:01.000Z' },
      { sequence: 3, runId: 'run-1', eventType: 'assistant.delta', payload: { streamId: 'round-1', messageType: 'final_answer', messageId: 'draft-1', contentDelta: '尚未完成' }, createdAt: '2026-09-20T00:00:01.100Z' },
      { sequence: 4, runId: 'run-1', eventType: 'tool.call.started', payload: { streamId: 'round-1', toolCallId: 'call-1', toolName: 'workspace_product_search', summary: '检索商品信息' }, createdAt: '2026-09-20T00:00:01.200Z' },
      { sequence: 5, runId: 'run-1', eventType: 'tool.result', payload: { streamId: 'round-1', toolCallId: 'call-1', toolName: 'workspace_product_search', summary: '找到商品', result: { summary: '找到商品', content: '商品 product-1' } }, createdAt: '2026-09-20T00:00:02.000Z' },
      { sequence: 6, runId: 'run-1', eventType: 'workspace.execution.summary', payload: { streamId: 'round-1', messageType: 'reasoning_summary', summary: '商品搜索', content: '找到商品' }, createdAt: '2026-09-20T00:00:02.100Z' },
      { sequence: 7, runId: 'run-1', eventType: 'tool.call.started', payload: { streamId: 'round-2', toolCallId: 'call-2', toolName: 'workspace_prepare_write', summary: '准备受控写入' }, createdAt: '2026-09-20T00:00:02.200Z' },
    ]);
    expect(messages.filter((message) => message.type === 'reasoning_summary' || message.type === 'tool_event').map((message) => message.type)).toEqual(['reasoning_summary', 'tool_event', 'reasoning_summary', 'tool_event']);
    expect(messages.some((message) => message.content === '尚未完成')).toBe(false);
  });

  it('projects one useful result per tool and never displays raw context checkpoints', () => {
    const projected = buildWorkspaceMessages(run, [
      { sequence: 2, runId: 'run-1', eventType: 'workspace.execution.summary', payload: { messageType: 'reasoning_summary', content: '正在核对任务目标与已有结果。', summary: '分析任务' }, createdAt: '2026-10-07T01:00:00.000Z' },
      { sequence: 3, runId: 'run-1', eventType: 'reasoning.delta', payload: { contentDelta: '内部推理细节' }, createdAt: '2026-10-07T01:00:00.100Z' },
      { sequence: 4, runId: 'run-1', eventType: 'tool.call.delta', payload: { toolCallId: 'call-1', toolName: 'workspace_product_search', argumentsDelta: '{"query":' }, createdAt: '2026-10-07T01:00:00.200Z' },
      { sequence: 5, runId: 'run-1', eventType: 'tool.call.started', payload: { toolCallId: 'call-1', toolName: 'workspace_product_search', summary: '检索商品信息' }, createdAt: '2026-10-07T01:00:00.300Z' },
      { sequence: 6, runId: 'run-1', eventType: 'tool.result', payload: { toolCallId: 'call-1', toolName: 'workspace_product_search', status: 'succeeded', result: { summary: '找到 1 个商品', content: '商品 product-1' } }, createdAt: '2026-10-07T01:00:00.400Z' },
      { sequence: 7, runId: 'run-1', eventType: 'workspace.message', payload: { messageType: 'tool_event', content: '{"data":{"items":["raw-json"]}}' }, createdAt: '2026-10-07T01:00:00.500Z' },
      { sequence: 8, runId: 'run-1', eventType: 'message.appended', payload: { messageType: 'reasoning_summary', summary: '上下文摘要', content: '原始目标：大量原始 JSON' }, createdAt: '2026-10-07T01:00:00.600Z' },
      { sequence: 9, runId: 'run-1', eventType: 'context.compacted', payload: { summary: '已压缩上下文并保留任务目标及关键结果' }, createdAt: '2026-10-07T01:00:00.700Z' },
    ]);
    expect(projected.filter((item) => item.type === 'tool_event')).toHaveLength(1);
    expect(projected.some((item) => item.type === 'reasoning_summary' && item.summary === '分析任务')).toBe(true);
    expect(projected.some((item) => item.content.includes('商品 product-1'))).toBe(true);
    expect(projected.every((item) => !/内部推理细节|raw-json|大量原始 JSON/.test(item.content))).toBe(true);
  });

  it('does not show a second tool event when a persisted result is reused', () => {
    const projected = buildWorkspaceMessages(run, [
      { sequence: 2, runId: 'run-1', eventType: 'tool.call.started', payload: { toolCallId: 'first', toolName: 'pi_skill_exec' }, createdAt: '2026-10-07T01:00:00.000Z' },
      { sequence: 3, runId: 'run-1', eventType: 'tool.result', payload: { toolCallId: 'first', toolName: 'pi_skill_exec', status: 'succeeded', result: { summary: '找到文件', content: 'fid=123' } }, createdAt: '2026-10-07T01:00:00.100Z' },
      { sequence: 4, runId: 'run-1', eventType: 'tool.call.started', payload: { toolCallId: 'second', toolName: 'pi_skill_exec' }, createdAt: '2026-10-07T01:00:00.200Z' },
      { sequence: 5, runId: 'run-1', eventType: 'tool.result', payload: { toolCallId: 'second', toolName: 'pi_skill_exec', status: 'succeeded', reused: true, result: { summary: '找到文件', content: 'fid=123' } }, createdAt: '2026-10-07T01:00:00.300Z' },
    ]);
    expect(projected.filter((item) => item.type === 'tool_event')).toHaveLength(1);
  });

  it('renders a JSON Skill result as a short result and link', () => {
    const projected = buildWorkspaceMessages(run, [
      { sequence: 2, runId: 'run-1', eventType: 'tool.result', payload: { toolCallId: 'share', toolName: 'pi_skill_exec', status: 'succeeded', result: { summary: '分享已创建', content: '{"ok":true,"data":{"url":"https://example.test/share/critical-link","items":[1,2,3]}}' } }, createdAt: '2026-10-07T01:00:00.000Z' },
    ]);
    const tool = projected.find((item) => item.type === 'tool_event');
    expect(tool?.content).toContain('critical-link');
    expect(tool?.content).not.toContain('"items"');
    expect(tool?.content).not.toContain('{"ok"');
  });
});
