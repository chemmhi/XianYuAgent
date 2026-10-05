import { describe, expect, it } from 'vitest';
import { buildWorkspaceMessages, deriveSessionTitle, groupWorkspaceMessages } from './messages';
import type { WorkspaceRunVM, WorkspaceRunEventVM } from './types';

const run: WorkspaceRunVM = {
  runId: 'run-1', sessionId: 'session-1', accountId: 'account-1', status: 'succeeded', instructionSummary: 'Check the shop state',
  createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:04.000Z', finishedAt: '2026-09-20T00:00:04.000Z', resultSummary: 'The controlled run completed.',
  steps: [{ stepId: 'step-1', runId: 'run-1', sequence: 1, kind: 'plan', label: 'Prepare execution context', status: 'succeeded', startedAt: '2026-09-20T00:00:01.000Z', outputSummary: 'Execution context prepared.' }],
};

const events: WorkspaceRunEventVM[] = [{ sequence: 2, runId: 'run-1', eventType: 'step.succeeded', payload: { status: 'succeeded' }, createdAt: '2026-09-20T00:00:02.000Z' }];

describe('workspace message projection', () => {
  it('derives a compact title from the first instruction', () => {
    expect(deriveSessionTitle('  查看  店铺库存\n并给出补货建议  ')).toBe('查看 店铺库存 并给出补货建议');
    expect(deriveSessionTitle('这是一个任务'.repeat(10))).toHaveLength(28);
  });

  it('groups adjacent reasoning and tool events into one collapsed trace', () => {
    const projected = buildWorkspaceMessages(run, [
      { sequence: 2, runId: 'run-1', eventType: 'run.executing', payload: { status: 'executing' }, createdAt: '2026-09-20T00:00:01.500Z' },
      { sequence: 3, runId: 'run-1', eventType: 'step.executing', payload: { status: 'executing' }, createdAt: '2026-09-20T00:00:01.600Z' },
      { sequence: 4, runId: 'run-1', eventType: 'runtime.succeeded', payload: { messageType: 'final_answer', content: 'The controlled run completed.' }, createdAt: '2026-09-20T00:00:03.000Z' },
    ]);
    const blocks = groupWorkspaceMessages(projected);
    expect(blocks.map((block) => block.type)).toEqual(['user_message', 'agent_trace', 'final_answer']);
    expect(blocks[1]).toMatchObject({ type: 'agent_trace', messages: expect.arrayContaining([expect.objectContaining({ type: 'reasoning_summary' }), expect.objectContaining({ type: 'tool_event' })]) });
  });

  it('renders the four canonical message types in chronological order', () => {
    const messages = buildWorkspaceMessages(run, events);
    expect(messages.map((message) => message.type)).toEqual(['user_message', 'reasoning_summary', 'tool_event', 'final_answer']);
    expect(messages[1]).toMatchObject({ collapsible: true, summary: 'Prepare execution context · 已完成' });
    expect(messages[2]).toMatchObject({ eventType: 'step.succeeded', sequence: 2 });
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

  it('merges provider streaming deltas into one reasoning, tool and answer message', () => {
    const messages = buildWorkspaceMessages(run, [
      { sequence: 2, runId: 'run-1', eventType: 'reasoning.delta', payload: { streamId: 's-1', messageId: 's-1:reasoning', contentDelta: '先读取' }, createdAt: '2026-09-20T00:00:01.000Z' },
      { sequence: 3, runId: 'run-1', eventType: 'reasoning.delta', payload: { streamId: 's-1', messageId: 's-1:reasoning', contentDelta: '商品。' }, createdAt: '2026-09-20T00:00:01.100Z' },
      { sequence: 4, runId: 'run-1', eventType: 'tool.call.started', payload: { toolCallId: 'call-1', toolName: 'workspace_read', arguments: '{"instruction":"查看商品"}' }, createdAt: '2026-09-20T00:00:01.200Z' },
      { sequence: 5, runId: 'run-1', eventType: 'tool.result', payload: { toolCallId: 'call-1', toolName: 'workspace_read', result: { content: '商品 1 个' } }, createdAt: '2026-09-20T00:00:02.000Z' },
      { sequence: 6, runId: 'run-1', eventType: 'assistant.delta', payload: { streamId: 's-2', messageId: 's-2:assistant', contentDelta: '已找到' }, createdAt: '2026-09-20T00:00:02.100Z' },
      { sequence: 7, runId: 'run-1', eventType: 'assistant.delta', payload: { streamId: 's-2', messageId: 's-2:assistant', contentDelta: ' 1 个商品。' }, createdAt: '2026-09-20T00:00:02.200Z' },
    ]);
    expect(messages.find((message) => message.type === 'reasoning_summary')?.content).toBe('先读取商品。');
    expect(messages.find((message) => message.type === 'tool_event')?.content).toContain('商品 1 个');
    expect(messages.find((message) => message.type === 'final_answer')?.content).toBe('已找到 1 个商品。');
  });
});
