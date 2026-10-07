import type { RunEventRecord } from './domain.js';
import type { ModelMessage } from './pi-runtime.js';

const MAX_CONTEXT_CHARS = 32_000;

export function buildWorkspaceCheckpoint(events: RunEventRecord[]): string | undefined {
  const facts = new Map<string, string>();
  for (const event of events) {
    const payload = event.payload;
    if (event.eventType === 'tool.result' && payload.status === 'succeeded') {
      const result = asRecord(payload.result);
      if (!result || result.kind === 'write_plan') continue;
      const tool = typeof payload.toolName === 'string' ? payload.toolName : 'tool';
      const title = typeof result.title === 'string' ? result.title : tool;
      const detail = [result.summary, result.content, result.data && JSON.stringify(result.data)].filter((value): value is string => typeof value === 'string' && !!value.trim()).join('\n');
      if (detail) facts.set(`${tool}:${title}`, `${tool} / ${title}: ${detail}`);
    }
    if (event.eventType === 'workspace.coupon.created' && payload.status === 'succeeded') {
      facts.set('confirmed:coupon_create', `已确认并创建卡券：batchId=${String(payload.batchId ?? '')}，label=${String(payload.label ?? '')}。不要再次创建该卡券。`);
    }
    if (event.eventType === 'workspace.command.completed' && payload.status === 'succeeded') {
      const action = String(payload.action ?? 'write');
      facts.set(`confirmed:${action}`, `已确认并完成 ${action}：${String(payload.summary ?? '')}；结果=${JSON.stringify(payload.result ?? {}).slice(0, 1_500)}。不要重复执行。`);
    }
  }
  if (!facts.size) return undefined;
  return `已持久化的任务节点和真实结果（优先复用，缺失信息才重新查询）：\n${[...facts.values()].join('\n')}`;
}

export function compactWorkspaceModelMessages(messages: ModelMessage[], force = false): { messages: ModelMessage[]; summary?: string } {
  const size = messages.reduce((total, message) => total + JSON.stringify(message).length, 0);
  if (!force && size <= MAX_CONTEXT_CHARS) return { messages };
  const systems = messages.filter((message) => message.role === 'system');
  const user = [...messages].reverse().find((message) => message.role === 'user');
  const facts = messages.filter((message) => message.role === 'tool' || (message.role === 'assistant' && !message.toolCalls?.length))
    .map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content))
    .filter(Boolean).slice(-16);
  const prefix = `原始目标：${user ? textContent(user.content).slice(0, 1_500) : '继续当前任务'}\n已知进度与关键结果：\n`;
  const selected: string[] = [];
  let remaining = 12_000 - prefix.length;
  for (const fact of facts.reverse()) {
    if (remaining <= 0) break;
    const item = summarizeFact(fact).slice(0, remaining);
    selected.push(item);
    remaining -= item.length + 1;
  }
  const summary = prefix + selected.reverse().join('\n');
  return { messages: [...systems, { role: 'assistant', content: summary }, ...(user ? [user] : [])], summary };
}

function summarizeFact(fact: string): string {
  if (fact.length <= 900) return fact;
  const urls = [...new Set(fact.match(/https?:\/\/[^\s"'\\]+/g) ?? [])].slice(-4);
  const ids = [...new Set(fact.match(/(?:batchId|productId|shareId|fid)["=:\s]+[A-Za-z0-9_-]+/g) ?? [])].slice(-8);
  return `${fact.slice(0, 600)}\n关键标识：${[...ids, ...urls].join('；')}`.slice(0, 1_500);
}

function textContent(content: ModelMessage['content']): string {
  return typeof content === 'string' ? content : content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
