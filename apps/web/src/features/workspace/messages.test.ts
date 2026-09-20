import { describe, expect, it } from 'vitest';
import { buildWorkspaceMessages } from './messages';
import type { WorkspaceRunVM, WorkspaceRunEventVM } from './types';

const run: WorkspaceRunVM = {
  runId: 'run-1', sessionId: 'session-1', accountId: 'account-1', status: 'succeeded', instructionSummary: 'Check the shop state',
  createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:04.000Z', finishedAt: '2026-09-20T00:00:04.000Z', resultSummary: 'The controlled run completed.',
  steps: [{ stepId: 'step-1', runId: 'run-1', sequence: 1, kind: 'plan', label: 'Prepare execution context', status: 'succeeded', startedAt: '2026-09-20T00:00:01.000Z', outputSummary: 'Execution context prepared.' }],
};

const events: WorkspaceRunEventVM[] = [{ sequence: 2, runId: 'run-1', eventType: 'step.succeeded', payload: { status: 'succeeded' }, createdAt: '2026-09-20T00:00:02.000Z' }];

describe('workspace message projection', () => {
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
