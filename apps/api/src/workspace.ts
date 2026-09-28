import type { AgentSessionRecord, RunEventRecord, RunRecord, RunStatus, StepRecord, StepStatus, Store, WorkspaceMessageRecord } from './domain.js';
import { ServiceError } from './services.js';
import { executeNativeWorkspaceRead } from './workspace-native-read.js';

const terminalRunStatuses = new Set<RunStatus>(['succeeded', 'partially_succeeded', 'failed', 'cancelled', 'expired']);
const runTransitions: Record<RunStatus, RunStatus[]> = {
  queued: ['running', 'cancelled', 'expired'],
  running: ['waiting_confirmation', 'executing', 'failed', 'cancelled'],
  waiting_confirmation: ['executing', 'cancelled', 'expired'],
  executing: ['succeeded', 'partially_succeeded', 'failed', 'cancelling'],
  retrying: ['running', 'failed', 'cancelled'],
  cancelling: ['cancelled', 'failed'],
  succeeded: [],
  partially_succeeded: [],
  failed: ['retrying'],
  cancelled: [],
  expired: [],
};
const stepTransitions: Record<StepStatus, StepStatus[]> = {
  pending: ['running', 'cancelled', 'skipped'],
  running: ['waiting_confirmation', 'executing', 'succeeded', 'failed', 'cancelled'],
  waiting_confirmation: ['executing', 'cancelled'],
  executing: ['succeeded', 'partially_succeeded', 'failed', 'cancelled'],
  retrying: ['running', 'failed', 'cancelled'],
  succeeded: [],
  partially_succeeded: [],
  failed: ['retrying'],
  skipped: [],
  cancelled: [],
};

export interface WorkspaceSessionView {
  id: string;
  accountId: string;
  title: string;
  status: AgentSessionRecord['status'];
  summary?: string;
  lastActiveAt: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceStepView {
  stepId: string;
  runId: string;
  sequence: number;
  kind: StepRecord['kind'];
  label: string;
  status: StepStatus;
  startedAt?: string;
  finishedAt?: string;
  inputSummary?: string;
  outputSummary?: string;
  affectedEntityRefs: Array<{ type: string; id: string }>;
  errorCode?: string;
}

export interface WorkspaceRunView {
  runId: string;
  sessionId: string;
  accountId: string;
  status: RunStatus;
  instructionSummary: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  currentStepId?: string;
  steps: WorkspaceStepView[];
  resultSummary?: string;
  errorCode?: string;
  clientRunRef?: string;
}

export interface WorkspaceRuntime {
  enqueue(input: { run: RunRecord; steps: StepRecord[]; adminId?: string; sessionId?: string; history?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> }): void;
  stop(): void;
}

export class InProcessAgentRuntime implements WorkspaceRuntime {
  private readonly active = new Set<string>();
  private stopped = false;

  constructor(private readonly store: Store) {}

  enqueue(input: { run: RunRecord; steps: StepRecord[]; adminId?: string; sessionId?: string }): void {
    if (this.stopped || this.active.has(input.run.id)) return;
    this.active.add(input.run.id);
    setTimeout(() => {
      if (this.stopped) { this.active.delete(input.run.id); return; }
      void this.execute(input).finally(() => this.active.delete(input.run.id));
    }, 0);
  }

  stop(): void { this.stopped = true; }

  private async execute(input: { run: RunRecord; steps: StepRecord[]; adminId?: string; sessionId?: string }): Promise<void> {
    const step = input.steps[0];
    if (!step) return;
    const startedAt = new Date().toISOString();
    await this.transitionRun(input.run, 'running', { startedAt });
    await this.transitionStep(step, 'running', { startedAt });
    await this.emit(input.run.id, 'run.started', { status: 'running' });
    await this.emit(input.run.id, 'step.started', { stepId: step.id, status: 'running' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await this.transitionRun(input.run, 'executing');
    await this.transitionStep(step, 'executing');
    await this.emit(input.run.id, 'run.executing', { status: 'executing' });
    await this.emit(input.run.id, 'step.executing', { stepId: step.id, status: 'executing' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const finishedAt = new Date().toISOString();
    const nativeRead = await executeNativeWorkspaceRead({ store: this.store, adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: input.run.instruction });
    if (nativeRead) {
      const sessionId = input.sessionId ?? input.run.sessionId;
      await this.store.appendWorkspaceMessage({ adminId: input.adminId ?? input.run.requestedBy, sessionId, runId: input.run.id, type: 'tool_event', content: nativeRead.content, summary: nativeRead.summary });
      await this.emit(input.run.id, 'workspace.native_read', { messageType: 'tool_event', resource: nativeRead.kind, summary: nativeRead.summary, content: nativeRead.content, data: nativeRead.data });
      await this.transitionStep(step, 'succeeded', { finishedAt, outputSummary: nativeRead.summary });
      await this.transitionRun(input.run, 'succeeded', { finishedAt, resultSummary: nativeRead.content });
      await this.store.appendWorkspaceMessage({ adminId: input.adminId ?? input.run.requestedBy, sessionId, runId: input.run.id, type: 'final_answer', content: nativeRead.content });
      await this.emit(input.run.id, 'run.succeeded', { status: 'succeeded', resultSummary: nativeRead.content, messageType: 'final_answer', content: nativeRead.content, resource: nativeRead.kind });
      return;
    }
    if (/\b(fail|failed|error)\b/i.test(input.run.instruction)) {
      await this.transitionStep(step, 'failed', { errorCode: 'RUNTIME_FAILED', finishedAt, outputSummary: '受控 Runtime 返回失败结果' });
      await this.transitionRun(input.run, 'failed', { errorCode: 'RUNTIME_FAILED', finishedAt });
      await this.emit(input.run.id, 'step.failed', { stepId: step.id, status: 'failed', errorCode: 'RUNTIME_FAILED' });
      await this.emit(input.run.id, 'run.failed', { status: 'failed', errorCode: 'RUNTIME_FAILED' });
      return;
    }
    await this.transitionStep(step, 'succeeded', { finishedAt, outputSummary: '受控 Runtime 已完成首条执行链路' });
    await this.transitionRun(input.run, 'succeeded', { finishedAt, resultSummary: 'Run 已完成，结果已持久化' });
    await this.emit(input.run.id, 'step.succeeded', { stepId: step.id, status: 'succeeded' });
    await this.emit(input.run.id, 'run.succeeded', { status: 'succeeded', resultSummary: 'Run 已完成，结果已持久化' });
  }

  private async transitionRun(run: RunRecord, next: RunStatus, patch: { startedAt?: string; finishedAt?: string; resultSummary?: string; errorCode?: string } = {}): Promise<void> {
    if (run.status !== next && !runTransitions[run.status].includes(next)) throw new Error(`INVALID_RUN_TRANSITION:${run.status}->${next}`);
    run.status = next;
    Object.assign(run, patch);
    await this.store.updateRun(run.id, { status: next, ...patch });
  }

  private async transitionStep(step: StepRecord, next: StepStatus, patch: { startedAt?: string; finishedAt?: string; outputSummary?: string; errorCode?: string } = {}): Promise<void> {
    if (step.status !== next && !stepTransitions[step.status].includes(next)) throw new Error(`INVALID_STEP_TRANSITION:${step.status}->${next}`);
    step.status = next;
    Object.assign(step, patch);
    await this.store.updateRunStep(step.id, { status: next, ...patch });
  }

  private async emit(runId: string, eventType: string, payload: Record<string, unknown>): Promise<RunEventRecord> {
    return this.store.appendRunEvent({ runId, eventType, payload });
  }
}

export class WorkspaceService {
  constructor(
    private readonly store: Store,
    private readonly runtime: WorkspaceRuntime,
    private readonly audit: (input: { actorId: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown; accountId?: string }) => Promise<string>,
  ) {}

  async listSessions(input: { adminId: string; accountId?: string; search?: string }): Promise<WorkspaceSessionView[]> {
    if (input.accountId && !(await this.store.hasAccountScope(input.adminId, input.accountId))) throw new ServiceError(403, 'FORBIDDEN', 'account scope required');
    return (await this.store.listAgentSessions(input.adminId, input)).map((session) => this.toSessionView(session));
  }

  async createSession(input: { adminId: string; accountId: string; title: string; summary?: string; requestId: string; traceId: string }): Promise<WorkspaceSessionView> {
    if (!input.accountId.trim()) throw new ServiceError(422, 'VALIDATION_FAILED', 'accountId is required');
    const title = input.title.trim() || '新工作区会话';
    try {
      const session = await this.store.createAgentSession({ adminId: input.adminId, accountId: input.accountId, title, summary: input.summary?.trim() || undefined });
      await this.audit({ actorId: input.adminId, action: 'workspace.session.created', targetRef: session.id, requestId: input.requestId, traceId: input.traceId, payload: { title: session.title }, accountId: session.accountId });
      return this.toSessionView(session);
    } catch (error) { throw mapWorkspaceStoreError(error); }
  }

  async switchSession(input: { adminId: string; sessionId: string; requestId: string; traceId: string }): Promise<WorkspaceSessionView> {
    const session = await this.store.getAgentSession(input.adminId, input.sessionId);
    if (!session) throw new ServiceError(404, 'NOT_FOUND', 'agent session not found');
    if (session.status !== 'active') throw new ServiceError(409, 'CONFLICT', 'archived session is read-only');
    await this.audit({ actorId: input.adminId, action: 'workspace.session.switched', targetRef: session.id, requestId: input.requestId, traceId: input.traceId, payload: {}, accountId: session.accountId });
    return this.toSessionView(session);
  }

  async archiveSession(input: { adminId: string; sessionId: string; requestId: string; traceId: string }): Promise<WorkspaceSessionView> {
    const session = await this.store.archiveAgentSession(input.adminId, input.sessionId);
    if (!session) throw new ServiceError(404, 'NOT_FOUND', 'agent session not found');
    await this.audit({ actorId: input.adminId, action: 'workspace.session.archived', targetRef: session.id, requestId: input.requestId, traceId: input.traceId, payload: {}, accountId: session.accountId });
    return this.toSessionView(session);
  }

  async startRun(input: { adminId: string; accountId: string; sessionId: string; instruction: string; clientRunRef?: string; requestId: string; traceId: string }): Promise<{ run: WorkspaceRunView; duplicate: boolean }> {
    const instruction = input.instruction.trim();
    if (!instruction) throw new ServiceError(422, 'VALIDATION_FAILED', 'instruction is required');
    if (instruction.length > 4000) throw new ServiceError(422, 'VALIDATION_FAILED', 'instruction cannot exceed 4000 characters');
    if (!(await this.store.hasAccountScope(input.adminId, input.accountId))) throw new ServiceError(403, 'FORBIDDEN', 'account scope required');
    const session = await this.store.getAgentSession(input.adminId, input.sessionId);
    if (!session) throw new ServiceError(404, 'NOT_FOUND', 'agent session not found');
    if (session.accountId !== input.accountId) throw new ServiceError(409, 'CONFLICT', 'session account mismatch');
    if (session.status !== 'active') throw new ServiceError(409, 'CONFLICT', 'archived session is read-only');
    if (input.clientRunRef) {
      const existing = await this.store.findRunByClientRef(input.adminId, input.accountId, input.clientRunRef);
      if (existing) return { run: this.toRunView(existing.run, existing.steps), duplicate: true };
    }
    try {
      const created = await this.store.createRun({ adminId: input.adminId, accountId: input.accountId, sessionId: input.sessionId, instruction, clientRunRef: input.clientRunRef });
      await this.audit({ actorId: input.adminId, action: 'workspace.run.created', targetRef: created.run.id, requestId: input.requestId, traceId: input.traceId, payload: { sessionId: input.sessionId, instructionLength: instruction.length, hasClientRunRef: Boolean(input.clientRunRef) }, accountId: input.accountId });
      await this.store.appendRunEvent({ runId: created.run.id, eventType: 'run.queued', payload: { status: 'queued', sessionId: input.sessionId, accountId: input.accountId } });
      await this.appendMessage({ adminId: input.adminId, sessionId: input.sessionId, runId: created.run.id, type: 'user_message', content: instruction.slice(0, 2_000) });
      const history = (await this.store.listWorkspaceMessages(input.adminId, input.sessionId, 100))
        .filter((message) => message.id !== undefined)
        .slice(0, -1)
        .map((message) => ({ role: message.type === 'user_message' ? 'user' as const : 'assistant' as const, content: `[${message.type}] ${message.summary ?? message.content}` }));
      this.runtime.enqueue({ ...created, adminId: input.adminId, sessionId: input.sessionId, history });
      return { run: this.toRunView(created.run, created.steps), duplicate: false };
    } catch (error) { throw mapWorkspaceStoreError(error); }
  }

  async getRun(input: { adminId: string; runId: string }): Promise<WorkspaceRunView> {
    const bundle = await this.store.getRun(input.adminId, input.runId);
    if (!bundle) throw new ServiceError(404, 'NOT_FOUND', 'run not found');
    return this.toRunView(bundle.run, bundle.steps);
  }

  async listEvents(input: { adminId: string; runId: string; afterSequence?: number }): Promise<RunEventRecord[]> {
    const run = await this.store.getRun(input.adminId, input.runId);
    if (!run) throw new ServiceError(404, 'NOT_FOUND', 'run not found');
    return this.store.listRunEvents(input.adminId, input.runId, input.afterSequence ?? 0);
  }

  async listMessages(input: { adminId: string; sessionId: string; limit?: number }): Promise<WorkspaceMessageRecord[]> {
    const session = await this.store.getAgentSession(input.adminId, input.sessionId);
    if (!session) throw new ServiceError(404, 'NOT_FOUND', 'agent session not found');
    return this.store.listWorkspaceMessages(input.adminId, input.sessionId, input.limit ?? 100);
  }

  private async appendMessage(input: { adminId: string; sessionId: string; runId?: string; type: 'user_message' | 'reasoning_summary' | 'tool_event' | 'final_answer'; content: string; summary?: string }): Promise<void> {
    const message = await this.store.appendWorkspaceMessage(input);
    if (input.runId) await this.store.appendRunEvent({ runId: input.runId, eventType: 'message.appended', payload: { messageType: message.type, messageId: message.id, content: message.content, summary: message.summary, createdAt: message.createdAt } });
  }

  private toSessionView(session: AgentSessionRecord): WorkspaceSessionView { return { ...session }; }

  private toRunView(run: RunRecord, steps: StepRecord[]): WorkspaceRunView {
    const mappedSteps = steps.map((step) => ({ stepId: step.id, runId: step.runId, sequence: step.stepNo, kind: step.kind, label: step.label, status: step.status, startedAt: step.startedAt, finishedAt: step.finishedAt, inputSummary: step.inputSummary, outputSummary: step.outputSummary, affectedEntityRefs: [], errorCode: step.errorCode }));
    const current = mappedSteps.find((step) => ['running', 'executing', 'waiting_confirmation', 'retrying'].includes(step.status));
    return { runId: run.id, sessionId: run.sessionId, accountId: run.accountId, status: run.status, instructionSummary: run.instruction.slice(0, 240), createdAt: run.createdAt, updatedAt: run.updatedAt, startedAt: run.startedAt, finishedAt: run.finishedAt, currentStepId: current?.stepId, steps: mappedSteps, resultSummary: run.resultSummary, errorCode: run.errorCode, clientRunRef: run.clientRunRef };
  }
}

function mapWorkspaceStoreError(error: unknown): ServiceError {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'ACCOUNT_SCOPE_FORBIDDEN') return new ServiceError(403, 'FORBIDDEN', 'account scope required');
  if (code === 'SESSION_NOT_FOUND') return new ServiceError(404, 'NOT_FOUND', 'agent session not found');
  if (code === 'SESSION_ARCHIVED') return new ServiceError(409, 'CONFLICT', 'archived session is read-only');
  return error instanceof ServiceError ? error : new ServiceError(500, 'WORKSPACE_STORE_ERROR', 'workspace persistence failed');
}

export function isTerminalRunStatus(status: RunStatus): boolean { return terminalRunStatuses.has(status); }
