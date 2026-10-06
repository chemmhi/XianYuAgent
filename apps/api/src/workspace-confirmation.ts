import type { RunRecord, StepRecord, Store, WorkspaceConfirmationRecord } from './domain.js';
import type { NativeWorkspaceWritePlan } from './workspace-native-write.js';

export async function persistWorkspaceConfirmation(input: { store: Store; adminId: string; sessionId: string; run: RunRecord; step: StepRecord; plan: NativeWorkspaceWritePlan }): Promise<WorkspaceConfirmationRecord> {
  const confirmation = await input.store.createWorkspaceConfirmation({
    adminId: input.adminId,
    runId: input.run.id,
    stepId: input.step.id,
    accountId: input.run.accountId,
    requestedBy: input.run.requestedBy,
    action: input.plan.action,
    policyRef: input.plan.policyRef,
    manifest: input.plan.manifest,
    executionPlan: input.plan.executionPlan,
    expiresAt: input.plan.expiresAt,
  });
  const message = await input.store.appendWorkspaceMessage({ adminId: input.adminId, sessionId: input.sessionId, runId: input.run.id, type: 'tool_event', content: input.plan.content, summary: input.plan.summary });
  await input.store.appendRunEvent({ runId: input.run.id, eventType: 'message.appended', payload: { messageType: message.type, messageId: message.id, content: message.content, summary: message.summary, createdAt: message.createdAt } });
  return confirmation;
}
