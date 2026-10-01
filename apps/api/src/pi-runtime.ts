import type { RunEventRecord, RunRecord, RunStatus, StepRecord, StepStatus, Store } from './domain.js';
import type { WorkspaceRuntime } from './workspace.js';
import { executeNativeWorkspaceRead } from './workspace-native-read.js';
import { prepareNativeWorkspaceWrite } from './workspace-native-write.js';
import { persistWorkspaceConfirmation } from './workspace-confirmation.js';
import { ModelClientService } from './model-client.js';

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

export interface ModelClient {
  /** Whether the selected transport can execute OpenAI's built-in web_search tool. */
  supportsWebSearch?: boolean;
  complete(input: ModelCompletionRequest): Promise<ModelCompletionResult>;
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
}

export interface PiRuntimeEnqueueInput {
  adminId?: string;
  run: RunRecord;
  steps: StepRecord[];
  sessionId?: string;
  history?: ModelMessage[];
}

const runTransitions: Record<RunStatus, RunStatus[]> = {
  queued: ['running', 'cancelled', 'expired'],
  running: ['waiting_confirmation', 'executing', 'failed', 'cancelled'],
  waiting_confirmation: ['executing', 'cancelled', 'expired'],
  executing: ['succeeded', 'partially_succeeded', 'failed', 'cancelling'],
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
  executing: ['succeeded', 'partially_succeeded', 'failed', 'cancelled'],
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
      await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'reasoning_summary', content: '正在分析请求并准备执行上下文。', summary: '已创建高层推理摘要' });

      const nativeWrite = await prepareNativeWorkspaceWrite({ store: this.store, adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: input.run.instruction });
      if (nativeWrite) {
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

      const nativeRead = await executeNativeWorkspaceRead({ store: this.store, adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: input.run.instruction });
      if (nativeRead) {
        const sessionId = input.sessionId ?? input.run.sessionId;
        await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'tool_event', content: nativeRead.content, summary: nativeRead.summary });
        await this.emit(input.run.id, 'workspace.native_read', { messageType: 'tool_event', resource: nativeRead.kind, summary: nativeRead.summary, data: nativeRead.data });
        const finishedAt = new Date().toISOString();
        await this.transitionStep(step, 'succeeded', { finishedAt, outputSummary: nativeRead.summary });
        await this.transitionRun(input.run, 'succeeded', { finishedAt, resultSummary: nativeRead.content });
        await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'final_answer', content: nativeRead.content });
        await this.emit(input.run.id, 'runtime.succeeded', { status: 'succeeded', model: this.options.model, messageType: 'final_answer', content: nativeRead.content, resource: nativeRead.kind });
        await this.emit(input.run.id, 'run.succeeded', { status: 'succeeded', resultSummary: nativeRead.content, messageType: 'final_answer', content: nativeRead.content, resource: nativeRead.kind });
        return;
      }

      const modelClient = await this.options.resolveModelClient?.({
        adminId: input.adminId ?? input.run.requestedBy,
        accountId: input.run.accountId,
      }) ?? this.modelClient;
      const result = await modelClient.complete({
        messages: [...(input.history ?? []), { role: 'user', content: input.run.instruction }],
        signal,
      });
      if (this.stopped || signal.aborted) return;

      const finishedAt = new Date().toISOString();
      const output = redactSensitiveText(result.content, this.options.outputLimit ?? 2_000, this.options.redactSecrets);
      await this.transitionStep(step, 'succeeded', { finishedAt, outputSummary: output });
      await this.transitionRun(input.run, 'succeeded', { finishedAt, resultSummary: output });
      await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'reasoning_summary', content: '已完成模型处理并整理结果。', summary: step.label });
      await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'final_answer', content: output });
      await this.emit(input.run.id, 'step.succeeded', { stepId: step.id, status: 'succeeded', messageType: 'reasoning_summary', summary: step.label });
      await this.emit(input.run.id, 'runtime.succeeded', { status: 'succeeded', model: result.model, messageType: 'final_answer', content: output });
      await this.emit(input.run.id, 'run.succeeded', { status: 'succeeded', resultSummary: output, messageType: 'final_answer', content: output });
    } catch (error) {
      if (this.stopped && signal.aborted) return;
      await this.recordFailure(input, step, error);
    }
  }

  private async recordFailure(input: PiRuntimeEnqueueInput, step: StepRecord, error: unknown): Promise<void> {
    const run = input.run;
    const failure = toSafeFailure(error);
    const finishedAt = new Date().toISOString();
    try {
      if (step.status !== 'failed') await this.transitionStep(step, 'failed', { finishedAt, errorCode: failure.code, outputSummary: failure.summary });
      if (run.status !== 'failed') await this.transitionRun(run, 'failed', { finishedAt, errorCode: failure.code });
      const sessionId = input.sessionId ?? run.sessionId;
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
    return { code: error.code, summary: 'Pi Runtime 调用失败，请稍后重试' };
  }
  return { code: 'RUNTIME_FAILED', summary: 'Pi Runtime 执行失败，请稍后重试' };
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
