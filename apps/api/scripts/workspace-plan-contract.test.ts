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

test('generic contracts validate tool order and default write confirmation', () => {
  const read = contractForWorkspaceStep({ tool: 'workspace_read', goal: '读取当前配置' });
  assert.equal(read.action, 'read');
  assert.equal(read.confirmationPolicy, 'none');
  assert.equal(validateWorkspacePlanCall({ tool: 'workspace_read', goal: '读取当前配置' }, 'workspace_read', { instruction: '读取当前配置' }, {}).ok, true);

  const write = contractForWorkspaceStep({ tool: 'workspace_prepare_write', goal: '准备更新配置' });
  assert.equal(write.action, 'write');
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
    { tool: 'workspace_read', goal: '读取配置' },
    { tool: 'workspace_prepare_write', goal: '准备更新配置' },
  ] })!;
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
  const unknown = validateWorkspacePlanCall({ tool: 'unknown_tool', goal: 'x' }, 'unknown_tool', {}, {}, policy);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'PLAN_CONTRACT_ERROR');

  const known = validateWorkspacePlanCall({ tool: 'workspace_read', goal: '读取配置' }, 'workspace_read', {}, {}, policy);
  assert.equal(known.ok, true);
});

test('policy identity survives plan persistence and legacy predicates fail closed', () => {
  const policy: WorkspacePlanPolicy = { key: 'test-policy', version: 1, goalStatus: () => ({ complete: true, missing: [] }) };
  const plan = createWorkspaceExecutionPlan({ instruction: '执行策略计划', steps: [{ tool: 'workspace_read', goal: '读取配置' }], policy })!;
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
  const unknownAction = validateWorkspacePlanCall({ tool: 'workspace_read', goal: 'x', action: 'mystery' }, 'workspace_read', {}, {});
  assert.equal(unknownAction.ok, false);
  assert.equal(unknownAction.code, 'PLAN_CONTRACT_ERROR');

  const unknownTool = validateWorkspacePlanCall({ tool: 'mystery', goal: 'x' }, 'mystery', {}, {});
  assert.equal(unknownTool.ok, false);
  assert.equal(unknownTool.code, 'PLAN_CONTRACT_ERROR');
});
