export type WorkspacePlanFactKey = string;

export type WorkspacePlanFacts = Record<string, unknown>;

export type WorkspacePlanConfirmationPolicy = 'none' | 'required';

export interface WorkspacePlanStepContract {
  action: string;
  requiresFacts: WorkspacePlanFactKey[];
  producesFacts: WorkspacePlanFactKey[];
  confirmationPolicy: WorkspacePlanConfirmationPolicy;
  argPredicateId: string;
}

export interface WorkspacePlanStepLike {
  tool: string;
  goal: string;
  action?: string;
  requiresFacts?: WorkspacePlanFactKey[];
  producesFacts?: WorkspacePlanFactKey[];
  confirmationPolicy?: WorkspacePlanConfirmationPolicy;
  argPredicateId?: string;
}

export interface WorkspacePlanValidationResult {
  ok: boolean;
  code?: string;
  summary?: string;
}

export interface WorkspacePlanGoalStatus {
  predicateId?: string;
  complete: boolean;
  missing: string[];
}

export interface WorkspacePlanPolicyContext {
  predicateId?: string;
  status: string;
  currentStepId?: string;
  steps: Array<{ id: string; tool: string; goal: string; status: string }>;
}

/**
 * Optional extension point for deployments that need extra task-specific
 * verification. The default runtime does not install a policy and therefore
 * remains model-driven rather than embedding a business example.
 */
export interface WorkspacePlanPolicy {
  key: string;
  version: number;
  selectPlan?: (instruction: string, availableTools: string[]) => WorkspacePlanStepLike[] | undefined;
  validateCall?: (
    step: WorkspacePlanStepLike,
    toolName: string,
    args: Record<string, unknown>,
    facts: WorkspacePlanFacts,
  ) => WorkspacePlanValidationResult | undefined;
  goalStatus?: (context: WorkspacePlanPolicyContext, facts: WorkspacePlanFacts | undefined) => WorkspacePlanGoalStatus | undefined;
}

const SUPPORTED_TOOLS = new Set([
  'pi_skill_list',
  'pi_skill_catalog',
  'pi_skill_read',
  'pi_skill_search',
  'pi_skill_exec',
  'workspace_product_search',
  'workspace_read',
  'workspace_prepare_write',
]);

const SUPPORTED_ACTIONS = new Map<string, Set<string>>([
  ['pi_skill_list', new Set(['list'])],
  ['pi_skill_catalog', new Set(['catalog'])],
  ['pi_skill_read', new Set(['read'])],
  ['pi_skill_search', new Set(['search', 'search-docs'])],
  ['pi_skill_exec', new Set(['exec', 'search', 'share', 'read', 'write'])],
  ['workspace_product_search', new Set(['product_search'])],
  ['workspace_read', new Set(['read', 'readback'])],
  ['workspace_prepare_write', new Set([
    'write',
    'product_publish',
    'product_update',
    'product_automation_update',
    'product_knowledge_update',
    'coupon_create',
    'coupon_update',
    'coupon_enable',
    'coupon_disable',
    'coupon_bind',
    'coupon_unbind',
    'coupon_void',
    'coupon_copy',
    'agent_settings_update',
    'model_settings_update',
    'order_deliver',
    'order_retry',
    'order_cancel',
  ])],
]);

export function contractForWorkspaceStep(step: WorkspacePlanStepLike): WorkspacePlanStepContract {
  const action = step.action ?? inferWorkspaceStepAction(step.tool, step.goal);
  const actions = SUPPORTED_ACTIONS.get(step.tool);
  const defaultConfirmation = step.tool === 'workspace_prepare_write' ? 'required' : 'none';
  const base = {
    action,
    requiresFacts: step.requiresFacts ?? [],
    producesFacts: step.producesFacts ?? [],
    confirmationPolicy: step.confirmationPolicy ?? defaultConfirmation,
    argPredicateId: step.argPredicateId ?? `${step.tool}:default`,
  } satisfies WorkspacePlanStepContract;
  if (!SUPPORTED_TOOLS.has(step.tool) || action === 'unknown' || !actions?.has(action)) {
    return { ...base, argPredicateId: 'CONTRACT_MISSING' };
  }
  return base;
}

export function inferWorkspaceStepAction(tool: string, goal: string): string {
  const text = `${tool} ${goal}`.toLowerCase();
  if (tool === 'pi_skill_list') return 'list';
  if (tool === 'pi_skill_catalog') return 'catalog';
  if (tool === 'pi_skill_read') return 'read';
  if (tool === 'pi_skill_search') return /文档|搜索|search|查找/u.test(text) ? 'search-docs' : 'search';
  if (tool === 'pi_skill_exec') return /分享|share/u.test(text) ? 'share' : /搜索|查找|定位|search/u.test(text) ? 'search' : 'exec';
  if (tool === 'workspace_product_search') return 'product_search';
  if (tool === 'workspace_prepare_write') return 'write';
  if (tool === 'workspace_read') return /复读|readback|读取|状态|配置|read/u.test(text) ? 'read' : 'unknown';
  return 'unknown';
}

export function validateWorkspacePlanCall(
  step: WorkspacePlanStepLike,
  toolName: string,
  args: Record<string, unknown>,
  facts: WorkspacePlanFacts,
  policy?: WorkspacePlanPolicy,
): WorkspacePlanValidationResult {
  const contract = contractForWorkspaceStep(step);
  if (step.tool !== toolName) {
    return { ok: false, code: 'PLAN_STEP_MISMATCH', summary: `Plan Mode 当前步骤要求调用 ${step.tool}，本轮收到 ${toolName}；请按计划顺序继续` };
  }
  if (contract.argPredicateId === 'CONTRACT_MISSING') {
    return { ok: false, code: 'PLAN_CONTRACT_ERROR', summary: `没有为 ${toolName} 当前动作注册确定的输入输出契约` };
  }
  for (const key of contract.requiresFacts) {
    if (!hasFact(facts, key)) return { ok: false, code: 'PLAN_FACT_MISSING', summary: `当前步骤 ${contract.action} 缺少前置事实 ${key}` };
  }
  const policyResult = policy?.validateCall?.(step, toolName, args, facts);
  if (policyResult && !policyResult.ok) return policyResult;
  return { ok: true };
}

/** Extract only facts explicitly returned by a generic tool contract. */
export function extractWorkspacePlanFacts(_toolName: string, _args: Record<string, unknown>, result: unknown): WorkspacePlanFacts {
  const record = asRecord(result);
  const data = asRecord(record?.data);
  const facts = asRecord(record?.facts) ?? asRecord(data?.facts) ?? asRecord(data?.planFacts);
  return facts ? { ...facts } : {};
}

export function extractWorkspacePlanFactsFromEvent(eventType: string, payload: Record<string, unknown>): WorkspacePlanFacts {
  if (eventType !== 'tool.result' && eventType !== 'workspace.command.completed' && eventType !== 'workspace.coupon.created') return {};
  const result = asRecord(payload.result) ?? payload;
  return extractWorkspacePlanFacts(typeof payload.toolName === 'string' ? payload.toolName : '', asRecord(payload.args) ?? {}, result);
}

export function mergeWorkspacePlanFacts(base: WorkspacePlanFacts | undefined, patch: WorkspacePlanFacts): WorkspacePlanFacts {
  return { ...(base ?? {}), ...patch };
}

export function workspacePlanGoalStatus(
  predicateId: string | undefined,
  facts: WorkspacePlanFacts | undefined,
  policy?: WorkspacePlanPolicy,
  context?: WorkspacePlanPolicyContext,
): WorkspacePlanGoalStatus {
  if (!predicateId) return { complete: true, missing: [] };
  const result = policy?.goalStatus?.(context ?? { predicateId, status: 'unknown', steps: [] }, facts);
  return result ?? { predicateId, complete: false, missing: ['plan_policy'] };
}

export function planStepRequiresConfirmation(step: WorkspacePlanStepLike): boolean {
  return contractForWorkspaceStep(step).confirmationPolicy === 'required';
}

function hasFact(facts: WorkspacePlanFacts, key: string): boolean {
  const value = facts[key];
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
