import type { RunEventRecord, RunRecord, RunStatus, StepRecord, StepStatus, Store } from './domain.js';
import type { WorkspaceRuntime } from './workspace.js';
import { executeNativeWorkspaceRead } from './workspace-native-read.js';
import { prepareNativeWorkspaceWrite } from './workspace-native-write.js';
import type { WorkspaceCommandInput, WorkspaceCommandOrchestrator, WorkspaceModelToolResult } from './workspace-commands.js';
import { persistWorkspaceConfirmation } from './workspace-confirmation.js';
import { ModelClientService } from './model-client.js';
import type { PiSkillManager } from './pi-skills.js';

export const DEFAULT_PI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_PI_MODEL = 'gpt-4o-mini';
export const DEFAULT_PI_TIMEOUT_MS = 30_000;
export const DEFAULT_PI_WIRE_API: ModelWireApi = 'responses';

export type ModelWireApi = 'chat' | 'responses';

export type ModelMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type ModelMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export type ModelMessageContent = string | ModelMessageContentPart[];

export interface ModelToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export type ModelToolDefinition =
  | {
      type: 'function';
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }
  | {
      type: 'web_search';
    };

export interface ModelMessage {
  role: ModelMessageRole;
  content: ModelMessageContent;
  name?: string;
  toolCallId?: string;
  toolCalls?: ModelToolCall[];
}

export interface ModelCompletionRequest {
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /** Provider-declared reasoning level, when supported by the selected model. */
  reasoningEffort?: string;
  signal?: AbortSignal;
}

export interface ModelCompletionResult {
  content: string;
  model: string;
  usage?: Record<string, unknown>;
  toolCalls?: ModelToolCall[];
  webSearchUsed?: boolean;
}

export interface ModelToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  argumentsDelta?: string;
}

export interface ModelStreamHandlers {
  onTextDelta?: (delta: string) => void | Promise<void>;
  onReasoningDelta?: (delta: string) => void | Promise<void>;
  onToolCallDelta?: (delta: ModelToolCallDelta) => void | Promise<void>;
  onToolCall?: (call: ModelToolCall) => void | Promise<void>;
  onDone?: (result: ModelCompletionResult) => void | Promise<void>;
}

export interface ModelClient {
  /** Whether the selected transport can execute OpenAI's built-in web_search tool. */
  supportsWebSearch?: boolean;
  complete(input: ModelCompletionRequest): Promise<ModelCompletionResult>;
  stream?(input: ModelCompletionRequest, handlers: ModelStreamHandlers): Promise<ModelCompletionResult>;
}

export interface PiRuntimeConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  wireApi: ModelWireApi;
  reasoningEffort?: string;
}

export interface OpenAICompatibleModelClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  wireApi?: ModelWireApi;
  reasoningEffort?: string;
  fetchImpl?: typeof fetch;
}

export type PiModelErrorCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'MODEL_ABORTED'
  | 'MODEL_TIMEOUT'
  | 'MODEL_HTTP_ERROR'
  | 'MODEL_NETWORK_ERROR'
  | 'MODEL_INVALID_RESPONSE'
  | 'MODEL_TOOL_LOOP_EXCEEDED'
  | 'MODEL_UNSUPPORTED_TOOL';

export class PiModelClientError extends Error {
  readonly code: PiModelErrorCode;
  readonly status?: number;

  constructor(code: PiModelErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'PiModelClientError';
    this.code = code;
    this.status = status;
  }
}

export class OpenAICompatibleModelClient implements ModelClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly wireApi: ModelWireApi;
  private readonly fetchImpl: typeof fetch;
  readonly supportsWebSearch: boolean;

  constructor(private readonly options: OpenAICompatibleModelClientOptions) {
    if (!options.apiKey.trim()) throw new Error('PI_RUNTIME_API_KEY_REQUIRED');
    if (!options.model.trim()) throw new Error('PI_RUNTIME_MODEL_REQUIRED');
    this.wireApi = normalizeWireApi(options.wireApi);
    this.supportsWebSearch = this.wireApi === 'responses';
    this.endpoint = this.wireApi === 'responses' ? toResponsesEndpoint(options.baseUrl) : toChatCompletionsEndpoint(options.baseUrl);
    this.timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_PI_TIMEOUT_MS);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(input: ModelCompletionRequest): Promise<ModelCompletionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), this.timeoutMs);
    const onAbort = () => controller.abort('external');

    if (input.signal?.aborted) controller.abort('external');
    else input.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(this.wireApi === 'responses'
          ? toResponsesRequestBody(this.options.model, input, input.reasoningEffort ?? this.options.reasoningEffort)
          : toChatCompletionsRequestBody(this.options.model, input, input.reasoningEffort ?? this.options.reasoningEffort)),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new PiModelClientError('MODEL_HTTP_ERROR', `model provider returned HTTP ${response.status}`, response.status);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new PiModelClientError('MODEL_INVALID_RESPONSE', 'model provider returned invalid JSON');
      }

      const toolCalls = this.wireApi === 'responses' ? extractResponsesToolCalls(payload) : extractCompletionToolCalls(payload);
      const content = this.wireApi === 'responses' ? extractResponsesContent(payload) : extractCompletionContent(payload);
      if (!content && toolCalls.length === 0) throw new PiModelClientError('MODEL_INVALID_RESPONSE', 'model provider returned empty content');
      const record = isRecord(payload) ? payload : undefined;
      return {
        content,
        model: typeof record?.model === 'string' && record.model.trim() ? record.model : this.options.model,
        usage: isRecord(record?.usage) ? record.usage : undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        webSearchUsed: this.wireApi === 'responses' && extractResponsesWebSearchUsed(payload),
      };
    } catch (error) {
      if (error instanceof PiModelClientError) throw error;
      if (controller.signal.aborted) {
        if (input.signal?.aborted) throw new PiModelClientError('MODEL_ABORTED', 'model request aborted');
        throw new PiModelClientError('MODEL_TIMEOUT', `model request timed out after ${this.timeoutMs}ms`);
      }
      throw new PiModelClientError('MODEL_NETWORK_ERROR', 'model provider request failed');
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', onAbort);
    }
  }

  async stream(input: ModelCompletionRequest, handlers: ModelStreamHandlers = {}): Promise<ModelCompletionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), this.timeoutMs);
    const onAbort = () => controller.abort('external');
    if (input.signal?.aborted) controller.abort('external');
    else input.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          accept: 'text/event-stream, application/json',
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(this.wireApi === 'responses'
          ? { ...toResponsesRequestBody(this.options.model, input, input.reasoningEffort ?? this.options.reasoningEffort), stream: true }
          : { ...toChatCompletionsRequestBody(this.options.model, input, input.reasoningEffort ?? this.options.reasoningEffort), stream: true }),
        signal: controller.signal,
      });
      if (!response.ok) throw new PiModelClientError('MODEL_HTTP_ERROR', `model provider returned HTTP ${response.status}`, response.status);

      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!contentType.includes('text/event-stream') || !response.body) {
        let payload: unknown;
        try { payload = await response.json(); } catch { throw new PiModelClientError('MODEL_INVALID_RESPONSE', 'model provider returned invalid JSON'); }
        const result = this.resultFromPayload(payload);
        if (!result.content && !result.toolCalls?.length) throw new PiModelClientError('MODEL_INVALID_RESPONSE', 'model provider returned empty content');
        if (result.content) await handlers.onTextDelta?.(result.content);
        for (const call of result.toolCalls ?? []) await handlers.onToolCall?.(call);
        await handlers.onDone?.(result);
        return result;
      }

      const state = createStreamState(this.options.model);
      await consumeSse(response.body, async (eventType, payload) => {
        if (this.wireApi === 'responses') await handleResponsesStreamEvent(eventType, payload, state, handlers);
        else await handleChatStreamEvent(eventType, payload, state, handlers);
      });
      const result = finalizeStreamState(state, this.options.model, this.wireApi === 'responses');
      if (!result.content && !result.toolCalls?.length) throw new PiModelClientError('MODEL_INVALID_RESPONSE', 'model provider returned empty content');
      await handlers.onDone?.(result);
      return result;
    } catch (error) {
      if (error instanceof PiModelClientError) throw error;
      if (controller.signal.aborted) {
        if (input.signal?.aborted) throw new PiModelClientError('MODEL_ABORTED', 'model request aborted');
        throw new PiModelClientError('MODEL_TIMEOUT', `model request timed out after ${this.timeoutMs}ms`);
      }
      throw new PiModelClientError('MODEL_NETWORK_ERROR', 'model provider request failed');
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', onAbort);
    }
  }

  private resultFromPayload(payload: unknown): ModelCompletionResult {
    const toolCalls = this.wireApi === 'responses' ? extractResponsesToolCalls(payload) : extractCompletionToolCalls(payload);
    const content = this.wireApi === 'responses' ? extractResponsesContent(payload) : extractCompletionContent(payload);
    const record = isRecord(payload) ? payload : undefined;
    return {
      content,
      model: typeof record?.model === 'string' && record.model.trim() ? record.model : this.options.model,
      usage: isRecord(record?.usage) ? record.usage : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      webSearchUsed: this.wireApi === 'responses' && extractResponsesWebSearchUsed(payload),
    };
  }
}

export interface PiRuntimeEvent {
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export type PiRuntimeMessageType = 'user_message' | 'reasoning_summary' | 'tool_event' | 'final_answer';

export interface PiRuntimeMessage {
  adminId?: string;
  sessionId: string;
  runId: string;
  messageType: PiRuntimeMessageType;
  content: string;
  summary?: string;
}

export interface PiRuntimeAdapterOptions {
  model?: string;
  outputLimit?: number;
  redactSecrets?: string[];
  persistUserMessage?: boolean;
  resolveModelClient?: (input: { adminId?: string; accountId: string }) => Promise<ModelClient | undefined>;
  messageSink?: (message: PiRuntimeMessage) => void | Promise<void>;
  onEvent?: (event: PiRuntimeEvent) => void | Promise<void>;
  workspaceCommands?: WorkspaceCommandOrchestrator;
  skillManager?: PiSkillManager;
}

export interface PiRuntimeEnqueueInput {
  adminId?: string;
  run: RunRecord;
  steps: StepRecord[];
  sessionId?: string;
  history?: ModelMessage[];
}

const WORKSPACE_AGENT_SYSTEM_PROMPT = [
  '你是 Workspace Agent。请根据工具契约自主选择工具，并始终以工具返回的真实结果为依据。',
  '需要查询具体商品名称或外部编号时，优先使用 workspace_product_search，不要先加载完整商品列表。',
  '取消、下架、更新、发布、发货或其他写入操作必须使用 workspace_prepare_write，并等待用户确认；不要用 workspace_read 代替写操作。',
  'Pi Skill 的登录状态按管理员和 Skill 持久化：已授权时复用已有状态，除非 Skill 返回 requiresLogin 或用户明确要求重新登录，否则不要再次调用 pi_skill_login。',
  '只为安装调用 pi_skill_install，只为登录调用 pi_skill_login，只能使用 Skill 明确记录的命令调用 pi_skill_exec；不要把 bash、install 等 shell 命令传给 pi_skill_exec。',
  '如果 Skill 返回 requiresLogin、unauthorized、pending_user_action 或 userActionRequired，不要重复原命令；最多发起一次登录流程，或直接返回用户需要完成的操作，然后停止工具执行。',
  '工具返回后，要么基于结果回答，要么只在结果明确要求修正时选择其他工具。没有拿到工具结果时，不要声称工具已经执行。',
  '最终答复简洁、准确，并且只基于当前上下文和工具结果。',
].join('\n');

const WORKSPACE_LANGUAGE_INSTRUCTIONS: Record<WorkspaceResponseLanguage, string> = {
  'zh-CN': [
    '输出语言规则（最高优先级）：当前用户消息包含中文字符时，思考摘要、工具调用说明、工具结果说明和最终答复全部使用简体中文。',
    '不要因为工具名、字段名、历史消息或系统提示中出现英文而切换成英文；工具名、字段名、代码和 API 名称可以原样保留。',
  ].join('\n'),
  en: [
    'Response language rule (highest priority): when the current user message does not contain Chinese characters, write reasoning summaries, tool explanations, tool-result explanations, and the final answer in English.',
    'Keep tool names, field names, code, and API names unchanged when needed.',
  ].join('\n'),
};

export type WorkspaceResponseLanguage = 'zh-CN' | 'en';

export function detectWorkspaceResponseLanguage(instruction: string): WorkspaceResponseLanguage {
  return /[\u3400-\u9fff]/u.test(instruction) ? 'zh-CN' : 'en';
}

export function buildWorkspaceModelMessages(history: ModelMessage[], instruction: string, skillPrompt = ''): ModelMessage[] {
  const messages: ModelMessage[] = [...history];
  const languagePrompt = WORKSPACE_LANGUAGE_INSTRUCTIONS[detectWorkspaceResponseLanguage(instruction)];
  if (messages.some((message) => message.role === 'system')) {
    // Keep caller-provided system context, but place the language rule before
    // conversation history so the current user's language wins consistently.
    const firstNonSystem = messages.findIndex((message) => message.role !== 'system');
    messages.splice(firstNonSystem < 0 ? messages.length : firstNonSystem, 0, { role: 'system', content: languagePrompt });
  } else {
    messages.unshift({ role: 'system', content: [WORKSPACE_AGENT_SYSTEM_PROMPT, skillPrompt, languagePrompt].filter(Boolean).join('\n\n') });
  }
  messages.push({ role: 'user', content: instruction });
  return messages;
}

const runTransitions: Record<RunStatus, RunStatus[]> = {
  queued: ['running', 'cancelled', 'expired'],
  running: ['waiting_confirmation', 'executing', 'failed', 'cancelled'],
  waiting_confirmation: ['executing', 'cancelled', 'expired'],
  executing: ['waiting_confirmation', 'succeeded', 'partially_succeeded', 'failed', 'cancelling'],
  retrying: ['running', 'failed', 'cancelled'],
  cancelling: ['cancelled', 'failed'],
  succeeded: [],
  partially_succeeded: [],
  failed: ['retrying'],
  cancelled: [],
  expired: [],
};

const stepTransitions: Record<StepStatus, StepStatus[]> = {
  pending: ['running', 'cancelled', 'skipped'],
  running: ['waiting_confirmation', 'executing', 'succeeded', 'failed', 'cancelled'],
  waiting_confirmation: ['executing', 'cancelled'],
  executing: ['waiting_confirmation', 'succeeded', 'partially_succeeded', 'failed', 'cancelled'],
  retrying: ['running', 'failed', 'cancelled'],
  succeeded: [],
  partially_succeeded: [],
  failed: ['retrying'],
  skipped: [],
  cancelled: [],
};

export class PiRuntimeAdapter implements WorkspaceRuntime {
  private readonly active = new Map<string, AbortController>();
  private stopped = false;

  constructor(
    private readonly store: Store,
    private readonly modelClient: ModelClient,
    private readonly options: PiRuntimeAdapterOptions = {},
  ) {}

  enqueue(input: PiRuntimeEnqueueInput): void {
    if (this.stopped || this.active.has(input.run.id)) return;
    const controller = new AbortController();
    this.active.set(input.run.id, controller);
    void this.execute(input, controller.signal).catch(() => {
      // The execution path records a safe failure event. Keep enqueue fire-and-forget.
    }).finally(() => this.active.delete(input.run.id));
  }

  stop(): void {
    this.stopped = true;
    for (const controller of this.active.values()) controller.abort();
  }

  private async execute(input: PiRuntimeEnqueueInput, signal: AbortSignal): Promise<void> {
    const step = input.steps[0];
    if (!step || this.stopped) return;
    try {
      const sessionId = input.sessionId ?? input.run.sessionId;
      if (this.options.persistUserMessage !== false) await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'user_message', content: redactSensitiveText(input.run.instruction, this.options.outputLimit ?? 2_000, this.options.redactSecrets) });
      const startedAt = new Date().toISOString();
      await this.transitionRun(input.run, 'running', { startedAt });
      await this.transitionStep(step, 'running', { startedAt });
      await this.emit(input.run.id, 'run.started', { status: 'running' });
      await this.emit(input.run.id, 'step.started', { stepId: step.id, status: 'running' });
      await this.emit(input.run.id, 'runtime.started', { status: 'running', model: this.options.model, messageType: 'tool_event' });

      const modelClient = await this.options.resolveModelClient?.({
        adminId: input.adminId ?? input.run.requestedBy,
        accountId: input.run.accountId,
      }) ?? this.modelClient;
      const skillInstruction = await this.options.skillManager?.handleInstruction({ adminId: input.adminId ?? input.run.requestedBy, instruction: input.run.instruction });
      if (skillInstruction) {
        const output = redactSensitiveText(skillInstruction.content, this.options.outputLimit ?? 2_000, this.options.redactSecrets);
        await this.transitionRun(input.run, 'executing');
        await this.transitionStep(step, 'executing');
        await this.emit(input.run.id, 'run.executing', { status: 'executing', messageType: 'tool_event', resource: 'pi_skill' });
        await this.emit(input.run.id, 'step.executing', { stepId: step.id, status: 'executing', messageType: 'tool_event', resource: 'pi_skill' });
        const finishedAt = new Date().toISOString();
        await this.transitionStep(step, 'succeeded', { finishedAt, outputSummary: skillInstruction.summary });
        await this.transitionRun(input.run, 'succeeded', { finishedAt, resultSummary: output });
        await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'tool_event', content: output, summary: skillInstruction.title });
        await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'final_answer', content: output });
        await this.emit(input.run.id, 'workspace.skill.lifecycle', { status: 'succeeded', title: skillInstruction.title, summary: skillInstruction.summary, data: skillInstruction.data });
        await this.emit(input.run.id, 'runtime.succeeded', { status: 'succeeded', model: this.options.model, messageType: 'final_answer', content: output, resource: 'pi_skill' });
        await this.emit(input.run.id, 'run.succeeded', { status: 'succeeded', resultSummary: output, messageType: 'final_answer', content: output, resource: 'pi_skill' });
        return;
      }
      if (modelClient.stream && this.options.workspaceCommands) {
        await this.executeModelDriven(input, step, sessionId, modelClient, signal);
        return;
      }

      const nativeWrite = this.options.workspaceCommands
        ? await this.options.workspaceCommands.prepareWrite({ adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: input.run.instruction, requestId: `workspace:${input.run.id}`, traceId: `workspace:${input.run.id}` })
        : await prepareNativeWorkspaceWrite({ store: this.store, adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: input.run.instruction });
      if (nativeWrite) {
        await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'reasoning_summary', content: nativeWrite.summary, summary: nativeWrite.title });
        await this.transitionStep(step, 'waiting_confirmation', { outputSummary: nativeWrite.summary });
        await this.transitionRun(input.run, 'waiting_confirmation', { resultSummary: nativeWrite.summary });
        const confirmation = await persistWorkspaceConfirmation({ store: this.store, adminId: input.adminId ?? input.run.requestedBy, sessionId, run: input.run, step, plan: nativeWrite });
        await this.emit(input.run.id, 'workspace.confirmation.created', { status: 'active', confirmationId: confirmation.id, action: confirmation.action, policyRef: confirmation.policyRef, manifest: confirmation.manifest, expiresAt: confirmation.expiresAt });
        return;
      }

      await this.transitionRun(input.run, 'executing');
      await this.transitionStep(step, 'executing');
      await this.emit(input.run.id, 'run.executing', { status: 'executing', messageType: 'tool_event' });
      await this.emit(input.run.id, 'step.executing', { stepId: step.id, status: 'executing', messageType: 'tool_event' });
      await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'reasoning_summary', content: '已识别为受控工作区命令，正在读取真实数据。', summary: '执行工作区命令' });

      const nativeRead = this.options.workspaceCommands
        ? await this.options.workspaceCommands.execute({ adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: input.run.instruction, requestId: `workspace:${input.run.id}`, traceId: `workspace:${input.run.id}` })
        : await executeNativeWorkspaceRead({ store: this.store, adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: input.run.instruction });
      if (nativeRead) {
        const sessionId = input.sessionId ?? input.run.sessionId;
        await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'tool_event', content: nativeRead.content, summary: nativeRead.summary });
        const commandResult = 'mutation' in nativeRead && nativeRead.mutation;
        await this.emit(input.run.id, commandResult ? 'workspace.command.executed' : 'workspace.native_read', { messageType: 'tool_event', resource: nativeRead.kind, operation: 'operation' in nativeRead ? nativeRead.operation : undefined, summary: nativeRead.summary, data: nativeRead.data });
        const finishedAt = new Date().toISOString();
        await this.transitionStep(step, 'succeeded', { finishedAt, outputSummary: nativeRead.summary });
        await this.transitionRun(input.run, 'succeeded', { finishedAt, resultSummary: nativeRead.content });
        await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'final_answer', content: nativeRead.content });
        await this.emit(input.run.id, 'runtime.succeeded', { status: 'succeeded', model: this.options.model, messageType: 'final_answer', content: nativeRead.content, resource: nativeRead.kind });
        await this.emit(input.run.id, 'run.succeeded', { status: 'succeeded', resultSummary: nativeRead.content, messageType: 'final_answer', content: nativeRead.content, resource: nativeRead.kind });
        return;
      }

      await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'reasoning_summary', content: '未匹配到内置工作区命令，正在调用模型生成回复。', summary: '调用模型' });
      const result = await modelClient.complete({
        messages: buildWorkspaceModelMessages(input.history ?? [], input.run.instruction),
        signal,
      });
      if (this.stopped || signal.aborted) return;

      const finishedAt = new Date().toISOString();
      const output = redactSensitiveText(result.content, this.options.outputLimit ?? 2_000, this.options.redactSecrets);
      await this.transitionStep(step, 'succeeded', { finishedAt, outputSummary: output });
      await this.transitionRun(input.run, 'succeeded', { finishedAt, resultSummary: output });
      await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'reasoning_summary', content: `模型 ${result.model} 已返回结果，正在整理回复。`, summary: '整理模型结果' });
      await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'final_answer', content: output });
      await this.emit(input.run.id, 'step.succeeded', { stepId: step.id, status: 'succeeded', messageType: 'reasoning_summary', summary: step.label });
      await this.emit(input.run.id, 'runtime.succeeded', { status: 'succeeded', model: result.model, messageType: 'final_answer', content: output });
      await this.emit(input.run.id, 'run.succeeded', { status: 'succeeded', resultSummary: output, messageType: 'final_answer', content: output });
    } catch (error) {
      if (this.stopped && signal.aborted) return;
      await this.recordFailure(input, step, error);
    }
  }

  private async executeModelDriven(input: PiRuntimeEnqueueInput, step: StepRecord, sessionId: string, modelClient: ModelClient, signal: AbortSignal): Promise<void> {
    const commands = this.options.workspaceCommands;
    if (!commands?.getModelTools || !commands.executeModelTool || !modelClient.stream) throw new Error('MODEL_TOOL_RUNTIME_UNAVAILABLE');
    await this.transitionRun(input.run, 'executing');
    await this.transitionStep(step, 'executing');
    await this.emit(input.run.id, 'run.executing', { status: 'executing', messageType: 'tool_event' });
    await this.emit(input.run.id, 'step.executing', { stepId: step.id, status: 'executing', messageType: 'tool_event' });

    const tools = [...commands.getModelTools(), ...(this.options.skillManager?.getModelTools() ?? [])];
    const skillPrompt = this.options.skillManager ? await this.options.skillManager.buildSystemPrompt(input.adminId ?? input.run.requestedBy) : '';
    const messages = buildWorkspaceModelMessages(input.history ?? [], input.run.instruction, skillPrompt);

    const allReasoning: string[] = [];
    let finalResult: ModelCompletionResult | undefined;
    let waitingConfirmation = false;
    let pendingUserAction: { title: string; summary: string; content: string; data?: Record<string, unknown> } | undefined;
    let completedWithoutTool = false;
    const maxRounds = 8;
    for (let round = 0; round < maxRounds; round += 1) {
      if (this.stopped || signal.aborted) return;
      const streamId = `${input.run.id}:stream:${round + 1}`;
      const reasoningMessageId = `${streamId}:reasoning`;
      const assistantMessageId = `${streamId}:assistant`;
      let reasoning = '';
      let assistant = '';
      const toolCallNames = new Map<number, string>();
      await this.emit(input.run.id, 'stream.started', { streamId, round: round + 1, model: this.options.model, status: 'running' });
      const result = await modelClient.stream({ messages, tools, toolChoice: 'auto', signal }, {
        onReasoningDelta: async (delta) => {
          reasoning += delta;
          allReasoning.push(delta);
          await this.emit(input.run.id, 'reasoning.delta', { streamId, messageId: reasoningMessageId, contentDelta: redactSensitiveText(delta, 2_000, this.options.redactSecrets), messageType: 'reasoning_summary', status: 'running' });
        },
        onTextDelta: async (delta) => {
          assistant += delta;
          await this.emit(input.run.id, 'assistant.delta', { streamId, messageId: assistantMessageId, contentDelta: redactSensitiveText(delta, 4_000, this.options.redactSecrets), messageType: 'final_answer', status: 'running' });
        },
        onToolCallDelta: async (delta) => {
          if (delta.name) toolCallNames.set(delta.index, delta.name);
          await this.emit(input.run.id, 'tool.call.delta', { streamId, toolCallId: delta.id, toolName: delta.name ?? toolCallNames.get(delta.index), index: delta.index, argumentsDelta: redactSensitiveText(delta.argumentsDelta ?? '', 4_000, this.options.redactSecrets), status: 'streaming' });
        },
        onToolCall: async (call) => {
          await this.emit(input.run.id, 'tool.call.completed', { streamId, toolCallId: call.id, toolName: call.function.name, arguments: redactSensitiveText(call.function.arguments, 4_000, this.options.redactSecrets), status: 'selected' });
        },
      });
      finalResult = result;
      if (reasoning) await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'reasoning_summary', content: redactSensitiveText(reasoning, 8_000, this.options.redactSecrets), summary: '模型原生推理' });
      const calls = result.toolCalls ?? [];
      if (calls.length === 0) {
        completedWithoutTool = true;
        break;
      }

      messages.push({ role: 'assistant', content: result.content ?? assistant, toolCalls: calls });
      for (const call of calls) {
        const toolStartedAt = new Date().toISOString();
        await this.emit(input.run.id, 'tool.call.started', { streamId, toolCallId: call.id, toolName: call.function.name, arguments: redactSensitiveText(call.function.arguments, 4_000, this.options.redactSecrets), startedAt: toolStartedAt, status: 'running' });
        let args: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(call.function.arguments || '{}');
          if (!isRecord(parsed) || Array.isArray(parsed)) throw new Error('invalid tool arguments');
          args = parsed;
        } catch {
          const errorResult = { ok: false, code: 'INVALID_TOOL_ARGUMENTS' };
          await this.emit(input.run.id, 'tool.result', { streamId, toolCallId: call.id, toolName: call.function.name, status: 'failed', result: errorResult });
          messages.push({ role: 'tool', name: call.function.name, toolCallId: call.id, content: JSON.stringify(errorResult) });
          continue;
        }
        let result: WorkspaceModelToolResult;
        try {
          const toolInput: WorkspaceCommandInput = { adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: input.run.instruction, requestId: `workspace:${input.run.id}`, traceId: `workspace:${input.run.id}` };
          result = this.options.skillManager && call.function.name.startsWith('pi_skill_')
            ? await this.options.skillManager.executeModelTool(call.function.name, args, toolInput)
            : await commands.executeModelTool(call.function.name, args, toolInput);
        } catch (error) {
          const failure = toSafeFailure(error);
          const errorResult = toolFailureResult(failure);
          await this.emit(input.run.id, 'tool.result', { streamId, toolCallId: call.id, toolName: call.function.name, status: 'failed', result: errorResult, completedAt: new Date().toISOString() });
          messages.push({ role: 'tool', name: call.function.name, toolCallId: call.id, content: JSON.stringify(errorResult) });
          continue;
        }
        const redacted = this.redactToolResult(result);
        await this.emit(input.run.id, 'tool.result', { streamId, toolCallId: call.id, toolName: call.function.name, status: 'succeeded', result: redacted, completedAt: new Date().toISOString() });
        messages.push({ role: 'tool', name: call.function.name, toolCallId: call.id, content: JSON.stringify(redacted) });
        const resultData = result.data;
        if (resultData && (resultData.status === 'pending_user_action' || resultData.userActionRequired === true)) {
          pendingUserAction = { title: result.title, summary: result.summary, content: result.content, data: resultData };
          break;
        }
        if (result.kind === 'write_plan' && result.plan) {
          const confirmation = await persistWorkspaceConfirmation({ store: this.store, adminId: input.adminId ?? input.run.requestedBy, sessionId, run: input.run, step, plan: result.plan });
          await this.transitionStep(step, 'waiting_confirmation', { outputSummary: result.plan.summary });
          await this.transitionRun(input.run, 'waiting_confirmation', { resultSummary: result.plan.summary });
          await this.emit(input.run.id, 'workspace.confirmation.created', { status: 'active', confirmationId: confirmation.id, action: confirmation.action, policyRef: confirmation.policyRef, manifest: confirmation.manifest, expiresAt: confirmation.expiresAt });
          waitingConfirmation = true;
          break;
        }
      }
      await this.emit(input.run.id, 'stream.round.completed', { streamId, round: round + 1, toolCallCount: calls.length, status: waitingConfirmation ? 'waiting_confirmation' : pendingUserAction ? 'pending_user_action' : 'tool_completed' });
      if (waitingConfirmation) break;
      if (pendingUserAction) break;
    }

    if (waitingConfirmation) {
      await this.emit(input.run.id, 'stream.completed', { status: 'waiting_confirmation', model: finalResult?.model ?? this.options.model, reasoningMessageCount: allReasoning.length });
      return;
    }
    if (pendingUserAction) {
      const output = redactSensitiveText(pendingUserAction.content, this.options.outputLimit ?? 2_000, this.options.redactSecrets);
      const finishedAt = new Date().toISOString();
      await this.transitionStep(step, 'succeeded', { finishedAt, outputSummary: pendingUserAction.summary });
      await this.transitionRun(input.run, 'succeeded', { finishedAt, resultSummary: output });
      await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'final_answer', content: output });
      await this.emit(input.run.id, 'workspace.skill.lifecycle', { status: 'pending_user_action', title: pendingUserAction.title, summary: pendingUserAction.summary, data: pendingUserAction.data ?? {} });
      await this.emit(input.run.id, 'stream.completed', { status: 'succeeded', model: finalResult?.model ?? this.options.model, content: output, reasoningMessageCount: allReasoning.length });
      await this.emit(input.run.id, 'step.succeeded', { stepId: step.id, status: 'succeeded', messageType: 'final_answer', summary: step.label });
      await this.emit(input.run.id, 'runtime.succeeded', { status: 'succeeded', model: finalResult?.model ?? this.options.model, messageType: 'final_answer', content: output, resource: 'pi_skill' });
      await this.emit(input.run.id, 'run.succeeded', { status: 'succeeded', resultSummary: output, messageType: 'final_answer', content: output, resource: 'pi_skill' });
      return;
    }
    if (!completedWithoutTool) throw new PiModelClientError('MODEL_TOOL_LOOP_EXCEEDED', `model tool loop exceeded ${maxRounds} rounds`);
    if (!finalResult) throw new PiModelClientError('MODEL_INVALID_RESPONSE', 'model provider returned no result');
    const output = redactSensitiveText(finalResult.content, this.options.outputLimit ?? 2_000, this.options.redactSecrets);
    const finishedAt = new Date().toISOString();
    await this.transitionStep(step, 'succeeded', { finishedAt, outputSummary: output });
    await this.transitionRun(input.run, 'succeeded', { finishedAt, resultSummary: output });
    await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'final_answer', content: output });
    await this.emit(input.run.id, 'stream.completed', { status: 'succeeded', model: finalResult.model, content: output, reasoningMessageCount: allReasoning.length });
    await this.emit(input.run.id, 'step.succeeded', { stepId: step.id, status: 'succeeded', messageType: 'final_answer', summary: step.label });
    await this.emit(input.run.id, 'runtime.succeeded', { status: 'succeeded', model: finalResult.model, messageType: 'final_answer', content: output });
    await this.emit(input.run.id, 'run.succeeded', { status: 'succeeded', resultSummary: output, messageType: 'final_answer', content: output });
  }

  private redactToolResult(result: WorkspaceModelToolResult): Record<string, unknown> {
    return {
      ok: true,
      kind: result.kind,
      title: result.title,
      summary: result.summary,
      content: redactSensitiveText(result.content, this.options.outputLimit ?? 2_000, this.options.redactSecrets),
      ...(result.data ? { data: redactSensitiveText(JSON.stringify(result.data), this.options.outputLimit ?? 2_000, this.options.redactSecrets) } : {}),
      ...(result.plan ? { requiresConfirmation: true, action: result.plan.action, policyRef: result.plan.policyRef, manifest: result.plan.manifest } : {}),
    };
  }

  private async recordFailure(input: PiRuntimeEnqueueInput, step: StepRecord, error: unknown): Promise<void> {
    const run = input.run;
    const failure = toSafeFailure(error);
    const finishedAt = new Date().toISOString();
    try {
      if (step.status !== 'failed') await this.transitionStep(step, 'failed', { finishedAt, errorCode: failure.code, outputSummary: failure.summary });
      if (run.status !== 'failed') await this.transitionRun(run, 'failed', { finishedAt, errorCode: failure.code });
      const sessionId = input.sessionId ?? run.sessionId;
      await this.persistMessage({ adminId: input.adminId, sessionId, runId: run.id, messageType: 'reasoning_summary', content: failure.summary, summary: `运行失败：${failure.code}` });
      await this.persistMessage({ adminId: input.adminId, sessionId, runId: run.id, messageType: 'final_answer', content: failure.summary });
      await this.emit(run.id, 'step.failed', { stepId: step.id, status: 'failed', errorCode: failure.code, messageType: 'tool_event' });
      await this.emit(run.id, 'runtime.failed', { status: 'failed', errorCode: failure.code, messageType: 'final_answer', content: failure.summary });
      await this.emit(run.id, 'run.failed', { status: 'failed', errorCode: failure.code, messageType: 'final_answer', content: failure.summary });
    } catch {
      // Store failures must not surface provider details or crash the host process.
    }
  }

  private async persistMessage(message: PiRuntimeMessage): Promise<void> {
    const payload = { messageType: message.messageType, content: message.content, ...(message.summary ? { summary: message.summary } : {}) };
    try {
      await this.store.appendRunEvent({ runId: message.runId, eventType: 'workspace.message', payload });
    } catch {
      // Message events are supplemental; preserve the Run state if event storage is unavailable.
    }
    try {
      await this.options.messageSink?.(message);
    } catch {
      // Persistence callbacks are best-effort and must not fail the model execution.
    }
  }

  private async transitionRun(run: RunRecord, next: RunStatus, patch: { startedAt?: string; finishedAt?: string; resultSummary?: string; errorCode?: string } = {}): Promise<void> {
    if (run.status !== next && !runTransitions[run.status].includes(next)) throw new Error(`INVALID_RUN_TRANSITION:${run.status}->${next}`);
    run.status = next;
    Object.assign(run, patch);
    await this.store.updateRun(run.id, { status: next, ...patch });
  }

  private async transitionStep(step: StepRecord, next: StepStatus, patch: { startedAt?: string; finishedAt?: string; outputSummary?: string; errorCode?: string } = {}): Promise<void> {
    if (step.status !== next && !stepTransitions[step.status].includes(next)) throw new Error(`INVALID_STEP_TRANSITION:${step.status}->${next}`);
    step.status = next;
    Object.assign(step, patch);
    await this.store.updateRunStep(step.id, { status: next, ...patch });
  }

  private async emit(runId: string, eventType: string, payload: Record<string, unknown>): Promise<RunEventRecord> {
    const event = await this.store.appendRunEvent({ runId, eventType, payload });
    try {
      await this.options.onEvent?.({ runId, eventType, payload: { ...payload } });
    } catch {
      // Observability callbacks are best-effort and must not alter the Run outcome.
    }
    return event;
  }
}

export function loadPiRuntimeConfig(env: NodeJS.ProcessEnv = process.env): PiRuntimeConfig | undefined {
  const apiKey = firstNonEmpty(env.API_KEY, env.OPENAI_API_KEY, env.PI_API_KEY);
  if (!apiKey) return undefined;
  return {
    apiKey,
    baseUrl: firstNonEmpty(env.BASE_URL, env.OPENAI_BASE_URL, env.PI_BASE_URL) ?? DEFAULT_PI_BASE_URL,
    model: firstNonEmpty(env.MODEL, env.OPENAI_MODEL, env.PI_MODEL) ?? DEFAULT_PI_MODEL,
    timeoutMs: positiveInteger(env.PI_RUNTIME_TIMEOUT_MS ?? env.MODEL_TIMEOUT_MS, DEFAULT_PI_TIMEOUT_MS),
    wireApi: normalizeWireApi(firstNonEmpty(env.WIRE_API, env.MODEL_WIRE_API)),
    ...(firstNonEmpty(env.REASONING_EFFORT, env.OPENAI_REASONING_EFFORT, env.PI_REASONING_EFFORT)
      ? { reasoningEffort: firstNonEmpty(env.REASONING_EFFORT, env.OPENAI_REASONING_EFFORT, env.PI_REASONING_EFFORT) }
      : {}),
  };
}

export function createPiRuntimeAdapterFromEnv(store: Store, env: NodeJS.ProcessEnv = process.env): PiRuntimeAdapter | undefined {
  const config = loadPiRuntimeConfig(env);
  const modelClient = createModelClientServiceFromEnv(env);
  if (!config || !modelClient) return undefined;
  return new PiRuntimeAdapter(store, modelClient, { model: config.model, redactSecrets: [config.apiKey] });
}

export function createModelClientServiceFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClientService | undefined {
  const primaryConfig = loadPiRuntimeConfig(env);
  if (!primaryConfig) return undefined;
  const primary = new OpenAICompatibleModelClient(primaryConfig);
  const backupConfig = loadBackupPiRuntimeConfig(env);
  const backup = backupConfig ? new OpenAICompatibleModelClient(backupConfig) : undefined;
  return new ModelClientService({ primary, backup });
}

export function toChatCompletionsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('PI_RUNTIME_BASE_URL_REQUIRED');
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (normalized.endsWith('/responses')) return `${normalized.slice(0, -'/responses'.length)}/chat/completions`;
  return normalized.endsWith('/v1') ? `${normalized}/chat/completions` : `${normalized}/v1/chat/completions`;
}

export function toResponsesEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('PI_RUNTIME_BASE_URL_REQUIRED');
  if (normalized.endsWith('/responses')) return normalized;
  if (normalized.endsWith('/chat/completions')) return `${normalized.slice(0, -'/chat/completions'.length)}/responses`;
  return normalized.endsWith('/v1') ? `${normalized}/responses` : `${normalized}/v1/responses`;
}

function normalizeWireApi(value: string | undefined): ModelWireApi {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'chat') return 'chat';
  if (normalized === 'responses') return 'responses';
  return DEFAULT_PI_WIRE_API;
}

function loadBackupPiRuntimeConfig(env: NodeJS.ProcessEnv): PiRuntimeConfig | undefined {
  const apiKey = firstNonEmpty(env.BACKUP_API_KEY, env.SECONDARY_API_KEY);
  const baseUrl = firstNonEmpty(env.BACKUP_BASE_URL, env.SECONDARY_BASE_URL);
  const model = firstNonEmpty(env.BACKUP_MODEL, env.SECONDARY_MODEL);
  if (!apiKey || !baseUrl || !model) return undefined;
  return loadPiRuntimeConfig({
    API_KEY: apiKey,
    BASE_URL: baseUrl,
    MODEL: model,
    WIRE_API: firstNonEmpty(env.BACKUP_WIRE_API, env.BACKUP_MODEL_WIRE_API),
    MODEL_TIMEOUT_MS: firstNonEmpty(env.BACKUP_MODEL_TIMEOUT_MS, env.MODEL_TIMEOUT_MS),
    REASONING_EFFORT: firstNonEmpty(env.BACKUP_REASONING_EFFORT),
  });
}

function toChatCompletionsRequestBody(model: string, input: ModelCompletionRequest, reasoningEffort?: string): Record<string, unknown> {
  if (input.tools?.some((tool) => tool.type === 'web_search')) {
    throw new PiModelClientError('MODEL_UNSUPPORTED_TOOL', 'web_search requires the Responses API');
  }
  const functionTools = input.tools?.filter((tool): tool is Extract<ModelToolDefinition, { type: 'function' }> => tool.type === 'function');
  return {
    model,
    messages: input.messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.name ? { name: message.name } : {}),
      ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      ...(message.toolCalls ? { tool_calls: message.toolCalls } : {}),
    })),
    ...(functionTools?.length ? { tools: functionTools } : {}),
    ...(input.toolChoice ? { tool_choice: input.toolChoice } : {}),
    ...(normalizeReasoningEffort(reasoningEffort) ? { reasoning_effort: normalizeReasoningEffort(reasoningEffort) } : {}),
  };
}

function toResponsesRequestBody(model: string, input: ModelCompletionRequest, reasoningEffort?: string): Record<string, unknown> {
  return {
    model,
    input: input.messages.flatMap(toResponsesInputItems),
    ...(input.tools?.length ? { tools: input.tools.map(toResponsesToolDefinition) } : {}),
    ...(input.toolChoice ? { tool_choice: toResponsesToolChoice(input.toolChoice) } : {}),
    ...(normalizeReasoningEffort(reasoningEffort) ? { reasoning: { effort: normalizeReasoningEffort(reasoningEffort) } } : {}),
  };
}

function normalizeReasoningEffort(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function toResponsesInputItems(message: ModelMessage): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  if (message.content) {
    items.push({
      type: 'message',
      role: message.role === 'tool' ? 'user' : message.role,
      content: toResponsesContent(message.content),
      ...(message.name ? { name: message.name } : {}),
    });
  }
  if (message.toolCalls?.length) {
    for (const call of message.toolCalls) {
      items.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    }
  }
  if (message.role === 'tool') {
    items.length = 0;
    items.push({ type: 'function_call_output', call_id: message.toolCallId ?? 'unknown', output: modelContentToText(message.content) });
  }
  return items;
}

function toResponsesContent(content: ModelMessageContent): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content;
  return content.map((part) => part.type === 'text'
    ? { type: 'input_text', text: part.text }
    : { type: 'input_image', image_url: part.image_url.url, ...(part.image_url.detail ? { detail: part.image_url.detail } : {}) });
}

function modelContentToText(content: ModelMessageContent): string {
  if (typeof content === 'string') return content;
  return content.filter((part): part is { type: 'text'; text: string } => part.type === 'text').map((part) => part.text).join('\n');
}

interface StreamState {
  content: string;
  reasoning: string;
  model: string;
  usage?: Record<string, unknown>;
  toolCalls: Map<number, { id: string; name: string; arguments: string }>;
  webSearchUsed: boolean;
  emittedText: boolean;
}

function createStreamState(model: string): StreamState {
  return { content: '', reasoning: '', model, toolCalls: new Map(), webSearchUsed: false, emittedText: false };
}

function finalizeStreamState(state: StreamState, fallbackModel: string, responses: boolean): ModelCompletionResult {
  return {
    content: state.content.trim(),
    model: state.model || fallbackModel,
    usage: state.usage,
    toolCalls: state.toolCalls.size > 0 ? [...state.toolCalls.entries()].sort(([left], [right]) => left - right).map(([, value]) => ({ id: value.id, type: 'function' as const, function: { name: value.name, arguments: value.arguments } })) : undefined,
    webSearchUsed: responses ? state.webSearchUsed : undefined,
  };
}

async function handleChatStreamEvent(eventType: string | undefined, payload: unknown, state: StreamState, handlers: ModelStreamHandlers): Promise<void> {
  if (!isRecord(payload)) return;
  if (typeof payload.model === 'string' && payload.model.trim()) state.model = payload.model;
  if (isRecord(payload.usage)) state.usage = payload.usage;
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choice = isRecord(choices[0]) ? choices[0] : undefined;
  const delta = choice && isRecord(choice.delta) ? choice.delta : undefined;
  if (!delta) return;

  const text = extractDeltaText(delta.content);
  if (text) {
    state.content += text;
    state.emittedText = true;
    await handlers.onTextDelta?.(text);
  }
  const reasoning = firstString(delta.reasoning_content, delta.reasoning, delta.reasoning_summary);
  if (reasoning) {
    state.reasoning += reasoning;
    await handlers.onReasoningDelta?.(reasoning);
  }
  if (Array.isArray(delta.tool_calls)) {
    for (const candidate of delta.tool_calls) {
      if (!isRecord(candidate)) continue;
      const index = typeof candidate.index === 'number' ? candidate.index : state.toolCalls.size;
      const current = state.toolCalls.get(index) ?? { id: '', name: '', arguments: '' };
      const id = typeof candidate.id === 'string' ? candidate.id : current.id;
      const fn = isRecord(candidate.function) ? candidate.function : undefined;
      const name = typeof fn?.name === 'string' ? fn.name : current.name;
      const argumentsDelta = typeof fn?.arguments === 'string' ? fn.arguments : '';
      state.toolCalls.set(index, { id, name, arguments: current.arguments + argumentsDelta });
      await handlers.onToolCallDelta?.({ index, ...(id ? { id } : {}), ...(name ? { name } : {}), ...(argumentsDelta ? { argumentsDelta } : {}) });
    }
  }
  if (choice?.finish_reason === 'tool_calls') {
    for (const [, value] of [...state.toolCalls.entries()].sort(([left], [right]) => left - right)) {
      if (value.id && value.name) await handlers.onToolCall?.({ id: value.id, type: 'function', function: { name: value.name, arguments: value.arguments } });
    }
  }
  void eventType;
}

async function handleResponsesStreamEvent(eventType: string | undefined, payload: unknown, state: StreamState, handlers: ModelStreamHandlers): Promise<void> {
  if (!isRecord(payload)) return;
  const type = typeof payload.type === 'string' ? payload.type : eventType;
  if (type === 'response.output_text.delta') {
    const delta = typeof payload.delta === 'string' ? payload.delta : '';
    if (delta) { state.content += delta; state.emittedText = true; await handlers.onTextDelta?.(delta); }
    return;
  }
  if (type?.includes('reasoning') && type.includes('delta')) {
    const delta = firstString(payload.delta, payload.text);
    if (delta) { state.reasoning += delta; await handlers.onReasoningDelta?.(delta); }
    return;
  }
  if (type === 'response.output_item.added' || type === 'response.output_item.done') {
    const item = isRecord(payload.item) ? payload.item : isRecord(payload.output_item) ? payload.output_item : undefined;
    if (item?.type === 'web_search_call') state.webSearchUsed = true;
    if (item?.type === 'function_call') {
      const index = typeof payload.output_index === 'number' ? payload.output_index : state.toolCalls.size;
      const id = typeof item.call_id === 'string' ? item.call_id : typeof item.id === 'string' ? item.id : `call_${index}`;
      const name = typeof item.name === 'string' ? item.name : '';
      const args = typeof item.arguments === 'string' ? item.arguments : '';
      const existing = state.toolCalls.get(index);
      state.toolCalls.set(index, { id, name, arguments: (existing?.arguments ?? '') + args });
      if (type === 'response.output_item.done' && name) await handlers.onToolCall?.({ id, type: 'function', function: { name, arguments: state.toolCalls.get(index)?.arguments ?? args } });
    }
    return;
  }
  if (type === 'response.function_call_arguments.delta') {
    const index = typeof payload.output_index === 'number' ? payload.output_index : state.toolCalls.size;
    const existing = state.toolCalls.get(index) ?? { id: typeof payload.call_id === 'string' ? payload.call_id : `call_${index}`, name: typeof payload.name === 'string' ? payload.name : '', arguments: '' };
    const delta = typeof payload.delta === 'string' ? payload.delta : '';
    state.toolCalls.set(index, { ...existing, arguments: existing.arguments + delta });
    await handlers.onToolCallDelta?.({ index, ...(existing.id ? { id: existing.id } : {}), ...(existing.name ? { name: existing.name } : {}), ...(delta ? { argumentsDelta: delta } : {}) });
    return;
  }
  if (type === 'response.function_call_arguments.done') {
    const index = typeof payload.output_index === 'number' ? payload.output_index : state.toolCalls.size;
    const existing = state.toolCalls.get(index) ?? { id: typeof payload.call_id === 'string' ? payload.call_id : `call_${index}`, name: typeof payload.name === 'string' ? payload.name : '', arguments: '' };
    const args = typeof payload.arguments === 'string' ? payload.arguments : existing.arguments;
    state.toolCalls.set(index, { ...existing, arguments: args });
    return;
  }
  if (type === 'response.completed' || type === 'response.done') {
    const response = isRecord(payload.response) ? payload.response : payload;
    if (typeof response.model === 'string' && response.model.trim()) state.model = response.model;
    if (isRecord(response.usage)) state.usage = response.usage;
    if (extractResponsesWebSearchUsed(response)) state.webSearchUsed = true;
    const content = extractResponsesContent(response);
    if (content && !state.emittedText) { state.content = content; await handlers.onTextDelta?.(content); }
    const calls = extractResponsesToolCalls(response);
    for (const call of calls) {
      const existing = [...state.toolCalls.values()].find((candidate) => candidate.id === call.id);
      if (!existing) await handlers.onToolCall?.(call);
      else state.toolCalls.set([...state.toolCalls.entries()].find(([, candidate]) => candidate.id === call.id)?.[0] ?? state.toolCalls.size, { ...existing, name: call.function.name, arguments: call.function.arguments });
    }
    return;
  }
  if (type === 'error' || type === 'response.failed') {
    const message = isRecord(payload.error) && typeof payload.error.message === 'string' ? payload.error.message : 'model provider stream failed';
    throw new PiModelClientError('MODEL_INVALID_RESPONSE', message);
  }
}

async function consumeSse(body: ReadableStream<Uint8Array>, onEvent: (eventType: string | undefined, payload: unknown) => Promise<void>): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventType: string | undefined;
  let dataLines: string[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!line) {
          if (dataLines.length) {
            const raw = dataLines.join('\n');
            if (raw !== '[DONE]') {
              let payload: unknown;
              try { payload = JSON.parse(raw); } catch { throw new PiModelClientError('MODEL_INVALID_RESPONSE', 'model provider returned invalid SSE JSON'); }
              await onEvent(eventType, payload);
            }
          }
          eventType = undefined;
          dataLines = [];
        } else if (line.startsWith('event:')) eventType = line.slice(6).trim() || undefined;
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        newline = buffer.indexOf('\n');
      }
    }
    if (buffer.trim() || dataLines.length) {
      const raw = dataLines.length ? dataLines.join('\n') : buffer.trim();
      if (raw && raw !== '[DONE]') {
        let payload: unknown;
        try { payload = JSON.parse(raw); } catch { throw new PiModelClientError('MODEL_INVALID_RESPONSE', 'model provider returned invalid SSE JSON'); }
        await onEvent(eventType, payload);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function extractDeltaText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => isRecord(part) && typeof part.text === 'string' ? part.text : typeof part === 'string' ? part : '').join('');
}

function firstString(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0) ?? '';
}

function toResponsesToolDefinition(tool: ModelToolDefinition): Record<string, unknown> {
  if (tool.type === 'web_search') return { type: 'web_search' };
  return {
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  };
}

function toResponsesToolChoice(toolChoice: NonNullable<ModelCompletionRequest['toolChoice']>): unknown {
  if (typeof toolChoice === 'string') return toolChoice;
  return { type: 'function', name: toolChoice.function.name };
}

function extractCompletionContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) return '';
  const choice = isRecord(payload.choices[0]) ? payload.choices[0] : undefined;
  const message = choice && isRecord(choice.message) ? choice.message : undefined;
  const content = message?.content ?? choice?.text;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (isRecord(part) && typeof part.text === 'string') return part.text;
    return '';
  }).join('').trim();
}

function extractCompletionToolCalls(payload: unknown): ModelToolCall[] {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) return [];
  const choice = isRecord(payload.choices[0]) ? payload.choices[0] : undefined;
  const message = choice && isRecord(choice.message) ? choice.message : undefined;
  if (!Array.isArray(message?.tool_calls)) return [];
  return message.tool_calls.flatMap((candidate): ModelToolCall[] => {
    if (!isRecord(candidate) || candidate.type !== 'function' || typeof candidate.id !== 'string') return [];
    const fn = isRecord(candidate.function) ? candidate.function : undefined;
    if (!fn || typeof fn.name !== 'string' || typeof fn.arguments !== 'string') return [];
    return [{ id: candidate.id, type: 'function', function: { name: fn.name, arguments: fn.arguments } }];
  });
}

function extractResponsesContent(payload: unknown): string {
  if (!isRecord(payload)) return '';
  if (typeof payload.output_text === 'string') return payload.output_text.trim();
  if (!Array.isArray(payload.output)) return '';
  return payload.output.flatMap((item): string[] => {
    if (!isRecord(item)) return [];
    if (item.type === 'message' && Array.isArray(item.content)) {
      return item.content.flatMap((part): string[] => {
        if (!isRecord(part)) return [];
        return typeof part.text === 'string' && (part.type === 'output_text' || part.type === 'text') ? [part.text] : [];
      });
    }
    return item.type === 'output_text' && typeof item.text === 'string' ? [item.text] : [];
  }).join('').trim();
}

function extractResponsesToolCalls(payload: unknown): ModelToolCall[] {
  if (!isRecord(payload) || !Array.isArray(payload.output)) return [];
  return payload.output.flatMap((item): ModelToolCall[] => {
    if (!isRecord(item) || item.type !== 'function_call') return [];
    const id = typeof item.call_id === 'string' ? item.call_id : typeof item.id === 'string' ? item.id : undefined;
    const name = typeof item.name === 'string' ? item.name : undefined;
    const args = typeof item.arguments === 'string' ? item.arguments : item.arguments === undefined ? undefined : JSON.stringify(item.arguments);
    if (!id || !name || args === undefined) return [];
    return [{ id, type: 'function', function: { name, arguments: args } }];
  });
}

function extractResponsesWebSearchUsed(payload: unknown): boolean {
  if (!isRecord(payload) || !Array.isArray(payload.output)) return false;
  return payload.output.some((item) => isRecord(item) && item.type === 'web_search_call');
}

function redactSensitiveText(value: string, outputLimit: number, secrets: string[] = []): string {
  const limit = positiveInteger(outputLimit, 2_000);
  const redacted = secrets.filter(Boolean).reduce((current, secret) => current.split(secret).join('[REDACTED]'), value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
  return redacted.length > limit ? `${redacted.slice(0, limit)}…` : redacted;
}

function toSafeFailure(error: unknown): { code: string; summary: string } {
  if (error instanceof PiModelClientError) {
    return { code: error.code, summary: summarizePiFailure(error) };
  }
  const candidate = isRecord(error) ? error : undefined;
  const code = typeof candidate?.code === 'string' ? candidate.code : undefined;
  const message = typeof candidate?.message === 'string' ? candidate.message.trim() : undefined;
  const inferredCode = code ?? message?.match(/\b[A-Z][A-Z0-9_]{2,}\b/)?.[0];
  const safeCodes = ['VALIDATION_FAILED', 'NOT_FOUND', 'FORBIDDEN', 'CONFLICT', 'ACCOUNT_SCOPE_FORBIDDEN', 'WORKSPACE_PRODUCT_REQUIRED', 'WORKSPACE_PRODUCT_NOT_FOUND', 'WORKSPACE_WRITE_REQUIRED', 'WORKSPACE_PRODUCT_SEARCH_UNAVAILABLE', 'MODEL_TOOL_RUNTIME_UNAVAILABLE', 'DUPLICATE_TOOL_CALL'];
  if (inferredCode && message && safeCodes.includes(inferredCode)) {
    return { code: inferredCode, summary: message };
  }
  return { code: 'RUNTIME_FAILED', summary: 'Pi Runtime 执行失败，请稍后重试' };
}

function summarizePiFailure(error: PiModelClientError): string {
  if (error.code === 'MODEL_TOOL_LOOP_EXCEEDED') return '模型重复调用工具或超过 8 轮工具循环，已停止本次执行。';
  if (error.code === 'MODEL_TIMEOUT') return '模型请求超时，未能在限定时间内完成。';
  if (error.code === 'MODEL_ABORTED') return '模型请求已取消。';
  if (error.code === 'MODEL_NETWORK_ERROR') return '模型服务网络请求失败。';
  if (error.code === 'MODEL_HTTP_ERROR') return '模型服务返回 HTTP 错误。';
  if (error.code === 'MODEL_UNSUPPORTED_TOOL') return '模型请求了当前运行时不支持的工具。';
  if (error.code === 'MODEL_INVALID_RESPONSE') {
    if (/tool loop|identical tool|repeat/i.test(error.message)) return '模型重复调用工具或超过 8 轮工具循环，已停止本次执行。';
    if (/empty content|no result/i.test(error.message)) return '模型返回为空，未生成可用结果。';
    return '模型返回格式无效，未生成可用结果。';
  }
  return 'Pi Runtime 执行失败，请稍后重试';
}

function toolFailureResult(failure: { code: string; summary: string }): Record<string, unknown> {
  const suggestedTool = failure.code === 'WORKSPACE_WRITE_REQUIRED'
    ? 'workspace_prepare_write'
    : failure.code === 'WORKSPACE_PRODUCT_SEARCH_REQUIRED'
      ? 'workspace_product_search'
      : undefined;
  return {
    ok: false,
    code: failure.code,
    message: failure.summary,
    ...(suggestedTool ? { suggestedTool } : {}),
  };
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim();
}

function positiveInteger(value: number | string | undefined, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
