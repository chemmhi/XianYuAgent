import type { WorkspaceMessageVM, WorkspaceRunEventVM, WorkspaceRunVM, WorkspaceStepVM } from './types';

const terminalStatuses = new Set(['succeeded', 'partially_succeeded', 'failed', 'cancelled', 'expired']);

function safeStatus(payload: Record<string, unknown>): string | undefined {
  return typeof payload.status === 'string' ? payload.status : undefined;
}

function eventTitle(eventType: string): string {
  const labels: Record<string, string> = {
    'run.queued': 'Run queued',
    'run.started': 'Run started',
    'run.executing': 'Agent executing',
    'run.succeeded': 'Run completed',
    'run.failed': 'Run failed',
    'step.started': 'Step started',
    'step.executing': 'Tool step executing',
    'step.succeeded': 'Step completed',
    'step.failed': 'Step failed',
  };
  return labels[eventType] ?? eventType.replace(/[._]/g, ' ');
}

function stepSummary(step: WorkspaceStepVM): string {
  if (step.outputSummary) return step.outputSummary;
  return `${step.label} is ${step.status}.`;
}

function eventSummary(event: WorkspaceRunEventVM): string {
  const status = safeStatus(event.payload);
  const errorCode = typeof event.payload.errorCode === 'string' ? event.payload.errorCode : undefined;
  if (errorCode) return `${eventTitle(event.eventType)} · ${errorCode}`;
  if (status) return `${eventTitle(event.eventType)} · ${status}`;
  return eventTitle(event.eventType);
}

function messageType(event: WorkspaceRunEventVM): WorkspaceMessageVM['type'] | undefined {
  const value = event.payload.messageType;
  return value === 'user_message' || value === 'reasoning_summary' || value === 'tool_event' || value === 'final_answer' ? value : undefined;
}

export function buildWorkspaceMessages(run: WorkspaceRunVM, events: WorkspaceRunEventVM[]): WorkspaceMessageVM[] {
  const messages: WorkspaceMessageVM[] = [{
    id: `${run.runId}:user`,
    type: 'user_message',
    createdAt: run.createdAt,
    title: 'You',
    content: run.instructionSummary,
  }];

  const steps = [...run.steps].sort((left, right) => left.sequence - right.sequence);
  steps.forEach((step) => {
    messages.push({
      id: `${run.runId}:reasoning:${step.stepId}`,
      type: 'reasoning_summary',
      createdAt: step.startedAt ?? run.updatedAt,
      title: 'Reasoning summary',
      content: stepSummary(step),
      summary: `${step.label} · ${step.status}`,
      status: step.status,
      collapsible: true,
    });
  });

  [...events].sort((left, right) => left.sequence - right.sequence).forEach((event) => {
    const messageKind = messageType(event);
    if (messageKind === 'user_message') return;
    messages.push({
      id: `${run.runId}:event:${event.sequence}`,
      type: messageKind ?? 'tool_event',
      createdAt: event.createdAt,
      title: messageKind === 'reasoning_summary' ? 'Reasoning summary' : messageKind === 'final_answer' ? 'Agent' : 'Tool event',
      content: typeof event.payload.content === 'string' ? event.payload.content : eventSummary(event),
      summary: typeof event.payload.summary === 'string' ? event.payload.summary : undefined,
      eventType: event.eventType,
      sequence: event.sequence,
      status: safeStatus(event.payload) as WorkspaceMessageVM['status'],
      collapsible: messageKind === 'reasoning_summary',
    });
  });

  if (terminalStatuses.has(run.status) && !events.some((event) => messageType(event) === 'final_answer')) {
    const failed = run.status === 'failed' || run.status === 'cancelled' || run.status === 'expired';
    messages.push({
      id: `${run.runId}:final`,
      type: 'final_answer',
      createdAt: run.finishedAt ?? run.updatedAt,
      title: failed ? 'Run outcome' : 'Agent',
      content: run.errorCode ? `${run.errorCode}: ${run.resultSummary ?? 'The run did not complete successfully.'}` : (run.resultSummary ?? `Run ${run.status}.`),
      status: run.status,
    });
  }

  return messages.sort((left, right) => {
    const byTime = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return byTime || (left.sequence ?? 0) - (right.sequence ?? 0);
  });
}
