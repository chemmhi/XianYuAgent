import type { WorkspacePlanVM, WorkspaceRunEventVM } from './types';

const planEventTypes = new Set(['workspace.plan.created', 'workspace.plan.updated']);
const planStatuses = new Set<string>(['active', 'waiting_confirmation', 'blocked', 'completed']);
const stepStatuses = new Set<string>(['pending', 'running', 'succeeded', 'waiting_confirmation', 'blocked']);

export function extractLatestWorkspacePlan(events: WorkspaceRunEventVM[], runId?: string): WorkspacePlanVM | undefined {
  const candidates = events
    .filter((event) => planEventTypes.has(event.eventType) && (!runId || event.runId === runId))
    .sort((left, right) => left.sequence - right.sequence);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const plan = parseWorkspacePlan(candidates[index].payload);
    if (plan) return plan;
  }
  return undefined;
}

export function parseWorkspacePlan(payload: Record<string, unknown>): WorkspacePlanVM | undefined {
  const candidate = payload.plan;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const raw = candidate as Record<string, unknown>;
  const rawStatus = raw.status;
  const status = typeof rawStatus === 'string' && planStatuses.has(rawStatus) ? rawStatus as WorkspacePlanVM['status'] : undefined;
  if (!status || typeof raw.goal !== 'string' || !Array.isArray(raw.steps)) return undefined;
  const steps = raw.steps.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const step = value as Record<string, unknown>;
    const rawStepStatus = step.status;
    const stepStatus = typeof rawStepStatus === 'string' && stepStatuses.has(rawStepStatus) ? rawStepStatus as WorkspacePlanVM['steps'][number]['status'] : undefined;
    if (!stepStatus || typeof step.id !== 'string' || typeof step.tool !== 'string' || typeof step.goal !== 'string') return [];
    return [{
      id: step.id,
      tool: step.tool,
      goal: step.goal,
      status: stepStatus,
      ...(typeof step.evidence === 'string' && step.evidence.trim() ? { evidence: step.evidence.trim() } : {}),
    }];
  });
  if (!steps.length) return undefined;
  return {
    version: typeof raw.version === 'number' ? Math.max(1, Math.trunc(raw.version)) : 1,
    revision: typeof raw.revision === 'number' ? Math.max(1, Math.trunc(raw.revision)) : 1,
    goal: raw.goal,
    status,
    ...(typeof raw.currentStepId === 'string' ? { currentStepId: raw.currentStepId } : {}),
    steps,
  };
}
