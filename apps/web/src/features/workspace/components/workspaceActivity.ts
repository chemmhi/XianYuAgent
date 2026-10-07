import type { WorkspaceMessageVM } from '../types';

export type WorkspaceActivityItem =
  | { kind: 'message'; message: WorkspaceMessageVM }
  | { kind: 'summary'; id: string; text: string; message: WorkspaceMessageVM }
  | { kind: 'tool'; id: string; key: string; label: string; count: number; message: WorkspaceMessageVM; messages: WorkspaceMessageVM[] };

export type WorkspaceToolActionIcon = 'edit' | 'search' | 'read' | 'command';

const lowSignalSummaryPattern = /等待工具返回真实结果|正在等待工具返回|等待工具结果|正在确定下一步/;

/**
 * Converts raw Workspace messages into the compact, chronological activity feed
 * shown in the conversation surface. Summaries stay as prose; tool calls become
 * one-line human actions and repeated adjacent calls are compressed.
 */
export function buildWorkspaceActivityItems(messages: WorkspaceMessageVM[]): WorkspaceActivityItem[] {
  const items: WorkspaceActivityItem[] = [];
  for (const message of messages) {
    if (message.type === 'reasoning_summary') {
      const text = humanizeActivityText(message.content.trim());
      if (!text || isLowSignalSummary(message)) continue;
      const previous = items.at(-1);
      if (previous?.kind === 'summary' && normalize(previous.text) === normalize(text)) continue;
      items.push({ kind: 'summary', id: message.id, text, message });
      continue;
    }

    if (message.type === 'tool_event') {
      const label = workspaceToolActionLabel(message);
      const key = toolAggregationKey(message);
      const previous = items.at(-1);
      if (previous?.kind === 'tool' && previous.key === key) {
        previous.count += 1;
        previous.message = message;
        previous.messages.push(message);
        continue;
      }
      items.push({ kind: 'tool', id: message.id, key, label, count: 1, message, messages: [message] });
      continue;
    }

    if (message.type === 'final_answer' && items.some((item) => item.kind === 'summary' && normalize(item.text) === normalize(message.content))) continue;
    items.push({ kind: 'message', message });
  }
  return items;
}

export function workspaceToolActionLabel(message: WorkspaceMessageVM): string {
  const toolName = message.title.trim().toLowerCase();
  const summary = (message.summary ?? '').trim();
  const source = `${toolName} ${summary}`;
  if (/workspace_prepare_write|准备受控写入|准备写入/.test(source)) return '准备了受控写入';
  if (/编辑|修改文件|apply_patch|写文件/.test(source)) return '编辑了文件运行了命令';
  if (/workspace_product_write|创建商品|更新商品|创建卡券|更新卡券/.test(source)) return '编辑了文件运行了命令';
  if (toolName === '工具事件') return /失败|错误/.test(message.content) ? '工具调用失败' : '运行了命令';
  if (/pi_skill_read|读取 skill|读取技能|技能说明/.test(source)) return '读取 Skill 使用说明';
  if (/pi_skill_search|检索 skill|搜索 skill|技能搜索/.test(source)) return '检索 Skill 使用说明';
  if (/workspace_product_search|检索商品|商品搜索/.test(source)) return '检索商品信息';
  if (/workspace_read|读取工作区|读取数据/.test(source)) return '读取工作区数据';
  if (/pi_skill_exec|运行命令|执行命令|执行 skill|执行技能|命令/.test(source)) return '运行了命令';
  return '运行了命令';
}

export function workspaceToolActionIcon(message: WorkspaceMessageVM): WorkspaceToolActionIcon {
  const source = `${message.title.trim().toLowerCase()} ${(message.summary ?? '').trim()}`;
  if (/编辑|写入|修改文件|apply_patch|写文件|workspace_prepare_write|创建商品|更新商品|创建卡券|更新卡券/.test(source)) return 'edit';
  if (/检索|搜索|pi_skill_search|workspace_product_search/.test(source)) return 'search';
  if (/读取|pi_skill_read|workspace_read/.test(source)) return 'read';
  return 'command';
}

export function shouldDisplayToolActionLabel(label: string, hasMeaningfulDetails = false): boolean {
  return normalize(label) !== '运行了命令' || hasMeaningfulDetails;
}

function toolAggregationKey(message: WorkspaceMessageVM): string {
  return `${message.runId ?? ''}|${message.title.trim().toLowerCase()}|${workspaceToolActionLabel(message)}`;
}

export function isLowSignalSummary(message: WorkspaceMessageVM): boolean {
  const content = message.content.trim();
  const summary = (message.summary ?? '').trim();
  return lowSignalSummaryPattern.test(content) && Boolean(summary);
}

export function isMeaningfulToolDetail(message: WorkspaceMessageVM): boolean {
  const title = normalize(message.title).toLowerCase();
  const content = normalize(message.content).toLowerCase();
  if (!content) return false;
  if (title === '工具事件' && /^(workspace[ .]skill[ .]progress|workspace[ .]execution[ .]summary|tool[ .]call(?:[ .].*)?)$/.test(content)) return false;
  if (/^workspace[ .]skill[ .]progress$/.test(content)) return false;
  return true;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function humanizeActivityText(value: string): string {
  if (/^Skill overview loaded$/i.test(value)) return '已读取 Skill 使用说明。';
  if (/^No Skill instruction matches$/i.test(value)) return '未找到匹配的 Skill 指令。';
  const matchCount = value.match(/^(\d+) Skill instruction match\(es\)$/i);
  if (matchCount) return `找到 ${matchCount[1]} 条 Skill 指令。`;
  return value;
}
