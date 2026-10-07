import { describe, expect, it } from 'vitest';
import type { WorkspaceMessageVM } from '../types';
import { buildWorkspaceActivityItems, isMeaningfulToolDetail, shouldDisplayToolActionLabel, workspaceToolActionIcon, workspaceToolActionLabel } from './workspaceActivity';

const base = (overrides: Partial<WorkspaceMessageVM>): WorkspaceMessageVM => ({
  id: overrides.id ?? 'message',
  runId: 'run-1',
  type: overrides.type ?? 'reasoning_summary',
  createdAt: overrides.createdAt ?? '2026-10-07T00:00:00.000Z',
  title: overrides.title ?? '推理摘要',
  content: overrides.content ?? '',
  ...overrides,
});

describe('workspace activity feed', () => {
  it('keeps prose checkpoints and tool actions in source order', () => {
    const items = buildWorkspaceActivityItems([
      base({ id: 'summary-1', content: '已确认目标商品唯一匹配。' }),
      base({ id: 'tool-1', type: 'tool_event', title: 'workspace_product_search', summary: '检索商品信息', content: '工具结果：找到 1 个商品' }),
      base({ id: 'summary-2', content: '下一步准备写入卡券。' }),
      base({ id: 'tool-2', type: 'tool_event', title: 'pi_skill_exec', summary: '执行 Skill 命令', content: '工具结果：命令完成' }),
      base({ id: 'final-1', type: 'final_answer', title: 'Agent', content: '已完成。' }),
    ]);

    expect(items.map((item) => item.kind)).toEqual(['summary', 'tool', 'summary', 'tool', 'message']);
    expect(items[0]).toMatchObject({ kind: 'summary', text: '已确认目标商品唯一匹配。' });
    expect(items[1]).toMatchObject({ kind: 'tool', label: '检索商品信息' });
    expect(items[3]).toMatchObject({ kind: 'tool', label: '运行了命令' });
  });

  it('compresses adjacent duplicate tool actions instead of rendering a long raw list', () => {
    const items = buildWorkspaceActivityItems([
      base({ id: 'tool-1', type: 'tool_event', title: 'pi_skill_search', summary: '检索 Skill 使用说明', content: '工具结果：' }),
      base({ id: 'tool-2', type: 'tool_event', title: 'pi_skill_search', summary: '检索 Skill 使用说明', content: '工具结果：' }),
      base({ id: 'tool-3', type: 'tool_event', title: 'pi_skill_search', summary: '检索 Skill 使用说明', content: '工具结果：' }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'tool', label: '检索 Skill 使用说明', count: 3 });
  });

  it('preserves tool and result order when calls are separated by summaries', () => {
    const items = buildWorkspaceActivityItems([
      base({ id: 'tool-1', type: 'tool_event', title: 'pi_skill_search', summary: '检索 Skill 使用说明', content: '工具结果：' }),
      base({ id: 'result-1', summary: 'Skill search', content: 'No matches' }),
      base({ id: 'tool-2', type: 'tool_event', title: 'pi_skill_search', summary: '检索 Skill 使用说明', content: '工具结果：' }),
      base({ id: 'result-2', summary: 'Skill search', content: 'No matches' }),
      base({ id: 'tool-3', type: 'tool_event', title: 'pi_skill_search', summary: '检索 Skill 使用说明', content: '工具结果：' }),
      base({ id: 'result-3', summary: 'Skill search', content: 'No matches' }),
      base({ id: 'tool-4', type: 'tool_event', title: 'pi_skill_search', summary: '检索 Skill 使用说明', content: '工具结果：' }),
    ]);

    expect(items.map((item) => item.kind)).toEqual(['tool', 'summary', 'tool', 'summary', 'tool', 'summary', 'tool']);
    expect(items.filter((item) => item.kind === 'tool')).toHaveLength(4);
    expect(items.every((item) => item.kind !== 'tool' || item.count === 1)).toBe(true);
  });

  it('does not repeat a final answer already shown as a summary', () => {
    const items = buildWorkspaceActivityItems([
      base({ id: 'summary-1', content: '执行失败：请重试。' }),
      base({ id: 'final-1', type: 'final_answer', title: 'Agent', content: '执行失败：请重试。' }),
    ]);

    expect(items.map((item) => item.kind)).toEqual(['summary']);
  });

  it('drops waiting placeholders while keeping concrete result summaries', () => {
    const items = buildWorkspaceActivityItems([
      base({ id: 'summary-placeholder', summary: '检索商品信息', content: '正在检索商品信息，等待工具返回真实结果。' }),
      base({ id: 'summary-result', summary: '商品搜索', content: '已按名称筛选 1 个商品。' }),
    ]);

    expect(items.map((item) => item.kind)).toEqual(['summary']);
    expect(items[0]).toMatchObject({ kind: 'summary', text: '已按名称筛选 1 个商品。' });
  });

  it('maps tool names to user-facing action phrases', () => {
    expect(workspaceToolActionLabel(base({ type: 'tool_event', title: 'pi_skill_read', summary: '读取 Skill 使用说明' }))).toBe('读取 Skill 使用说明');
    expect(workspaceToolActionLabel(base({ type: 'tool_event', title: 'pi_skill_exec', summary: '执行 Skill 命令' }))).toBe('运行了命令');
    expect(workspaceToolActionLabel(base({ type: 'tool_event', title: 'workspace_prepare_write', summary: '准备受控写入' }))).toBe('准备了受控写入');
  });

  it('changes the outline icon with the action semantics', () => {
    expect(workspaceToolActionIcon(base({ type: 'tool_event', title: 'pi_skill_search', summary: '检索 Skill 使用说明' }))).toBe('search');
    expect(workspaceToolActionIcon(base({ type: 'tool_event', title: 'pi_skill_read', summary: '读取 Skill 使用说明' }))).toBe('read');
    expect(workspaceToolActionIcon(base({ type: 'tool_event', title: 'workspace_prepare_write', summary: '准备受控写入' }))).toBe('edit');
    expect(workspaceToolActionIcon(base({ type: 'tool_event', title: 'pi_skill_exec', summary: '执行 Skill 命令' }))).toBe('command');
  });

  it('filters internal event-only details from expanded tool rows', () => {
    expect(isMeaningfulToolDetail(base({ type: 'tool_event', title: '工具事件', content: 'workspace skill progress' }))).toBe(false);
    expect(isMeaningfulToolDetail(base({ type: 'tool_event', title: 'workspace_product_search', content: '工具结果：找到 1 个商品' }))).toBe(true);
  });

  it('hides the generic command title while keeping semantic action titles', () => {
    expect(shouldDisplayToolActionLabel('运行了命令')).toBe(false);
    expect(shouldDisplayToolActionLabel('运行了命令', true)).toBe(true);
    expect(shouldDisplayToolActionLabel('检索 Skill 使用说明')).toBe(true);
  });
});
