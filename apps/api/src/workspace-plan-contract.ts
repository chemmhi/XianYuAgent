export type WorkspacePlanFactKey = string;
export type WorkspacePlanFacts = Record<string, unknown>;
export type WorkspacePlanConfirmationPolicy = 'none' | 'required';
export type WorkspacePlanValueType = 'string' | 'number' | 'boolean' | 'array' | 'object';
export type WorkspacePlanPath = 'args' | `args.${string}` | 'result.data' | `result.data.${string}` | 'result.data.parsed' | `result.data.parsed.${string}` | 'event.payload' | `event.payload.${string}`;

export interface WorkspacePlanJsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, WorkspacePlanJsonSchema>;
  items?: WorkspacePlanJsonSchema;
  required?: string[];
  enum?: Array<string | number | boolean | null>;
  additionalProperties?: boolean | WorkspacePlanJsonSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

export interface WorkspacePlanOutputFact {
  key: string;
  paths: WorkspacePlanPath[];
  valueType: WorkspacePlanValueType;
  requiredOnSuccess: boolean;
  merge: 'overwrite' | 'preserve';
  source: 'tool_result' | 'confirmation_event' | 'either';
  condition?: { path: WorkspacePlanPath; arrayLengthEquals?: number; equals?: string | number | boolean | null };
  onConditionFalse?: 'skip' | 'fail';
}

export interface WorkspacePlanInputBinding {
  fact: string;
  paths: Array<`args.${string}`>;
  valueType: WorkspacePlanValueType;
  required: boolean;
  merge: 'overwrite' | 'preserve';
}

export interface WorkspacePlanToolVariant {
  sideEffect: 'read' | 'prepare_write' | 'external_write';
  confirmationPolicy: WorkspacePlanConfirmationPolicy;
  replay: 'reusable' | 'non_reusable';
  inputFacts: string[];
  inputBindings: WorkspacePlanInputBinding[];
  outputFacts: WorkspacePlanOutputFact[];
  argumentSchema: WorkspacePlanJsonSchema;
}

export interface WorkspaceToolPlanMetadata {
  contractVersion: number;
  discriminator?: { field: string; variants: Record<string, WorkspacePlanToolVariant> };
  default?: WorkspacePlanToolVariant;
}

export interface WorkspacePlanStepContract {
  variant: string;
  contractVersion: number;
  sideEffect: WorkspacePlanToolVariant['sideEffect'];
  action: string;
  requiresFacts: WorkspacePlanFactKey[];
  producesFacts: WorkspacePlanFactKey[];
  confirmationPolicy: WorkspacePlanConfirmationPolicy;
  replay: WorkspacePlanToolVariant['replay'];
  inputBindings: WorkspacePlanInputBinding[];
  outputFacts: WorkspacePlanOutputFact[];
  argumentSchema: WorkspacePlanJsonSchema;
}

export interface WorkspacePlanStepLike {
  tool: string;
  goal: string;
  variant?: string;
  contractVersion?: number;
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

export interface WorkspacePlanPolicy {
  key: string;
  version: number;
  selectPlan?: (instruction: string, availableTools: string[]) => WorkspacePlanStepLike[] | undefined;
  validateCall?: (step: WorkspacePlanStepLike, toolName: string, args: Record<string, unknown>, facts: WorkspacePlanFacts) => WorkspacePlanValidationResult | undefined;
  goalStatus?: (context: WorkspacePlanPolicyContext, facts: WorkspacePlanFacts | undefined) => WorkspacePlanGoalStatus | undefined;
}

export const PLAN_ERROR_CODES = [
  'PLAN_NOT_REQUIRED',
  'PLAN_UNAVAILABLE',
  'PLAN_CONTRACT_MISSING',
  'PLAN_CONTRACT_UNAVAILABLE',
  'PLAN_ARGUMENT_INVALID',
  'PLAN_STEP_MISMATCH',
  'PLAN_FACT_MISSING',
  'PLAN_OUTPUT_FACT_MISSING',
  'PLAN_NOT_COMPLETE',
] as const;

export function resolveWorkspaceToolPlanVariant(metadata: WorkspaceToolPlanMetadata | undefined, requestedVariant = 'default'): WorkspacePlanToolVariant | undefined {
  if (!metadata || metadata.contractVersion !== 1) return undefined;
  if (metadata.discriminator) return metadata.discriminator.variants[requestedVariant];
  return requestedVariant === 'default' ? metadata.default : undefined;
}

export function contractForWorkspaceStep(step: WorkspacePlanStepLike, metadata?: WorkspaceToolPlanMetadata): WorkspacePlanStepContract {
  const variant = step.variant ?? (metadata?.discriminator ? '' : 'default');
  const selected = resolveWorkspaceToolPlanVariant(metadata, variant || 'default');
  if (!selected || !metadata) {
    return {
      variant: variant || 'unknown',
      contractVersion: step.contractVersion ?? 0,
      sideEffect: 'read',
      action: step.action ?? (variant || 'unknown'),
      requiresFacts: step.requiresFacts ?? [],
      producesFacts: step.producesFacts ?? [],
      confirmationPolicy: step.confirmationPolicy ?? 'none',
      replay: 'non_reusable',
      inputBindings: [],
      outputFacts: [],
      argumentSchema: { type: 'object', additionalProperties: false },
    };
  }
  if (step.contractVersion !== undefined && step.contractVersion !== metadata.contractVersion) return { variant, contractVersion: metadata.contractVersion, sideEffect: selected.sideEffect, action: step.action ?? variant, requiresFacts: selected.inputFacts, producesFacts: selected.outputFacts.map((fact) => fact.key), confirmationPolicy: selected.confirmationPolicy, replay: selected.replay, inputBindings: selected.inputBindings, outputFacts: selected.outputFacts, argumentSchema: selected.argumentSchema };
  return {
    variant: variant || 'default',
    contractVersion: metadata.contractVersion,
    sideEffect: selected.sideEffect,
    action: step.action ?? (variant || 'default'),
    requiresFacts: selected.inputFacts,
    producesFacts: selected.outputFacts.map((fact) => fact.key),
    confirmationPolicy: selected.confirmationPolicy,
    replay: selected.replay,
    inputBindings: selected.inputBindings,
    outputFacts: selected.outputFacts,
    argumentSchema: selected.argumentSchema,
  };
}

export function validateWorkspacePlanCall(
  step: WorkspacePlanStepLike,
  toolName: string,
  args: Record<string, unknown>,
  facts: WorkspacePlanFacts,
  policy?: WorkspacePlanPolicy,
  metadata?: WorkspaceToolPlanMetadata,
): WorkspacePlanValidationResult {
  if (step.tool !== toolName) return { ok: false, code: 'PLAN_STEP_MISMATCH', summary: `Plan Mode 当前步骤要求调用 ${step.tool}，本轮收到 ${toolName}；请按计划顺序继续` };
  const contract = contractForWorkspaceStep(step, metadata);
  if (!metadata || contract.contractVersion <= 0 || !resolveWorkspaceToolPlanVariant(metadata, contract.variant)) return { ok: false, code: 'PLAN_CONTRACT_UNAVAILABLE', summary: `没有为 ${toolName}/${contract.variant} 注册可用的 Plan 契约` };
  if (step.contractVersion !== undefined && step.contractVersion !== contract.contractVersion) return { ok: false, code: 'PLAN_CONTRACT_UNAVAILABLE', summary: `Plan 契约版本不匹配：${step.contractVersion} != ${contract.contractVersion}` };
  const schemaResult = validateWorkspacePlanJsonSchema(contract.argumentSchema, args, 'args');
  if (!schemaResult.ok) return { ok: false, code: 'PLAN_ARGUMENT_INVALID', summary: schemaResult.summary };
  for (const key of contract.requiresFacts) if (!hasFact(facts, key)) return { ok: false, code: 'PLAN_FACT_MISSING', summary: `当前步骤 ${contract.variant} 缺少前置事实 ${key}` };
  for (const binding of contract.inputBindings) {
    const values = binding.paths.map((path) => readWorkspacePlanPath({ args }, path)).filter((value) => value !== undefined);
    if (binding.required && !hasFact(facts, binding.fact)) return { ok: false, code: 'PLAN_FACT_MISSING', summary: `当前步骤缺少输入绑定事实 ${binding.fact}` };
    if (values.length === 0) return { ok: false, code: 'PLAN_ARGUMENT_INVALID', summary: `输入绑定 ${binding.fact} 未出现在参数中` };
    if (values.some((value) => !matchesValueType(value, binding.valueType))) return { ok: false, code: 'PLAN_ARGUMENT_INVALID', summary: `输入绑定 ${binding.fact} 类型不匹配` };
    const expected = facts[binding.fact];
    if (expected !== undefined && values.some((value) => !sameValue(value, expected))) return { ok: false, code: 'PLAN_ARGUMENT_INVALID', summary: `输入绑定 ${binding.fact} 与已确认事实不一致` };
  }
  const policyResult = policy?.validateCall?.(step, toolName, args, facts);
  if (policyResult && !policyResult.ok) return policyResult;
  return { ok: true };
}

export function validateWorkspacePlanJsonSchema(schema: WorkspacePlanJsonSchema, value: unknown, path = 'args'): WorkspacePlanValidationResult {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, summary: `${path} 必须是对象` };
    const object = value as Record<string, unknown>;
    for (const required of schema.required ?? []) if (!(required in object)) return { ok: false, summary: `${path}.${required} 为必填参数` };
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in object) { const result = validateWorkspacePlanJsonSchema(child, object[key], `${path}.${key}`); if (!result.ok) return result; }
    if (schema.additionalProperties === false) for (const key of Object.keys(object)) if (!schema.properties || !(key in schema.properties)) return { ok: false, summary: `${path}.${key} 不是允许的参数` };
    return { ok: true };
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return { ok: false, summary: `${path} 必须是数组` };
    if (schema.minItems !== undefined && value.length < schema.minItems) return { ok: false, summary: `${path} 数组长度不足` };
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return { ok: false, summary: `${path} 数组长度超限` };
    for (let index = 0; index < value.length; index += 1) { const result = schema.items ? validateWorkspacePlanJsonSchema(schema.items, value[index], `${path}[${index}]`) : { ok: true }; if (!result.ok) return result; }
    return { ok: true };
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return { ok: false, summary: `${path} 必须是字符串` };
    if (schema.minLength !== undefined && value.length < schema.minLength) return { ok: false, summary: `${path} 长度不足` };
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return { ok: false, summary: `${path} 长度超限` };
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) return { ok: false, summary: `${path} 格式不匹配` };
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) return { ok: false, summary: `${path} 必须是${schema.type === 'integer' ? '整数' : '数字'}` };
    if (schema.minimum !== undefined && value < schema.minimum) return { ok: false, summary: `${path} 小于最小值` };
    if (schema.maximum !== undefined && value > schema.maximum) return { ok: false, summary: `${path} 大于最大值` };
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') return { ok: false, summary: `${path} 必须是布尔值` };
  if (schema.enum && !schema.enum.some((candidate) => sameValue(candidate, value))) return { ok: false, summary: `${path} 不在允许枚举中` };
  return { ok: true };
}

export function extractWorkspacePlanFacts(toolName: string, args: Record<string, unknown>, result: unknown, variant?: WorkspacePlanToolVariant): WorkspacePlanFacts {
  if (!variant) return genericFacts(result);
  const facts: WorkspacePlanFacts = {};
  const context = { args, result };
  for (const descriptor of variant.outputFacts) {
    if (descriptor.source === 'confirmation_event') continue;
    const value = extractDescriptorValue(descriptor, context);
    if (value !== undefined) facts[descriptor.key] = value;
  }
  return facts;
}

export function validateWorkspacePlanOutputFacts(variant: WorkspacePlanToolVariant, context: { args?: Record<string, unknown>; result?: unknown; event?: unknown }, source: 'tool_result' | 'confirmation_event'): WorkspacePlanValidationResult & { facts: WorkspacePlanFacts } {
  const facts: WorkspacePlanFacts = {};
  for (const descriptor of variant.outputFacts) {
    if (descriptor.source === 'confirmation_event' && source !== 'confirmation_event') continue;
    if (descriptor.source === 'tool_result' && source !== 'tool_result') continue;
    const value = extractDescriptorValue(descriptor, context);
    if (value === undefined) {
      if (descriptor.requiredOnSuccess && (!descriptor.condition || conditionMatches(descriptor.condition, context))) return { ok: false, code: 'PLAN_OUTPUT_FACT_MISSING', summary: `成功结果缺少输出事实 ${descriptor.key}`, facts };
      continue;
    }
    if (!matchesValueType(value, descriptor.valueType)) return { ok: false, code: 'PLAN_OUTPUT_FACT_MISSING', summary: `输出事实 ${descriptor.key} 类型不匹配`, facts };
    facts[descriptor.key] = value;
  }
  return { ok: true, facts };
}

export function extractWorkspacePlanFactsFromEvent(eventType: string, payload: Record<string, unknown>, variant?: WorkspacePlanToolVariant): WorkspacePlanFacts {
  if (payload.status !== 'succeeded') return {};
  if (variant) return validateWorkspacePlanOutputFacts(variant, { event: { payload } }, 'confirmation_event').facts;
  if (eventType === 'workspace.command.completed' || eventType === 'workspace.coupon.created') return genericFacts(payload.result ?? payload);
  return {};
}

export function mergeWorkspacePlanFacts(base: WorkspacePlanFacts | undefined, patch: WorkspacePlanFacts): WorkspacePlanFacts { return { ...(base ?? {}), ...patch }; }

export function workspacePlanGoalStatus(predicateId: string | undefined, facts: WorkspacePlanFacts | undefined, policy?: WorkspacePlanPolicy, context?: WorkspacePlanPolicyContext): WorkspacePlanGoalStatus {
  if (!predicateId) return { complete: true, missing: [] };
  const result = policy?.goalStatus?.(context ?? { predicateId, status: 'unknown', steps: [] }, facts);
  return result ?? { predicateId, complete: false, missing: ['plan_policy'] };
}

export function planStepRequiresConfirmation(step: WorkspacePlanStepLike, metadata?: WorkspaceToolPlanMetadata): boolean { return contractForWorkspaceStep(step, metadata).confirmationPolicy === 'required'; }

export function workspacePlanStepOutputsSatisfied(step: { outputFacts?: WorkspacePlanOutputFact[] }, facts: WorkspacePlanFacts): boolean {
  return (step.outputFacts ?? []).filter((descriptor) => descriptor.requiredOnSuccess).every((descriptor) => hasFact(facts, descriptor.key));
}

function genericFacts(result: unknown): WorkspacePlanFacts {
  const record = asRecord(result); const data = asRecord(record?.data);
  const facts = asRecord(record?.facts) ?? asRecord(data?.facts) ?? asRecord(data?.planFacts);
  return facts ? { ...facts } : {};
}

function extractDescriptorValue(descriptor: WorkspacePlanOutputFact, context: { args?: Record<string, unknown>; result?: unknown; event?: unknown }): unknown {
  if (descriptor.condition && !conditionMatches(descriptor.condition, context)) return undefined;
  let selected: unknown = undefined;
  let selectedPath: string | undefined;
  for (const path of descriptor.paths) {
    const candidate = readWorkspacePlanPath(context, path);
    if (candidate === undefined) continue;
    if (selected === undefined) { selected = candidate; selectedPath = path; continue; }
    if (!sameValue(selected, candidate)) throw new Error(`PLAN_OUTPUT_FACT_CONFLICT:${descriptor.key}:${selectedPath}:${path}`);
  }
  return selected;
}

function conditionMatches(condition: NonNullable<WorkspacePlanOutputFact['condition']>, context: { args?: Record<string, unknown>; result?: unknown; event?: unknown }): boolean {
  const value = readWorkspacePlanPath(context, condition.path);
  if (condition.arrayLengthEquals !== undefined) return Array.isArray(value) && value.length === condition.arrayLengthEquals;
  if (condition.equals !== undefined) return sameValue(value, condition.equals);
  return value !== undefined;
}

export function readWorkspacePlanPath(context: { args?: Record<string, unknown>; result?: unknown; event?: unknown }, path: WorkspacePlanPath): unknown {
  const match = path.match(/^(args|result\.data(?:\.parsed)?|event\.payload)(.*)$/u);
  if (!match) return undefined;
  const rootKey = match[1]; const suffix = match[2] ?? '';
  let current: unknown = rootKey === 'args' ? context.args : rootKey === 'result.data' ? asRecord(context.result)?.data : rootKey === 'result.data.parsed' ? asRecord(asRecord(context.result)?.data)?.parsed : asRecord(context.event)?.payload;
  if (!suffix) return current;
  const tokens = [...suffix.matchAll(/\.([A-Za-z_][A-Za-z0-9_]*)|\[([0-9]+)\]/g)].map((item) => item[1] ?? item[2]);
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) current = current[Number(token)];
    else if (typeof current === 'object') current = (current as Record<string, unknown>)[token];
    else return undefined;
  }
  return current;
}

function matchesValueType(value: unknown, type: WorkspacePlanValueType): boolean {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}
function sameValue(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function hasFact(facts: WorkspacePlanFacts, key: string): boolean { const value = facts[key]; return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== ''; }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
