import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalWorkspacePlanSteps,
  extractWorkspacePlanFacts,
  validateWorkspacePlanCall,
  workspacePlanGoalStatus,
} from '../src/workspace-plan-contract.js';

const tools = [
  'pi_skill_catalog',
  'pi_skill_read',
  'pi_skill_exec',
  'workspace_product_search',
  'workspace_prepare_write',
  'workspace_read',
];

test('contract compiler creates the exact public-share, coupon, automation, and readback chain', () => {
  const steps = canonicalWorkspacePlanSteps('用 03 PPT Master 的网盘公开分享链接创建一个卡券，关联“AI 技术咨询，需求定制开发服务”这个商品，然后启用自动发货', tools);
  assert.deepEqual(steps?.map((step) => [step.tool, step.action, step.argPredicateId]), [
    ['pi_skill_catalog', 'catalog', 'catalog-quarkclouddrive'],
    ['pi_skill_read', 'read-file-share-reference', 'read-file-share-reference'],
    ['pi_skill_exec', 'search-public-share-file', 'search-public-share-file'],
    ['pi_skill_exec', 'create-public-share-link', 'create-public-share-link'],
    ['workspace_product_search', 'resolve-exact-product', 'resolve-exact-product'],
    ['workspace_prepare_write', 'coupon_create', 'create-coupon-from-public-share'],
    ['workspace_prepare_write', 'product_automation_update', 'enable-paid-auto-delivery'],
    ['workspace_read', 'readback-paid-auto-delivery', 'readback-paid-auto-delivery'],
  ]);
});

test('contract validation rejects skipped facts and wrong product or automation arguments', () => {
  const steps = canonicalWorkspacePlanSteps('用 03 PPT Master 的网盘公开分享链接创建一个卡券，关联“AI 技术咨询，需求定制开发服务”这个商品，然后启用自动发货', tools)!;
  const shareStep = steps[3]!;
  const missingFid = validateWorkspacePlanCall(shareStep, 'pi_skill_exec', { skillId: 'quarkclouddrive', command: 'share', args: ['fid-1'] }, {});
  assert.equal(missingFid.code, 'PLAN_FACT_MISSING');
  const productStep = steps[4]!;
  const wrongProduct = validateWorkspacePlanCall(productStep, 'workspace_product_search', { query: '其他商品' }, {});
  assert.equal(wrongProduct.code, 'PLAN_ARGUMENT_MISMATCH');
  const automationStep = steps[6]!;
  const wrongAutomation = validateWorkspacePlanCall(automationStep, 'workspace_prepare_write', { operation: 'product_automation_update', parameters: { productId: 'product-1', config: { paidAutoDelivery: { enabled: true, couponBatchIds: ['old-batch'] } } } }, { productId: 'product-1', couponBatchId: 'new-batch' });
  assert.equal(wrongAutomation.code, 'PLAN_ARGUMENT_MISMATCH');
});

test('contract facts and goal predicate prove the final target', () => {
  const facts = {
    ...extractWorkspacePlanFacts('pi_skill_exec', { command: 'search' }, { content: 'fid=fid-1', data: { fid: 'fid-1' } }),
    ...extractWorkspacePlanFacts('pi_skill_exec', { command: 'share' }, { content: 'https://share.example.test/public' }),
    ...extractWorkspacePlanFacts('workspace_product_search', {}, { data: { items: [{ id: 'product-1', title: 'AI 技术咨询，需求定制开发服务' }] } }),
    ...extractWorkspacePlanFacts('workspace_read', { instruction: '读取商品 product-1 的自动发货配置并复核 couponBatchId=batch-1' }, { data: { productId: 'product-1', configVersion: 3, config: { paidAutoDelivery: { enabled: true, couponBatchIds: ['batch-1'] } }, couponBatches: [{ id: 'batch-1', status: 'active' }] }, couponBatchId: 'batch-1' }),
    couponBatchId: 'batch-1',
    couponBatchActive: true,
  };
  facts.readbackConfirmed = true;
  const status = workspacePlanGoalStatus('coupon_from_public_share_enable_paid_auto_delivery', facts);
  assert.equal(status.complete, true);
  assert.deepEqual(status.missing, []);
});

test('contract facts extract fid from nested parsed data and stringified Skill output', () => {
  assert.deepEqual(
    extractWorkspacePlanFacts('pi_skill_exec', { command: 'search' }, { data: { parsed: { items: [{ fileId: 'fid-nested' }] } } }),
    { fid: 'fid-nested' },
  );
  assert.deepEqual(
    extractWorkspacePlanFacts('pi_skill_exec', { command: 'search' }, '{"fileId":"fid-json"}'),
    { fid: 'fid-json' },
  );
  assert.deepEqual(
    extractWorkspacePlanFacts('pi_skill_exec', { command: 'search' }, { content: '{"fileId":"fid-content"}' }),
    { fid: 'fid-content' },
  );
});

test('goal predicate rejects wrong title, missing readback version, or stale binding', () => {
  const base = { shareUrl: 'https://share.example.test/public', couponBatchId: 'batch-1', productId: 'product-1', productTitle: 'AI 技术咨询，需求定制开发服务', configVersion: 3, couponBatchActive: true, paidAutoDeliveryEnabled: true, boundCouponBatchIds: ['batch-1'], readbackConfirmed: true };
  assert.equal(workspacePlanGoalStatus('coupon_from_public_share_enable_paid_auto_delivery', { ...base, productTitle: 'WRONG' }).complete, false);
  assert.equal(workspacePlanGoalStatus('coupon_from_public_share_enable_paid_auto_delivery', { ...base, configVersion: undefined }).complete, false);
  assert.equal(workspacePlanGoalStatus('coupon_from_public_share_enable_paid_auto_delivery', { ...base, boundCouponBatchIds: [] }).complete, false);
});

test('unknown actions fail closed when no input-output contract exists', () => {
  const result = validateWorkspacePlanCall({ tool: 'workspace_read', goal: 'unknown action' }, 'workspace_read', { foo: 'bar' }, {});
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PLAN_CONTRACT_ERROR');
  const explicitUnknownAction = validateWorkspacePlanCall({ tool: 'workspace_read', goal: 'x', action: 'mystery' }, 'workspace_read', { foo: 'bar' }, {});
  assert.equal(explicitUnknownAction.code, 'PLAN_CONTRACT_ERROR');
  const unknownTool = validateWorkspacePlanCall({ tool: 'mystery', goal: 'x' }, 'mystery', { foo: 'bar' }, {});
  assert.equal(unknownTool.code, 'PLAN_CONTRACT_ERROR');
});
