import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contractForWorkspaceStep,
  extractWorkspacePlanFacts,
  validateWorkspacePlanCall,
  workspacePlanGoalStatus,
  type WorkspacePlanPolicy,
} from '../src/workspace-plan-contract.js';
import { createWorkspaceExecutionPlan, restoreWorkspaceExecutionPlan, workspacePlanCompletionStatus } from '../src/workspace-context.js';
import { allWorkspaceToolPlanMetadata } from '../src/workspace-tool-plans.js';

const toolMetadata = {
  workspace_read: allWorkspaceToolPlanMetadata('workspace_read')!,
  workspace_prepare_write: allWorkspaceToolPlanMetadata('workspace_prepare_write')!,
};
const step = (tool: string, goal: string, variant = 'default') => ({ tool, goal, variant, contractVersion: 1 });

test('generic contracts validate tool order and default write confirmation', () => {
  const readStep = step('workspace_read', '读取当前配置');
  const read = contractForWorkspaceStep(readStep, toolMetadata.workspace_read);
  assert.equal(read.variant, 'default');
  assert.equal(read.sideEffect, 'read');
  assert.equal(read.confirmationPolicy, 'none');
  assert.equal(validateWorkspacePlanCall(readStep, 'workspace_read', { instruction: '读取当前配置' }, {}, undefined, toolMetadata.workspace_read).ok, true);

  const write = contractForWorkspaceStep(step('workspace_prepare_write', '准备更新配置', 'coupon_create'), toolMetadata.workspace_prepare_write);
  assert.equal(write.variant, 'coupon_create');
  assert.equal(write.sideEffect, 'prepare_write');
  assert.equal(write.confirmationPolicy, 'required');
});

test('generic facts only accept facts explicitly returned by a tool contract', () => {
  assert.deepEqual(
    extractWorkspacePlanFacts('workspace_read', {}, { data: { facts: { productId: 'p-1', version: 3 } } }),
    { productId: 'p-1', version: 3 },
  );
  assert.deepEqual(extractWorkspacePlanFacts('workspace_read', {}, { data: { productId: 'p-1' } }), {});
});

test('generic completion requires a completed, internally consistent plan', () => {
  const plan = createWorkspaceExecutionPlan({ instruction: '读取并更新配置', steps: [
    step('workspace_read', '读取配置'),
    step('workspace_prepare_write', '准备更新配置', 'coupon_create'),
  ], toolMetadata })!;
  assert.equal(workspacePlanCompletionStatus(plan).complete, false);
  plan.steps[0]!.status = 'succeeded';
  plan.steps[1]!.status = 'succeeded';
  plan.currentStepId = undefined;
  plan.status = 'completed';
  assert.equal(workspacePlanCompletionStatus(plan).complete, true);

  plan.currentStepId = plan.steps[1]!.id;
  assert.equal(workspacePlanCompletionStatus(plan).complete, false);
  plan.currentStepId = undefined;
  plan.steps[1]!.status = 'waiting_confirmation';
  assert.equal(workspacePlanCompletionStatus(plan).complete, false);
});

test('legacy opaque predicates fail closed without a matching policy', () => {
  const status = workspacePlanGoalStatus('legacy-policy', {});
  assert.equal(status.complete, false);
  assert.deepEqual(status.missing, ['plan_policy']);
});

test('policy validation is additive and cannot bypass generic contract checks', () => {
  const policy: WorkspacePlanPolicy = {
    key: 'test-policy',
    version: 1,
    validateCall: () => ({ ok: true }),
  };
  const unknown = validateWorkspacePlanCall(step('unknown_tool', 'x'), 'unknown_tool', {}, {}, policy);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'PLAN_CONTRACT_UNAVAILABLE');

  const known = validateWorkspacePlanCall(step('workspace_read', '读取配置'), 'workspace_read', { instruction: '读取配置' }, {}, policy, toolMetadata.workspace_read);
  assert.equal(known.ok, true);
});

test('policy identity survives plan persistence and legacy predicates fail closed', () => {
  const policy: WorkspacePlanPolicy = { key: 'test-policy', version: 1, goalStatus: () => ({ complete: true, missing: [] }) };
  const plan = createWorkspaceExecutionPlan({ instruction: '执行策略计划', steps: [step('workspace_read', '读取配置')], policy, toolMetadata })!;
  const restored = restoreWorkspaceExecutionPlan([{
    id: 'event-1',
    runId: 'run-1',
    eventType: 'workspace.plan.created',
    createdAt: new Date().toISOString(),
    payload: { plan: { ...plan, goalPredicateId: 'legacy-policy' } },
  }]);
  assert.equal(restored?.policyKey, 'test-policy');
  assert.equal(restored?.policyVersion, 1);
  assert.equal(restored?.goalPredicateId, 'legacy-policy');
  assert.equal(workspacePlanCompletionStatus({ ...restored!, status: 'completed', currentStepId: undefined, steps: [{ ...restored!.steps[0]!, status: 'succeeded' }] }, policy).complete, true);
});

test('unknown actions and tools fail closed', () => {
  const unknownAction = validateWorkspacePlanCall({ ...step('workspace_read', 'x'), variant: 'mystery' }, 'workspace_read', { instruction: 'x' }, {}, undefined, toolMetadata.workspace_read);
  assert.equal(unknownAction.ok, false);
  assert.equal(unknownAction.code, 'PLAN_CONTRACT_UNAVAILABLE');

  const unknownTool = validateWorkspacePlanCall(step('mystery', 'x'), 'mystery', {}, {});
  assert.equal(unknownTool.ok, false);
  assert.equal(unknownTool.code, 'PLAN_CONTRACT_UNAVAILABLE');
});
