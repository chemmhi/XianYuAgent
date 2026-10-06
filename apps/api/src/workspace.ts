import type { AgentSessionRecord, AutoReplyOutboxRecord, RunEventRecord, RunRecord, RunStatus, StepRecord, StepStatus, Store, WorkspaceConfirmationRecord, WorkspaceMessageRecord } from './domain.js';
import { ServiceError } from './services.js';
import type { CouponService } from './services.js';
import type { AutoReplyAgentSettingsService } from './auto-reply-agent-settings.js';
import { executeNativeWorkspaceRead } from './workspace-native-read.js';
import { prepareNativeWorkspaceWrite, sanitizeWorkspaceInstruction } from './workspace-native-write.js';
import { persistWorkspaceConfirmation } from './workspace-confirmation.js';
import type { WorkspaceCommandOrchestrator } from './workspace-commands.js';

const terminalRunStatuses = new Set<RunStatus>(['succeeded', 'partially_succeeded', 'failed', 'cancelled', 'expired']);
const runTransitions: Record<RunStatus, RunStatus[]> = {
  queued: ['running', 'cancelled', 'expired'],
  running: ['waiting_confirmation', 'executing', 'failed', 'cancelled', 'retrying'],
  waiting_confirmation: ['executing', 'cancelled', 'expired'],
  executing: ['waiting_confirmation', 'succeeded', 'partially_succeeded', 'failed', 'cancelling', 'retrying'],
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
  running: ['waiting_confirmation', 'executing', 'succeeded', 'failed', 'cancelled', 'retrying'],
  waiting_confirmation: ['executing', 'cancelled'],
  executing: ['waiting_confirmation', 'succeeded', 'partially_succeeded', 'failed', 'cancelled', 'retrying'],
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
  runId?: string;
  runStatus?: RunStatus;
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

export interface WorkspaceConfirmationView {
  confirmationId: string;
  runId: string;
  stepId: string;
  accountId: string;
  action: WorkspaceConfirmationRecord['action'];
  policyRef: string;
  manifest: Record<string, unknown>;
  status: WorkspaceConfirmationRecord['status'];
  version: number;
  expiresAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceOutboxView {
  outboxId: string;
  runId: string;
  scope: string;
  operation: string;
  status: AutoReplyOutboxRecord['status'];
  attempt: number;
  availableAt: string;
  externalOutcome?: AutoReplyOutboxRecord['externalOutcome'];
  lastErrorCode?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRuntime {
  enqueue(input: { run: RunRecord; steps: StepRecord[]; adminId?: string; sessionId?: string; history?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> }): void;
  resume(input: { run: RunRecord; steps: StepRecord[]; adminId?: string; sessionId?: string; history?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> }): Promise<void>;
  stop(): void;
}

const terminalStepStatuses = new Set<StepStatus>(['succeeded', 'partially_succeeded', 'skipped', 'cancelled']);

export function findWorkspaceExecutionStep(steps: StepRecord[]): StepRecord | undefined {
  return steps.find((step) => !terminalStepStatuses.has(step.status));
}

/**
 * Reset a stranded Workspace run to the retry boundary before putting it back
 * on the runtime queue. This is intentionally idempotent so reconnect clicks
 * and process-restart recovery can share the same path.
 */
export async function prepareWorkspaceRunResume(input: { store: Store; run: RunRecord; steps: StepRecord[] }): Promise<{ run: RunRecord; steps: StepRecord[] } | undefined> {
  if (['succeeded', 'partially_succeeded', 'cancelled', 'expired'].includes(input.run.status) || input.run.status === 'waiting_confirmation' || input.run.status === 'cancelling') return undefined;
  const run = { ...input.run };
  const steps = input.steps.map((step) => ({ ...step }));
  const step = findWorkspaceExecutionStep(steps);
  if (!step || step.status === 'waiting_confirmation') return undefined;
  if (run.status === 'queued' && step.status === 'pending') return { run, steps };

  const retrySummary = '任务已从当前失败节点重新入队';
  if (run.status !== 'retrying') {
    const updatedRun = await input.store.updateRun(run.id, { status: 'retrying', resultSummary: retrySummary, errorCode: null, finishedAt: null });
    if (!updatedRun) throw new Error('WORKSPACE_STORE_ERROR');
    run.status = 'retrying';
    run.resultSummary = retrySummary;
    run.errorCode = undefined;
    run.finishedAt = undefined;
    await input.store.appendRunEvent({ runId: run.id, eventType: 'run.retrying', payload: { status: 'retrying', reason: 'reconnect', currentStepId: step.id } });
  }
  if (step.status !== 'retrying') {
    const updatedStep = await input.store.updateRunStep(step.id, { status: 'retrying', outputSummary: retrySummary, errorCode: null, finishedAt: null });
    if (!updatedStep) throw new Error('WORKSPACE_STORE_ERROR');
    step.status = 'retrying';
    step.outputSummary = retrySummary;
    step.errorCode = undefined;
    step.finishedAt = undefined;
    await input.store.appendRunEvent({ runId: run.id, eventType: 'step.retrying', payload: { stepId: step.id, status: 'retrying', reason: 'reconnect' } });
  }
  return { run, steps };
}

export class InProcessAgentRuntime implements WorkspaceRuntime {
  private readonly active = new Set<string>();
  private stopped = false;

  constructor(private readonly store: Store, private readonly commands?: WorkspaceCommandOrchestrator) {}

  enqueue(input: { run: RunRecord; steps: StepRecord[]; adminId?: string; sessionId?: string }): void {
    if (this.stopped || this.active.has(input.run.id)) return;
    this.active.add(input.run.id);
    setTimeout(() => {
      if (this.stopped) { this.active.delete(input.run.id); return; }
      void this.execute(input).finally(() => this.active.delete(input.run.id));
    }, 0);
  }

  async resume(input: { run: RunRecord; steps: StepRecord[]; adminId?: string; sessionId?: string }): Promise<void> {
    if (this.stopped || this.active.has(input.run.id)) return;
    const prepared = await prepareWorkspaceRunResume({ store: this.store, run: input.run, steps: input.steps });
    if (!prepared) return;
    this.enqueue({ ...input, ...prepared });
  }

  stop(): void { this.stopped = true; }

  private async execute(input: { run: RunRecord; steps: StepRecord[]; adminId?: string; sessionId?: string }): Promise<void> {
    const step = findWorkspaceExecutionStep(input.steps);
    if (!step) return;
    const startedAt = new Date().toISOString();
    await this.transitionRun(input.run, 'running', { startedAt });
    await this.transitionStep(step, 'running', { startedAt });
    await this.emit(input.run.id, 'run.started', { status: 'running' });
    await this.emit(input.run.id, 'step.started', { stepId: step.id, status: 'running' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const nativeWrite = this.commands
      ? await this.commands.prepareWrite({ adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: input.run.instruction, requestId: `workspace:${input.run.id}`, traceId: `workspace:${input.run.id}` })
      : await prepareNativeWorkspaceWrite({ store: this.store, adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: input.run.instruction });
    if (nativeWrite) {
      const sessionId = input.sessionId ?? input.run.sessionId;
      await this.transitionStep(step, 'waiting_confirmation', { outputSummary: nativeWrite.summary });
      await this.transitionRun(input.run, 'waiting_confirmation', { resultSummary: nativeWrite.summary });
      const confirmation = await persistWorkspaceConfirmation({ store: this.store, adminId: input.adminId ?? input.run.requestedBy, sessionId, run: input.run, step, plan: nativeWrite });
      await this.emit(input.run.id, 'workspace.confirmation.created', { status: 'active', confirmationId: confirmation.id, action: confirmation.action, policyRef: confirmation.policyRef, manifest: confirmation.manifest, expiresAt: confirmation.expiresAt });
      return;
    }
    await this.transitionRun(input.run, 'executing');
    await this.transitionStep(step, 'executing');
    await this.emit(input.run.id, 'run.executing', { status: 'executing' });
    await this.emit(input.run.id, 'step.executing', { stepId: step.id, status: 'executing' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const finishedAt = new Date().toISOString();
    const nativeRead = this.commands
      ? await this.commands.execute({ adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: input.run.instruction, requestId: `workspace:${input.run.id}`, traceId: `workspace:${input.run.id}` })
      : await executeNativeWorkspaceRead({ store: this.store, adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: input.run.instruction });
    if (nativeRead) {
      const sessionId = input.sessionId ?? input.run.sessionId;
      await this.store.appendWorkspaceMessage({ adminId: input.adminId ?? input.run.requestedBy, sessionId, runId: input.run.id, type: 'tool_event', content: nativeRead.content, summary: nativeRead.summary });
      const commandResult = 'mutation' in nativeRead && nativeRead.mutation;
      await this.emit(input.run.id, commandResult ? 'workspace.command.executed' : 'workspace.native_read', { messageType: 'tool_event', resource: nativeRead.kind, operation: 'operation' in nativeRead ? nativeRead.operation : undefined, summary: nativeRead.summary, content: nativeRead.content, data: nativeRead.data });
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
    private readonly coupons?: CouponService,
    private readonly agentSettings?: AutoReplyAgentSettingsService,
    private readonly commands?: WorkspaceCommandOrchestrator,
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

  async deleteSession(input: { adminId: string; sessionId: string; requestId: string; traceId: string }): Promise<WorkspaceSessionView> {
    try {
      const session = await this.store.deleteAgentSession(input.adminId, input.sessionId);
      if (!session) throw new ServiceError(404, 'NOT_FOUND', 'agent session not found');
      await this.audit({ actorId: input.adminId, action: 'workspace.session.deleted', targetRef: session.id, requestId: input.requestId, traceId: input.traceId, payload: {}, accountId: session.accountId });
      return this.toSessionView(session);
    } catch (error) { throw mapWorkspaceStoreError(error); }
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
      await this.appendMessage({ adminId: input.adminId, sessionId: input.sessionId, runId: created.run.id, type: 'user_message', content: sanitizeWorkspaceInstruction(instruction) });
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

  async getConfirmation(input: { adminId: string; runId: string }): Promise<WorkspaceConfirmationView> {
    const bundle = await this.store.getRun(input.adminId, input.runId);
    if (!bundle) throw new ServiceError(404, 'NOT_FOUND', 'run not found');
    const confirmation = await this.store.getWorkspaceConfirmation(input.adminId, input.runId);
    if (!confirmation) throw new ServiceError(404, 'NOT_FOUND', 'confirmation not found');
    return this.toConfirmationView(confirmation);
  }

  async confirmRun(input: { adminId: string; runId: string; expectedVersion: number; requestId: string; traceId: string }): Promise<{ run: WorkspaceRunView; confirmation: WorkspaceConfirmationView; outbox: WorkspaceOutboxView }> {
    const bundle = await this.store.getRun(input.adminId, input.runId);
    if (!bundle) throw new ServiceError(404, 'NOT_FOUND', 'run not found');
    if (bundle.run.status !== 'waiting_confirmation') throw new ServiceError(409, 'CONFLICT', 'run is not waiting for confirmation');
    const current = await this.store.getWorkspaceConfirmation(input.adminId, input.runId);
    if (!current) throw new ServiceError(404, 'NOT_FOUND', 'confirmation not found');
    if (current.status !== 'active') throw new ServiceError(409, 'CONFLICT', 'confirmation is no longer active', { status: current.status });
    if (current.action === 'agent_settings_update') {
      if (!this.agentSettings) throw new ServiceError(500, 'WORKSPACE_STORE_ERROR', 'agent settings service unavailable');
      const expectedVersion = Number(current.manifest.expectedVersion ?? 0);
      const currentSettings = await this.agentSettings.get(input.adminId, bundle.run.accountId);
      if (currentSettings.configVersion !== expectedVersion) throw new ServiceError(409, 'VERSION_CONFLICT', 'agent settings version changed; refresh and retry', { server: currentSettings });
    }
    const confirmation = await this.store.transitionWorkspaceConfirmation({ adminId: input.adminId, confirmationId: current.id, expectedVersion: input.expectedVersion, status: 'confirmed', actorId: input.adminId });
    if (!confirmation) throw new ServiceError(409, 'VERSION_CONFLICT', 'confirmation version changed; refresh and retry');
    await this.store.appendRunEvent({ runId: input.runId, eventType: 'workspace.confirmation.confirmed', payload: { confirmationId: confirmation.id, status: 'confirmed', version: confirmation.version, action: confirmation.action } });
    await this.audit({ actorId: input.adminId, action: 'workspace.confirmation.confirmed', targetRef: confirmation.id, requestId: input.requestId, traceId: input.traceId, payload: { action: confirmation.action }, accountId: bundle.run.accountId });
    const step = bundle.steps.find((item) => item.id === confirmation.stepId);
    if (!step) throw new ServiceError(409, 'CONFLICT', 'confirmation step not found');
    const run = await this.store.updateRun(input.runId, { status: 'executing', resultSummary: confirmation.action === 'coupon_create' ? '管理员已确认，正在写入卡券域' : confirmation.action === 'agent_settings_update' ? '管理员已确认，正在写入 Agent 配置' : '管理员已确认，已进入外部执行队列' });
    await this.store.updateRunStep(step.id, { status: 'executing', outputSummary: confirmation.action === 'coupon_create' ? '已通过管理员确认，正在创建卡券批次' : confirmation.action === 'agent_settings_update' ? '已通过管理员确认，正在更新 Agent 配置' : '已通过管理员确认，等待 Outbox Worker' });
    const scope = this.executionScope(input.adminId, bundle.run.accountId);
    if (confirmation.action === 'agent_settings_update') {
      return this.confirmAgentSettingsUpdate({ input, bundle, step, confirmation, scope, run: run!, requestId: input.requestId, traceId: input.traceId });
    }
    if (confirmation.action === 'coupon_create') {
      return this.confirmCouponCreate({ input, bundle, step, confirmation, scope, run: run!, requestId: input.requestId, traceId: input.traceId });
    }
    const canExecuteProductPublish = confirmation.action !== 'product_publish' || Boolean(this.commands && await this.commands.canExecuteProductPublish({ adminId: input.adminId, manifest: confirmation.manifest }));
    if (this.commands && canExecuteProductPublish) {
      return this.confirmCommand({ input, bundle, step, confirmation, scope, run: run!, requestId: input.requestId, traceId: input.traceId });
    }
    const queued = await this.store.enqueueAutoReplyOutbox({ scope, aggregateType: 'workspace_run', aggregateId: bundle.run.id, operation: confirmation.action, idempotencyKey: `workspace-confirm:${confirmation.id}`, payload: confirmation.manifest, traceId: input.traceId });
    await this.store.appendRunEvent({ runId: input.runId, eventType: 'workspace.outbox.enqueued', payload: { outboxId: queued.record.id, status: queued.record.status, operation: queued.record.operation } });
    if (!run) throw new ServiceError(500, 'WORKSPACE_STORE_ERROR', 'run update failed');
    return { run: this.toRunView(run, (await this.store.getRun(input.adminId, input.runId))?.steps ?? bundle.steps), confirmation: this.toConfirmationView(confirmation), outbox: this.toOutboxView(queued.record, bundle.run.id) };
  }

  private async confirmCommand(input: { input: { adminId: string; runId: string; requestId: string; traceId: string }; bundle: { run: RunRecord; steps: StepRecord[] }; step: StepRecord; confirmation: WorkspaceConfirmationRecord; scope: string; run: RunRecord; requestId: string; traceId: string }): Promise<{ run: WorkspaceRunView; confirmation: WorkspaceConfirmationView; outbox: WorkspaceOutboxView }> {
    if (!this.commands) throw new ServiceError(500, 'WORKSPACE_STORE_ERROR', 'workspace command orchestrator unavailable');
    try {
      const plan = {
        kind: input.confirmation.action as never,
        action: input.confirmation.action as never,
        policyRef: input.confirmation.policyRef,
        title: String(input.confirmation.manifest.title ?? input.confirmation.action),
        summary: String(input.confirmation.manifest.summary ?? input.confirmation.action),
        content: '',
        expiresAt: input.confirmation.expiresAt,
        manifest: input.confirmation.manifest,
        executionPlan: input.confirmation.executionPlan,
      };
      const result = await this.commands.confirm({ plan, run: input.bundle.run, step: input.step, adminId: input.input.adminId, requestId: input.requestId, traceId: input.traceId });
      const queued = await this.store.enqueueAutoReplyOutbox({ scope: input.scope, aggregateType: 'workspace_run', aggregateId: input.bundle.run.id, operation: input.confirmation.action, idempotencyKey: `workspace-confirm:${input.confirmation.id}`, payload: { ...input.confirmation.manifest, result: result.data ?? {} }, traceId: input.traceId });
      const workerId = `workspace-local-command:${input.bundle.run.id}`;
      const claimed = await this.store.claimAutoReplyOutbox({ scope: input.scope, workerId, limit: 1, leaseMs: 60_000, id: queued.record.id });
      if (!claimed[0] || !(await this.store.completeAutoReplyOutbox({ id: queued.record.id, workerId, externalOutcome: 'known_success', externalMessageRef: input.confirmation.action }))) throw new ServiceError(500, 'WORKSPACE_STORE_ERROR', 'workspace command outbox completion failed');
      const finishedAt = new Date().toISOString();
      const updatedRun = await this.store.updateRun(input.bundle.run.id, { status: 'succeeded', finishedAt, resultSummary: result.resultSummary });
      await this.store.updateRunStep(input.step.id, { status: 'succeeded', finishedAt, outputSummary: result.outputSummary });
      await this.store.appendWorkspaceMessage({ adminId: input.input.adminId, sessionId: input.bundle.run.sessionId, runId: input.bundle.run.id, type: 'final_answer', content: result.outputSummary, summary: result.resultSummary });
      await this.store.appendRunEvent({ runId: input.input.runId, eventType: 'workspace.command.completed', payload: { action: input.confirmation.action, status: 'succeeded', outboxId: queued.record.id, result: result.data ?? {} } });
      await this.audit({ actorId: input.input.adminId, action: `workspace.${input.confirmation.action}.completed`, targetRef: input.confirmation.id, requestId: input.requestId, traceId: input.traceId, payload: { action: input.confirmation.action, outboxId: queued.record.id, result: result.data ?? {} }, accountId: input.bundle.run.accountId });
      const latest = await this.store.getAutoReplyOutbox(input.scope, queued.record.idempotencyKey);
      const latestBundle = await this.store.getRun(input.input.adminId, input.input.runId);
      if (!updatedRun || !latest) throw new ServiceError(500, 'WORKSPACE_STORE_ERROR', 'workspace command result readback failed');
      return { run: this.toRunView(updatedRun, latestBundle?.steps ?? input.bundle.steps), confirmation: this.toConfirmationView(input.confirmation), outbox: this.toOutboxView(latest, input.bundle.run.id) };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      await this.store.updateRun(input.bundle.run.id, { status: 'failed', finishedAt, errorCode: error instanceof ServiceError ? error.code : 'WORKSPACE_COMMAND_FAILED', resultSummary: 'Workspace 动作执行失败，请查看错误并重试' });
      await this.store.updateRunStep(input.step.id, { status: 'failed', finishedAt, errorCode: error instanceof ServiceError ? error.code : 'WORKSPACE_COMMAND_FAILED', outputSummary: 'Workspace 动作执行失败' });
      throw error;
    }
  }

  private async confirmCouponCreate(input: { input: { adminId: string; runId: string; requestId: string; traceId: string }; bundle: { run: RunRecord; steps: StepRecord[] }; step: StepRecord; confirmation: WorkspaceConfirmationRecord; scope: string; run: RunRecord; requestId: string; traceId: string }): Promise<{ run: WorkspaceRunView; confirmation: WorkspaceConfirmationView; outbox: WorkspaceOutboxView }> {
    if (!this.coupons) throw new ServiceError(500, 'WORKSPACE_STORE_ERROR', 'coupon service unavailable');
    const execution = input.confirmation.executionPlan;
    const label = typeof execution.label === 'string' ? execution.label : '';
    const purpose = typeof execution.purpose === 'string' ? execution.purpose as 'text' | 'data' | 'api' | 'image' : undefined;
    const metadata = execution.metadata && typeof execution.metadata === 'object' && !Array.isArray(execution.metadata) ? execution.metadata as never : undefined;
    const items = Array.isArray(execution.items) ? execution.items.filter((item): item is string => typeof item === 'string') : [];
    if (!label || !purpose || !metadata) throw new ServiceError(422, 'VALIDATION_FAILED', '新增卡券执行计划缺少结构化参数');
    try {
      const created = await this.coupons.create({ adminId: input.input.adminId, accountId: input.bundle.run.accountId, label, purpose, metadata, requestId: input.requestId, traceId: input.traceId });
      if (items.length > 0) {
        await this.coupons.importItems({ adminId: input.input.adminId, batchId: String((created as Record<string, unknown>).batchId ?? ''), contents: items, requestId: input.requestId, traceId: input.traceId });
      }
      const batchId = String((created as Record<string, unknown>).batchId ?? '');
      const queued = await this.store.enqueueAutoReplyOutbox({ scope: input.scope, aggregateType: 'workspace_run', aggregateId: input.bundle.run.id, operation: 'coupon_create', idempotencyKey: `workspace-confirm:${input.confirmation.id}`, payload: { ...input.confirmation.manifest, batchId }, traceId: input.traceId });
      const workerId = `workspace-local-coupon:${input.bundle.run.id}`;
      const claimed = await this.store.claimAutoReplyOutbox({ scope: input.scope, workerId, limit: 1, leaseMs: 60_000, id: queued.record.id });
      if (!claimed[0] || !(await this.store.completeAutoReplyOutbox({ id: queued.record.id, workerId, externalOutcome: 'known_success', externalMessageRef: batchId }))) throw new ServiceError(500, 'WORKSPACE_STORE_ERROR', 'coupon outbox completion failed');
      const finishedAt = new Date().toISOString();
      const updatedRun = await this.store.updateRun(input.bundle.run.id, { status: 'succeeded', finishedAt, resultSummary: `卡券“${label}”已创建` });
      await this.store.updateRunStep(input.step.id, { status: 'succeeded', finishedAt, outputSummary: `卡券批次已创建（${purpose}）` });
      await this.store.appendWorkspaceMessage({ adminId: input.input.adminId, sessionId: input.bundle.run.sessionId, runId: input.bundle.run.id, type: 'final_answer', content: `卡券“${label}”已创建，类型：${purpose}。`, summary: `卡券已创建：${label}` });
      await this.store.appendRunEvent({ runId: input.input.runId, eventType: 'workspace.coupon.created', payload: { status: 'succeeded', batchId, label, purpose, itemCount: items.length, redacted: true } });
      await this.store.appendRunEvent({ runId: input.input.runId, eventType: 'workspace.outbox.completed', payload: { outboxId: queued.record.id, status: 'succeeded', operation: 'coupon_create', externalOutcome: 'known_success' } });
      await this.audit({ actorId: input.input.adminId, action: 'workspace.coupon.created', targetRef: batchId, requestId: input.requestId, traceId: input.traceId, payload: { purpose, itemCount: items.length, redacted: true }, accountId: input.bundle.run.accountId });
      const latest = await this.store.getAutoReplyOutbox(input.scope, queued.record.idempotencyKey);
      if (!updatedRun || !latest) throw new ServiceError(500, 'WORKSPACE_STORE_ERROR', 'coupon result readback failed');
      const latestBundle = await this.store.getRun(input.input.adminId, input.input.runId);
      return { run: this.toRunView(updatedRun, latestBundle?.steps ?? input.bundle.steps), confirmation: this.toConfirmationView(input.confirmation), outbox: this.toOutboxView(latest, input.bundle.run.id) };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      await this.store.updateRun(input.bundle.run.id, { status: 'failed', finishedAt, errorCode: error instanceof ServiceError ? error.code : 'COUPON_CREATE_FAILED', resultSummary: '卡券创建失败，需要人工检查' });
      await this.store.updateRunStep(input.step.id, { status: 'failed', finishedAt, errorCode: error instanceof ServiceError ? error.code : 'COUPON_CREATE_FAILED', outputSummary: '卡券创建失败，需要人工检查' });
      throw error;
    }
  }

  private async confirmAgentSettingsUpdate(input: { input: { adminId: string; runId: string; requestId: string; traceId: string }; bundle: { run: RunRecord; steps: StepRecord[] }; step: StepRecord; confirmation: WorkspaceConfirmationRecord; scope: string; run: RunRecord; requestId: string; traceId: string }): Promise<{ run: WorkspaceRunView; confirmation: WorkspaceConfirmationView; outbox: WorkspaceOutboxView }> {
    if (!this.agentSettings) throw new ServiceError(500, 'WORKSPACE_STORE_ERROR', 'agent settings service unavailable');
    const execution = input.confirmation.executionPlan;
    const patch = execution.patch && typeof execution.patch === 'object' && !Array.isArray(execution.patch) ? execution.patch as never : undefined;
    if (!patch) throw new ServiceError(422, 'VALIDATION_FAILED', 'Agent 配置执行计划缺少结构化参数');
    try {
      const expectedVersion = Number(execution.expectedVersion ?? input.confirmation.manifest.expectedVersion ?? 0);
      const updated = await this.agentSettings.update({ adminId: input.input.adminId, accountId: input.bundle.run.accountId, expectedVersion, patch, requestId: input.requestId, traceId: input.traceId });
      const queued = await this.store.enqueueAutoReplyOutbox({ scope: input.scope, aggregateType: 'workspace_run', aggregateId: input.bundle.run.id, operation: 'agent_settings_update', idempotencyKey: `workspace-confirm:${input.confirmation.id}`, payload: { ...input.confirmation.manifest, configVersion: updated.configVersion }, traceId: input.traceId });
      const workerId = `workspace-local-agent-settings:${input.bundle.run.id}`;
      const claimed = await this.store.claimAutoReplyOutbox({ scope: input.scope, workerId, limit: 1, leaseMs: 60_000, id: queued.record.id });
      if (!claimed[0] || !(await this.store.completeAutoReplyOutbox({ id: queued.record.id, workerId, externalOutcome: 'known_success', externalMessageRef: `${input.bundle.run.accountId}:v${updated.configVersion}` }))) throw new ServiceError(500, 'WORKSPACE_STORE_ERROR', 'agent settings outbox completion failed');
      const finishedAt = new Date().toISOString();
      const updatedRun = await this.store.updateRun(input.bundle.run.id, { status: 'succeeded', finishedAt, resultSummary: `自动回复 Agent 配置已更新（v${updated.configVersion}）` });
      await this.store.updateRunStep(input.step.id, { status: 'succeeded', finishedAt, outputSummary: `自动回复 Agent 配置已更新（v${updated.configVersion}）` });
      await this.store.appendWorkspaceMessage({ adminId: input.input.adminId, sessionId: input.bundle.run.sessionId, runId: input.bundle.run.id, type: 'final_answer', content: `自动回复 Agent 配置已更新，当前版本 v${updated.configVersion}。Prompt 原文不会显示在 Workspace。`, summary: '自动回复 Agent 配置已更新' });
      await this.store.appendRunEvent({ runId: input.input.runId, eventType: 'workspace.agent_settings.updated', payload: { status: 'succeeded', configVersion: updated.configVersion, changedFields: Object.keys(patch), redacted: true } });
      await this.store.appendRunEvent({ runId: input.input.runId, eventType: 'workspace.outbox.completed', payload: { outboxId: queued.record.id, status: 'succeeded', operation: 'agent_settings_update', externalOutcome: 'known_success' } });
      await this.audit({ actorId: input.input.adminId, action: 'workspace.agent_settings.updated', targetRef: `${input.bundle.run.accountId}:v${updated.configVersion}`, requestId: input.requestId, traceId: input.traceId, payload: { configVersion: updated.configVersion, changedFields: Object.keys(patch), redacted: true }, accountId: input.bundle.run.accountId });
      const latest = await this.store.getAutoReplyOutbox(input.scope, queued.record.idempotencyKey);
      if (!updatedRun || !latest) throw new ServiceError(500, 'WORKSPACE_STORE_ERROR', 'agent settings result readback failed');
      const latestBundle = await this.store.getRun(input.input.adminId, input.input.runId);
      return { run: this.toRunView(updatedRun, latestBundle?.steps ?? input.bundle.steps), confirmation: this.toConfirmationView(input.confirmation), outbox: this.toOutboxView(latest, input.bundle.run.id) };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      await this.store.updateRun(input.bundle.run.id, { status: 'failed', finishedAt, errorCode: error instanceof ServiceError ? error.code : 'AGENT_SETTINGS_UPDATE_FAILED', resultSummary: '自动回复 Agent 配置更新失败，需要人工检查' });
      await this.store.updateRunStep(input.step.id, { status: 'failed', finishedAt, errorCode: error instanceof ServiceError ? error.code : 'AGENT_SETTINGS_UPDATE_FAILED', outputSummary: '自动回复 Agent 配置更新失败，需要人工检查' });
      throw error;
    }
  }

  async cancelRun(input: { adminId: string; runId: string; expectedVersion: number; requestId: string; traceId: string }): Promise<{ run: WorkspaceRunView; confirmation: WorkspaceConfirmationView }> {
    const bundle = await this.store.getRun(input.adminId, input.runId);
    if (!bundle) throw new ServiceError(404, 'NOT_FOUND', 'run not found');
    if (bundle.run.status !== 'waiting_confirmation') throw new ServiceError(409, 'CONFLICT', 'run is not waiting for confirmation');
    const current = await this.store.getWorkspaceConfirmation(input.adminId, input.runId);
    if (!current) throw new ServiceError(404, 'NOT_FOUND', 'confirmation not found');
    const confirmation = await this.store.transitionWorkspaceConfirmation({ adminId: input.adminId, confirmationId: current.id, expectedVersion: input.expectedVersion, status: 'cancelled', actorId: input.adminId });
    if (!confirmation) throw new ServiceError(409, 'VERSION_CONFLICT', 'confirmation version changed; refresh and retry');
    const step = bundle.steps.find((item) => item.id === confirmation.stepId);
    if (!step) throw new ServiceError(409, 'CONFLICT', 'confirmation step not found');
    const run = await this.store.updateRun(input.runId, { status: 'cancelled', resultSummary: '管理员已取消外部动作', finishedAt: new Date().toISOString() });
    await this.store.updateRunStep(step.id, { status: 'cancelled', finishedAt: new Date().toISOString(), outputSummary: '管理员取消确认' });
    await this.store.appendRunEvent({ runId: input.runId, eventType: 'workspace.confirmation.cancelled', payload: { confirmationId: confirmation.id, status: 'cancelled', version: confirmation.version } });
    await this.audit({ actorId: input.adminId, action: 'workspace.confirmation.cancelled', targetRef: confirmation.id, requestId: input.requestId, traceId: input.traceId, payload: {}, accountId: bundle.run.accountId });
    if (!run) throw new ServiceError(500, 'WORKSPACE_STORE_ERROR', 'run update failed');
    return { run: this.toRunView(run, (await this.store.getRun(input.adminId, input.runId))?.steps ?? bundle.steps), confirmation: this.toConfirmationView(confirmation) };
  }

  async listOutbox(input: { adminId: string; runId: string }): Promise<WorkspaceOutboxView[]> {
    const bundle = await this.store.getRun(input.adminId, input.runId);
    if (!bundle) throw new ServiceError(404, 'NOT_FOUND', 'run not found');
    const scope = this.executionScope(input.adminId, bundle.run.accountId);
    const items = await this.store.listAutoReplyOutboxByAggregate(scope, bundle.run.id);
    return items.map((item) => this.toOutboxView(item, bundle.run.id));
  }

  async retryRun(input: { adminId: string; runId: string; requestId: string; traceId: string }): Promise<{ run: WorkspaceRunView; outbox: WorkspaceOutboxView }> {
    const bundle = await this.store.getRun(input.adminId, input.runId);
    if (!bundle) throw new ServiceError(404, 'NOT_FOUND', 'run not found');
    const scope = this.executionScope(input.adminId, bundle.run.accountId);
    const items = await this.store.listAutoReplyOutboxByAggregate(scope, bundle.run.id);
    const latest = items.at(-1);
    if (!latest) throw new ServiceError(409, 'CONFLICT', '没有可重试的 Outbox 作业');
    if (latest.externalOutcome === 'unknown') throw new ServiceError(409, 'OUTBOX_UNKNOWN_REQUIRES_RECOVERY', '外部结果未知，只能先查询或人工恢复');
    if (!['retryable', 'dead_lettered'].includes(latest.status)) throw new ServiceError(409, 'CONFLICT', '当前 Outbox 状态不可重试', { status: latest.status });
    const requeued = await this.store.requeueExecutionOutbox({ scope, id: latest.id });
    if (!requeued) throw new ServiceError(409, 'CONFLICT', 'Outbox 状态已变化，请刷新后重试');
    await this.store.updateRun(bundle.run.id, { status: 'retrying', resultSummary: 'Outbox 已重新入队，等待执行 Worker' });
    await this.store.appendRunEvent({ runId: bundle.run.id, eventType: 'workspace.outbox.requeued', payload: { outboxId: requeued.id, status: requeued.status } });
    await this.audit({ actorId: input.adminId, action: 'workspace.outbox.requeued', targetRef: requeued.id, requestId: input.requestId, traceId: input.traceId, payload: {}, accountId: bundle.run.accountId });
    const latestRun = await this.store.getRun(input.adminId, bundle.run.id);
    if (!latestRun) throw new ServiceError(500, 'WORKSPACE_STORE_ERROR', 'run reload failed');
    return { run: this.toRunView(latestRun.run, latestRun.steps), outbox: this.toOutboxView(requeued, bundle.run.id) };
  }

  async reconnectRun(input: { adminId: string; runId: string; requestId: string; traceId: string }): Promise<WorkspaceRunView> {
    const bundle = await this.store.getRun(input.adminId, input.runId);
    if (!bundle) throw new ServiceError(404, 'NOT_FOUND', 'run not found');
    await this.runtime.resume({ run: bundle.run, steps: bundle.steps, adminId: input.adminId, sessionId: bundle.run.sessionId });
    await this.audit({ actorId: input.adminId, action: 'workspace.run.reconnected', targetRef: input.runId, requestId: input.requestId, traceId: input.traceId, payload: { previousStatus: bundle.run.status }, accountId: bundle.run.accountId });
    const latest = await this.store.getRun(input.adminId, input.runId);
    if (!latest) throw new ServiceError(500, 'WORKSPACE_STORE_ERROR', 'run reload failed');
    return this.toRunView(latest.run, latest.steps);
  }

  private async appendMessage(input: { adminId: string; sessionId: string; runId?: string; type: 'user_message' | 'reasoning_summary' | 'tool_event' | 'final_answer'; content: string; summary?: string }): Promise<void> {
    const message = await this.store.appendWorkspaceMessage(input);
    if (input.runId) await this.store.appendRunEvent({ runId: input.runId, eventType: 'message.appended', payload: { messageType: message.type, messageId: message.id, content: message.content, summary: message.summary, createdAt: message.createdAt } });
  }

  private toSessionView(session: AgentSessionRecord): WorkspaceSessionView { return { ...session }; }

  private executionScope(adminId: string, accountId: string): string { return `workspace:${adminId}:${accountId}`; }

  private toConfirmationView(confirmation: WorkspaceConfirmationRecord): WorkspaceConfirmationView { return { confirmationId: confirmation.id, runId: confirmation.runId, stepId: confirmation.stepId, accountId: confirmation.accountId, action: confirmation.action, policyRef: confirmation.policyRef, manifest: { ...confirmation.manifest }, status: confirmation.status, version: confirmation.version, expiresAt: confirmation.expiresAt, confirmedAt: confirmation.confirmedAt, confirmedBy: confirmation.confirmedBy, cancelledAt: confirmation.cancelledAt, createdAt: confirmation.createdAt, updatedAt: confirmation.updatedAt }; }

  private toOutboxView(outbox: AutoReplyOutboxRecord, runId: string): WorkspaceOutboxView { return { outboxId: outbox.id, runId, scope: outbox.scope, operation: outbox.operation, status: outbox.status, attempt: outbox.attempt, availableAt: outbox.availableAt, externalOutcome: outbox.externalOutcome, lastErrorCode: outbox.lastErrorCode, idempotencyKey: outbox.idempotencyKey, createdAt: outbox.createdAt, updatedAt: outbox.updatedAt }; }

  private toRunView(run: RunRecord, steps: StepRecord[]): WorkspaceRunView {
    const mappedSteps = steps.map((step) => ({ stepId: step.id, runId: step.runId, sequence: step.stepNo, kind: step.kind, label: step.label, status: step.status, startedAt: step.startedAt, finishedAt: step.finishedAt, inputSummary: step.inputSummary, outputSummary: step.outputSummary, affectedEntityRefs: [], errorCode: step.errorCode }));
    const current = mappedSteps.find((step) => ['running', 'executing', 'waiting_confirmation', 'retrying'].includes(step.status));
    return { runId: run.id, sessionId: run.sessionId, accountId: run.accountId, status: run.status, instructionSummary: sanitizeWorkspaceInstruction(run.instruction), createdAt: run.createdAt, updatedAt: run.updatedAt, startedAt: run.startedAt, finishedAt: run.finishedAt, currentStepId: current?.stepId, steps: mappedSteps, resultSummary: run.resultSummary, errorCode: run.errorCode, clientRunRef: run.clientRunRef };
  }
}

function mapWorkspaceStoreError(error: unknown): ServiceError {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'ACCOUNT_SCOPE_FORBIDDEN') return new ServiceError(403, 'FORBIDDEN', 'account scope required');
  if (code === 'SESSION_NOT_FOUND') return new ServiceError(404, 'NOT_FOUND', 'agent session not found');
  if (code === 'SESSION_ARCHIVED') return new ServiceError(409, 'CONFLICT', 'archived session is read-only');
  if (code === 'SESSION_HAS_ACTIVE_RUN') return new ServiceError(409, 'CONFLICT', 'session has an active run');
  return error instanceof ServiceError ? error : new ServiceError(500, 'WORKSPACE_STORE_ERROR', 'workspace persistence failed');
}

export function isTerminalRunStatus(status: RunStatus): boolean { return terminalRunStatuses.has(status); }
