import type { WorkspaceMessageVM, WorkspaceRunEventVM, WorkspaceRunVM, WorkspaceStepVM } from './types';

const terminalStatuses = new Set(['succeeded', 'partially_succeeded', 'failed', 'cancelled', 'expired']);

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: '排队中', running: '运行中', waiting_confirmation: '等待确认', executing: '执行中', retrying: '重试中', cancelling: '取消中',
    succeeded: '已完成', partially_succeeded: '部分完成', failed: '失败', cancelled: '已取消', expired: '已过期', pending: '待执行', skipped: '已跳过',
  };
  return labels[status] ?? status;
}

function safeStatus(payload: Record<string, unknown>): string | undefined {
  return typeof payload.status === 'string' ? payload.status : undefined;
}

function eventTitle(eventType: string): string {
  const labels: Record<string, string> = {
    'run.queued': 'Run 已排队',
    'run.started': 'Run 已开始',
    'run.executing': 'Agent 执行中',
    'run.succeeded': 'Run 已完成',
    'run.failed': 'Run 失败',
    'step.started': '步骤已开始',
    'step.executing': '工具步骤执行中',
    'step.succeeded': '步骤已完成',
    'step.failed': '步骤失败',
  };
  return labels[eventType] ?? eventType.replace(/[._]/g, ' ');
}

function stepSummary(step: WorkspaceStepVM): string {
  if (step.outputSummary) return step.outputSummary;
  return `${step.label}：${statusLabel(step.status)}。`;
}

function eventSummary(event: WorkspaceRunEventVM): string {
  const status = safeStatus(event.payload);
  const errorCode = typeof event.payload.errorCode === 'string' ? event.payload.errorCode : undefined;
  if (errorCode) return `${eventTitle(event.eventType)} · ${errorCode}`;
  if (status) return `${eventTitle(event.eventType)} · ${statusLabel(status)}`;
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
    title: '用户',
    content: run.instructionSummary,
  }];

  const steps = [...run.steps].sort((left, right) => left.sequence - right.sequence);
  steps.forEach((step) => {
    messages.push({
      id: `${run.runId}:reasoning:${step.stepId}`,
      type: 'reasoning_summary',
      createdAt: step.startedAt ?? run.updatedAt,
      title: '推理摘要',
      content: stepSummary(step),
      summary: `${step.label} · ${statusLabel(step.status)}`,
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
      title: messageKind === 'reasoning_summary' ? '推理摘要' : messageKind === 'final_answer' ? 'Agent' : '工具事件',
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
      title: failed ? 'Run 结果' : 'Agent',
      content: run.errorCode ? `${run.errorCode}：${run.resultSummary ?? '本次 Run 未成功完成。'}` : (run.resultSummary ?? `Run ${statusLabel(run.status)}。`),
      status: run.status,
    });
  }

  return messages.sort((left, right) => {
    const byTime = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return byTime || (left.sequence ?? 0) - (right.sequence ?? 0);
  });
}
