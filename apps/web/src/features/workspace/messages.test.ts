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

  it('groups adjacent tool events while preserving primary messages', () => {
    const projected = buildWorkspaceMessages(run, [
      { sequence: 2, runId: 'run-1', eventType: 'run.executing', payload: { status: 'executing' }, createdAt: '2026-09-20T00:00:01.500Z' },
      { sequence: 3, runId: 'run-1', eventType: 'step.executing', payload: { status: 'executing' }, createdAt: '2026-09-20T00:00:01.600Z' },
      { sequence: 4, runId: 'run-1', eventType: 'runtime.succeeded', payload: { messageType: 'final_answer', content: 'The controlled run completed.' }, createdAt: '2026-09-20T00:00:03.000Z' },
    ]);
    const blocks = groupWorkspaceMessages(projected);
    expect(blocks.map((block) => block.type)).toEqual(['user_message', 'reasoning_summary', 'tool_group', 'final_answer']);
    expect(blocks[2]).toMatchObject({ title: '执行过程 · 2 条事件' });
  });

  it('renders the four canonical message types in chronological order', () => {
    const messages = buildWorkspaceMessages(run, events);
    expect(messages.map((message) => message.type)).toEqual(['user_message', 'reasoning_summary', 'tool_event', 'final_answer']);
    expect(messages[1]).toMatchObject({ collapsible: true, summary: 'Prepare execution context · 已完成' });
    expect(messages[2]).toMatchObject({ eventType: 'step.succeeded', sequence: 2 });
  });

  it('keeps reasoning content high-level and excludes raw instruction input summaries', () => {
    const withRawInput = { ...run, steps: [{ ...run.steps[0], inputSummary: 'Check the shop state and expose sensitive details.' }] };
    const messages = buildWorkspaceMessages(withRawInput, []);
    expect(messages.find((message) => message.type === 'reasoning_summary')?.content).not.toContain('sensitive details');
  });
});
