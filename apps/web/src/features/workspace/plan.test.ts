import { describe, expect, it } from 'vitest';
import { extractLatestWorkspacePlan, parseWorkspacePlan } from './plan';

describe('workspace plan projection', () => {
  it('keeps the latest valid plan event for the active run', () => {
    const plan = extractLatestWorkspacePlan([
      { sequence: 1, runId: 'run-1', eventType: 'workspace.plan.created', payload: { plan: { version: 1, revision: 1, goal: '完成卡券流程', status: 'active', currentStepId: 'step-1', steps: [{ id: 'step-1', tool: 'pi_skill_read', goal: '读取相关文档', status: 'running' }] } }, createdAt: '2026-10-07T00:00:00.000Z' },
      { sequence: 2, runId: 'run-1', eventType: 'workspace.plan.updated', payload: { plan: { version: 1, revision: 2, goal: '完成卡券流程', status: 'completed', steps: [{ id: 'step-1', tool: 'pi_skill_read', goal: '读取相关文档', status: 'succeeded', evidence: '已完成' }] } }, createdAt: '2026-10-07T00:00:01.000Z' },
      { sequence: 3, runId: 'run-2', eventType: 'workspace.plan.updated', payload: { plan: { version: 1, revision: 3, goal: '其他任务', status: 'blocked', steps: [{ id: 'step-1', tool: 'workspace_read', goal: '读取数据', status: 'blocked' }] } }, createdAt: '2026-10-07T00:00:02.000Z' },
    ], 'run-1');

    expect(plan).toMatchObject({ revision: 2, status: 'completed' });
    expect(plan?.currentStepId).toBeUndefined();
    expect(plan?.steps[0]).toMatchObject({ goal: '读取相关文档', status: 'succeeded', evidence: '已完成' });
  });

  it('rejects malformed plans instead of rendering a partial card', () => {
    expect(parseWorkspacePlan({ plan: { goal: '缺少步骤', status: 'active', steps: [] } })).toBeUndefined();
    expect(parseWorkspacePlan({ plan: { goal: '非法状态', status: 'unknown', steps: [{ id: '1', tool: 'x', goal: 'y', status: 'pending' }] } })).toBeUndefined();
  });
});
