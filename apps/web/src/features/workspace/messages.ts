import type { WorkspaceMessageVM, WorkspaceRunEventVM, WorkspaceRunVM, WorkspaceStepVM } from './types';

export interface WorkspaceAgentTraceGroup {
  id: string;
  type: 'agent_trace';
  createdAt: string;
  messages: WorkspaceMessageVM[];
}

export type WorkspaceMessageBlock = WorkspaceMessageVM | WorkspaceAgentTraceGroup;

/** Derive a short intent title instead of copying the full user instruction. */
export function deriveSessionTitle(instruction: string, maxLength = 28): string {
  const normalized = instruction.replace(/\s+/g, ' ').trim();
  if (!normalized) return '新会话';
  const intent = deriveIntentTitle(normalized) ?? '工作区任务';
  if (intent.length <= maxLength) return intent;
  return `${intent.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function deriveIntentTitle(instruction: string): string | undefined {
  const action = instruction.match(/取消|关闭|停用|禁用|启用|开启|更新|修改|配置|设置|定制|查看|查询|读取|分析|刷新|同步|发布|创建|新增/i)?.[0];
  if (/自动发货/.test(instruction)) {
    if (/取消|关闭|停用|禁用/.test(instruction)) return '停用商品自动发货';
    if (/启用|开启/.test(instruction)) return '启用商品自动发货';
    return action && /更新|修改|配置|设置|定制/.test(action) ? '配置商品自动发货' : '查看商品自动发货';
  }
  if (/自动化规则|发货规则|商品自动化|改价|赠品|求评价|评价/.test(instruction)) {
    if (/取消|关闭|停用|禁用/.test(instruction)) return '停用商品自动化规则';
    if (/启用|开启/.test(instruction)) return '启用商品自动化规则';
    if (/更新|修改|配置|设置|定制/.test(instruction)) return '配置商品自动化规则';
    return '查看商品自动化规则';
  }
  if (/卡券|卡卷|卡密|优惠券/.test(instruction)) {
    if (/创建|新增|生成|新建/.test(instruction)) return '创建卡券';
    if (/取消|关闭|停用|禁用/.test(instruction)) return '停用卡券';
    if (/启用|开启/.test(instruction)) return '启用卡券';
    if (/更新|修改|配置|设置/.test(instruction)) return '配置卡券';
    return '查看卡券';
  }
  if (/订单/.test(instruction)) {
    if (/发货|交付/.test(instruction)) return '处理订单交付';
    if (/取消/.test(instruction)) return '取消订单交付';
    return '查询订单';
  }
  if (/库存|补货/.test(instruction)) return '库存与补货分析';
  if (/经营|运营|销售|趋势|仪表盘/.test(instruction)) return '经营数据分析';
  if (/账号|账户|店铺|登录|连接|健康/.test(instruction)) return '检查账号连接';
  if (/自动回复|智能客服|Agent/.test(instruction)) {
    return /配置|设置|修改|更新/.test(instruction) ? '配置自动回复 Agent' : '查看 Agent 运行状态';
  }
  if (/模型|OpenAI|Provider|API Key/i.test(instruction)) return '配置模型连接';
  if (/商品|产品/.test(instruction)) return /发布/.test(instruction) ? '发布商品' : '查询商品';
  return undefined;
}

/** Collapse adjacent reasoning/tool events into one ChatGPT-style execution trace. */
export function groupWorkspaceMessages(messages: WorkspaceMessageVM[]): WorkspaceMessageBlock[] {
  const blocks: WorkspaceMessageBlock[] = [];
  let pendingTrace: WorkspaceMessageVM[] = [];

  const flushTrace = () => {
    if (!pendingTrace.length) return;
    blocks.push({
      id: `${pendingTrace[0].id}:trace`,
      type: 'agent_trace',
      createdAt: pendingTrace[0].createdAt,
      messages: pendingTrace,
    });
    pendingTrace = [];
  };

  messages.forEach((message) => {
    if (message.type === 'reasoning_summary' || message.type === 'tool_event') {
      pendingTrace.push(message);
      return;
    }
    flushTrace();
    blocks.push(message);
  });
  flushTrace();
  return blocks;
}

const terminalStatuses = new Set(['succeeded', 'partially_succeeded', 'failed', 'cancelled', 'expired']);

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: '排队中', running: '运行中', waiting_confirmation: '等待确认', executing: '执行中', retrying: '重试中', cancelling: '取消中',
    succeeded: '已完成', partially_succeeded: '部分完成', failed: '失败', cancelled: '已取消', expired: '已过期', pending: '待执行', skipped: '已跳过',
  };
  return labels[status] ?? status;
}

function safeStatus(payload: Record<string, unknown>): string | undefined {
  return typeof payload.status === 'string' ? payload.status : undefined;
}

export function eventTitle(eventType: string): string {
  const labels: Record<string, string> = {
    'run.queued': 'Run 已排队',
    'run.started': 'Run 已开始',
    'run.executing': 'Agent 执行中',
    'run.succeeded': 'Run 已完成',
    'run.failed': 'Run 失败',
    'step.started': '步骤已开始',
    'step.executing': '工具步骤执行中',
    'step.succeeded': '步骤已完成',
    'step.failed': '步骤失败',
    'workspace.confirmation.created': '已生成确认卡',
    'workspace.confirmation.confirmed': '确认已提交',
    'workspace.outbox.enqueued': '已进入执行队列',
    'workspace.outbox.completed': '执行队列已完成',
    'workspace.coupon.created': '卡券已创建',
    'workspace.agent_settings.updated': 'Agent 配置已更新',
    'workspace.command.completed': '工作区动作已完成',
  };
  return labels[eventType] ?? eventType.replace(/[._]/g, ' ');
}

function stepSummary(step: WorkspaceStepVM): string {
  if (step.outputSummary) return step.outputSummary;
  return `${step.label}：${statusLabel(step.status)}。`;
}

function eventSummary(event: WorkspaceRunEventVM): string {
  const status = safeStatus(event.payload);
  const errorCode = typeof event.payload.errorCode === 'string' ? event.payload.errorCode : undefined;
  if (errorCode) return `${eventTitle(event.eventType)} · ${errorCode}`;
  if (status) return `${eventTitle(event.eventType)} · ${statusLabel(status)}`;
  return eventTitle(event.eventType);
}

function messageType(event: WorkspaceRunEventVM): WorkspaceMessageVM['type'] | undefined {
  const value = event.payload.messageType;
  return value === 'user_message' || value === 'reasoning_summary' || value === 'tool_event' || value === 'final_answer' ? value : undefined;
}

const lifecycleEventTypes = new Set([
  'run.queued',
  'run.started',
  'run.executing',
  'runtime.started',
  'step.started',
  'step.executing',
  'stream.started',
  'stream.round.completed',
  'stream.completed',
]);

function shouldProjectEvent(event: WorkspaceRunEventVM): boolean {
  if (lifecycleEventTypes.has(event.eventType)) return false;
  if (event.eventType === 'step.succeeded' || event.eventType === 'step.failed') return Boolean(messageType(event));
  if (event.eventType === 'runtime.succeeded' || event.eventType === 'runtime.failed' || event.eventType === 'run.succeeded' || event.eventType === 'run.failed') return Boolean(messageType(event) || event.payload.content);
  return true;
}

export function buildWorkspaceMessages(run: WorkspaceRunVM, events: WorkspaceRunEventVM[]): WorkspaceMessageVM[] {
  const messages: WorkspaceMessageVM[] = [{
    id: `${run.runId}:user`,
    runId: run.runId,
    type: 'user_message',
    createdAt: run.createdAt,
    title: '用户',
    content: run.instructionSummary,
  }];

  const steps = [...run.steps].sort((left, right) => left.sequence - right.sequence);
  const hasPersistedReasoning = events.some((event) => messageType(event) === 'reasoning_summary' || event.eventType === 'reasoning.delta');
  if (!hasPersistedReasoning) {
    steps.forEach((step) => {
      messages.push({
        id: `${run.runId}:reasoning:${step.stepId}`,
        runId: run.runId,
        type: 'reasoning_summary',
        createdAt: step.startedAt ?? run.updatedAt,
        title: '推理摘要',
        content: stepSummary(step),
        summary: `${step.label} · ${statusLabel(step.status)}`,
        status: step.status,
        collapsible: true,
      });
    });
  }

  const seenMessageIds = new Set<string>();
  const seenReasoningKeys = new Set<string>();
  let finalAnswerRendered = false;
  const hasPersistedFinalAnswer = events.some((event) => event.eventType !== 'assistant.delta' && messageType(event) === 'final_answer');
  mergeStreamingEvents(events, { ignoreAssistantDeltas: hasPersistedFinalAnswer }).sort((left, right) => left.sequence - right.sequence).forEach((event) => {
    if (!shouldProjectEvent(event)) return;
    if (event.eventType === 'workspace.message') return;
    if (event.eventType === 'message.appended' && messageType(event) === 'tool_event') return;
    const messageKind = messageType(event);
    if (messageKind === 'user_message') return;
    const messageId = typeof event.payload.messageId === 'string' ? event.payload.messageId : undefined;
    if (messageId && seenMessageIds.has(messageId)) return;
    if (messageId) seenMessageIds.add(messageId);
    if (messageKind === 'final_answer') {
      if (finalAnswerRendered) return;
      finalAnswerRendered = true;
    }
    // Pi emits the terminal step.succeeded event after persisting the final answer.
    // Keep the conversation surface ordered as user → one execution trace → final answer.
    if (messageKind === 'reasoning_summary' && finalAnswerRendered) return;
    const summary = typeof event.payload.summary === 'string' ? event.payload.summary : undefined;
    const content = typeof event.payload.content === 'string' ? event.payload.content : eventSummary(event);
    if (messageKind === 'reasoning_summary') {
      const reasoningKey = `${summary ?? ''}:${content}`;
      if (seenReasoningKeys.has(reasoningKey)) return;
      seenReasoningKeys.add(reasoningKey);
    }
    const toolName = messageKind === 'tool_event' && typeof event.payload.toolName === 'string' ? event.payload.toolName : undefined;
    messages.push({
      id: `${run.runId}:event:${event.sequence}`,
      runId: run.runId,
      type: messageKind ?? 'tool_event',
      createdAt: event.createdAt,
      title: messageKind === 'reasoning_summary' ? '推理摘要' : messageKind === 'final_answer' ? 'Agent' : (toolName ?? (summary || '工具事件')),
      content: messageKind === 'reasoning_summary' ? (content || summary || eventSummary(event)) : content,
      summary,
      eventType: event.eventType,
      sequence: event.sequence,
      status: safeStatus(event.payload) as WorkspaceMessageVM['status'],
      collapsible: messageKind === 'reasoning_summary',
    });
  });

  if (terminalStatuses.has(run.status) && !hasPersistedFinalAnswer) {
    const failed = run.status === 'failed' || run.status === 'cancelled' || run.status === 'expired';
    messages.push({
      id: `${run.runId}:final`,
      runId: run.runId,
      type: 'final_answer',
      createdAt: run.finishedAt ?? run.updatedAt,
      title: failed ? 'Run 结果' : 'Agent',
      content: run.errorCode ? `${run.errorCode}：${run.resultSummary ?? '本次 Run 未成功完成。'}` : (run.resultSummary ?? `Run ${statusLabel(run.status)}。`),
      status: run.status,
    });
  }

  return messages.sort((left, right) => {
    const semanticOrder: Record<WorkspaceMessageVM['type'], number> = { user_message: 0, reasoning_summary: 1, tool_event: 1, final_answer: 2 };
    const bySemanticOrder = semanticOrder[left.type] - semanticOrder[right.type];
    if (bySemanticOrder !== 0) return bySemanticOrder;
    const byTime = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return byTime || (left.sequence ?? 0) - (right.sequence ?? 0);
  });
}

function mergeStreamingEvents(events: WorkspaceRunEventVM[], options: { ignoreAssistantDeltas?: boolean } = {}): WorkspaceRunEventVM[] {
  const passthrough: WorkspaceRunEventVM[] = [];
  const streams = new Map<string, WorkspaceRunEventVM>();
  const append = (event: WorkspaceRunEventVM, type: WorkspaceMessageVM['type'], content: string, messageId: string, summary?: string) => {
    if (!content && type !== 'tool_event') return;
    const existing = streams.get(messageId);
    if (!existing) {
      streams.set(messageId, { ...event, eventType: event.eventType, payload: { ...event.payload, messageType: type, messageId, content, ...(summary ? { summary } : {}) } });
      return;
    }
    const previous = typeof existing.payload.content === 'string' ? existing.payload.content : '';
    existing.payload = { ...existing.payload, ...event.payload, content: type === 'tool_event' ? content : `${previous}${content}`, messageType: type, messageId, ...(summary ? { summary } : {}) };
    existing.eventType = event.eventType;
    existing.sequence = Math.max(existing.sequence, event.sequence);
    existing.createdAt = event.createdAt;
  };

  [...events].sort((left, right) => left.sequence - right.sequence).forEach((event) => {
    const payload = event.payload;
    if (event.eventType === 'reasoning.delta') {
      const messageId = typeof payload.messageId === 'string' ? payload.messageId : `${event.runId}:reasoning`;
      append(event, 'reasoning_summary', typeof payload.contentDelta === 'string' ? payload.contentDelta : '', messageId, '模型原生推理');
      return;
    }
    if (event.eventType === 'assistant.delta') {
      if (options.ignoreAssistantDeltas) return;
      const messageId = typeof payload.messageId === 'string' ? payload.messageId : `${event.runId}:assistant`;
      append(event, 'final_answer', typeof payload.contentDelta === 'string' ? payload.contentDelta : '', messageId);
      return;
    }
    if (event.eventType === 'tool.call.started' || event.eventType === 'tool.call.delta' || event.eventType === 'tool.call.completed' || event.eventType === 'tool.result') {
      const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : `${event.sequence}`;
      const messageId = `${event.runId}:tool:${toolCallId}`;
      const toolName = typeof payload.toolName === 'string' ? payload.toolName : 'tool';
      let content = `${toolName}`;
      if (event.eventType === 'tool.call.started') content = `已准备调用：${toolName}`;
      if (event.eventType === 'tool.call.delta') content = `正在准备调用：${toolName}`;
      if (event.eventType === 'tool.call.completed') content = `已选择工具：${toolName}`;
      if (event.eventType === 'tool.result') {
        const result = payload.result;
        const resultContent = result && typeof result === 'object' && !Array.isArray(result) && typeof (result as Record<string, unknown>).content === 'string'
          ? String((result as Record<string, unknown>).content)
          : typeof result === 'string' ? result : JSON.stringify(result ?? {});
        content = `工具结果：${resultContent}`;
      }
      append(event, 'tool_event', content, messageId, toolName);
      return;
    }
    passthrough.push(event);
  });
  return [...passthrough, ...streams.values()];
}
