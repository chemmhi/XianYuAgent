import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contractForWorkspaceStep,
  extractWorkspacePlanFacts,
  validateWorkspacePlanCall,
  validateWorkspacePlanOutputFacts,
} from '../src/workspace-plan-contract.js';
import { allWorkspaceToolPlanMetadata } from '../src/workspace-tool-plans.js';
import { createWorkspaceExecutionPlan, restoreWorkspacePlanFacts } from '../src/workspace-context.js';

const metadata = Object.fromEntries([
  ['workspace_product_search', allWorkspaceToolPlanMetadata('workspace_product_search')!],
  ['workspace_prepare_write', allWorkspaceToolPlanMetadata('workspace_prepare_write')!],
  ['pi_skill_exec', allWorkspaceToolPlanMetadata('pi_skill_exec')!],
]);

test('plans require versioned metadata and discriminator variants', () => {
  assert.equal(createWorkspaceExecutionPlan({ instruction: 'x', steps: [{ tool: 'workspace_product_search', goal: 'x', variant: 'default', contractVersion: 1 }] }), undefined);
  const plan = createWorkspaceExecutionPlan({
    instruction: 'x',
    toolMetadata: metadata,
    steps: [
      { tool: 'workspace_product_search', goal: 'x', variant: 'default', contractVersion: 1 },
      { tool: 'workspace_prepare_write', goal: 'x', variant: 'coupon_create', contractVersion: 1 },
    ],
  });
  assert.deepEqual(plan?.steps.map((step) => [step.variant, step.contractVersion]), [['default', 1], ['coupon_create', 1]]);
  assert.equal(createWorkspaceExecutionPlan({ instruction: 'x', toolMetadata: metadata, steps: [{ tool: 'pi_skill_exec', goal: 'x', variant: 'unknown', contractVersion: 1 }] }), undefined);
});

test('argument validation enforces schema, facts, and exact input bindings', () => {
  const step = { tool: 'workspace_prepare_write', goal: 'create', variant: 'coupon_create', contractVersion: 1 };
  assert.equal(validateWorkspacePlanCall(step, 'workspace_prepare_write', { operation: 'coupon_create', parameters: { label: '03 PPT Master', purpose: 'api', apiConfig: { url: 'https://share.test/x', method: 'GET' } } }, { shareUrl: 'https://share.test/x' }, undefined, metadata.workspace_prepare_write).ok, true);
  const mismatch = validateWorkspacePlanCall(step, 'workspace_prepare_write', { operation: 'coupon_create', parameters: { label: '03 PPT Master', purpose: 'api', apiConfig: { url: 'https://other.test/x', method: 'GET' } } }, { shareUrl: 'https://share.test/x' }, undefined, metadata.workspace_prepare_write);
  assert.equal(mismatch.code, 'PLAN_ARGUMENT_INVALID');
});

test('conditional product facts do not infer productId from ambiguous results', () => {
  const variant = metadata.workspace_product_search!.default!;
  const one = validateWorkspacePlanOutputFacts(variant, { result: { data: { productId: 'p-1', items: [{ id: 'p-1', title: 'A' }] } } }, 'tool_result');
  assert.equal(one.ok, true);
  assert.equal(one.facts.productId, 'p-1');
  const many = extractWorkspacePlanFacts('workspace_product_search', {}, { data: { items: [{ id: 'p-1' }, { id: 'p-2' }] } }, variant);
  assert.equal(many.productId, undefined);
});

test('restore replays tool-result and confirmation-event facts from persisted evidence', () => {
  const plan = createWorkspaceExecutionPlan({ instruction: 'x', toolMetadata: metadata, steps: [
    { tool: 'workspace_product_search', goal: 'search', variant: 'default', contractVersion: 1 },
    { tool: 'workspace_prepare_write', goal: 'create', variant: 'coupon_create', contractVersion: 1 },
  ] })!;
  const facts = restoreWorkspacePlanFacts([
    { sequence: 1, runId: 'r', eventType: 'workspace.plan.created', createdAt: new Date().toISOString(), payload: { plan } },
    { sequence: 2, runId: 'r', eventType: 'tool.result', createdAt: new Date().toISOString(), payload: { status: 'succeeded', toolName: 'workspace_product_search', args: { query: 'A' }, result: { data: { productId: 'p-1', items: [{ id: 'p-1', title: 'A' }] } } } },
    { sequence: 3, runId: 'r', eventType: 'workspace.coupon.created', createdAt: new Date().toISOString(), payload: { status: 'succeeded', batchId: 'b-1' } },
  ]);
  assert.equal(facts.productId, 'p-1');
  assert.equal(facts.couponBatchId, 'b-1');
});

test('unknown pi_skill_exec commands fail closed at plan validation', () => {
  const step = { tool: 'pi_skill_exec', goal: 'unknown', variant: 'mutate', contractVersion: 1 };
  const result = validateWorkspacePlanCall(step, 'pi_skill_exec', { skillId: 's', command: 'mutate' }, {}, undefined, metadata.pi_skill_exec);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PLAN_CONTRACT_UNAVAILABLE');
});

test('contract action is metadata-derived rather than keyword-derived', () => {
  const contract = contractForWorkspaceStep({ tool: 'workspace_prepare_write', goal: 'any words', variant: 'product_automation_update', contractVersion: 1 }, metadata.workspace_prepare_write);
  assert.equal(contract.variant, 'product_automation_update');
  assert.equal(contract.confirmationPolicy, 'required');
});
