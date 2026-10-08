import { createHash } from 'node:crypto';
import type { RunEventRecord, RunRecord, RunStatus, StepRecord, StepStatus, Store } from './domain.js';
import { findWorkspaceExecutionStep, prepareWorkspaceRunResume, type WorkspaceRuntime } from './workspace.js';
import { executeNativeWorkspaceRead } from './workspace-native-read.js';
import { prepareNativeWorkspaceWrite } from './workspace-native-write.js';
import type { WorkspaceCommandInput, WorkspaceCommandOrchestrator, WorkspaceModelToolResult } from './workspace-commands.js';
import { persistWorkspaceConfirmation } from './workspace-confirmation.js';
import { ModelClientService } from './model-client.js';
import type { PiSkillManager } from './pi-skills.js';
import {
  applyWorkspacePlanResult,
  applyWorkspacePlanFacts,
  compactWorkspaceModelMessagesWithModel,
  completeConfirmedWorkspacePlanStep,
  createWorkspaceExecutionPlanFromModel,
  createWorkspacePlanMessage,
  reopenBlockedWorkspacePlan,
  reviseWorkspaceExecutionPlanFromModel,
  restoreWorkspaceExecutionPlan,
  restoreWorkspacePlanFacts,
  workspacePlanCurrentTool,
  workspacePlanHasPendingSteps,
  workspacePlanCompletionStatus,
  type WorkspaceExecutionPlan,
} from './workspace-context.js';
import {
  extractWorkspacePlanFacts,
  validateWorkspacePlanCall,
  mergeWorkspacePlanFacts,
  type WorkspacePlanPolicy,
  type WorkspacePlanFacts,
} from './workspace-plan-contract.js';

export const DEFAULT_PI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_PI_MODEL = 'gpt-4o-mini';
export const DEFAULT_PI_TIMEOUT_MS = 30_000;
export const DEFAULT_PI_WIRE_API: ModelWireApi = 'responses';
/** Workspace Agent has its own loop budget; it must not reuse buyer Auto-Reply settings. */
export const DEFAULT_PI_MAX_TOOL_ROUNDS = 24;
export const SKILL_NO_PROGRESS_LIMIT = 8;

export type ModelWireApi = 'chat' | 'responses';

export type ModelMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type ModelMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
  | { type: 'file'; file: { filename: string; fileData: string } };

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
  /** Absolute request deadline. Workspace callers omit this and keep the service default. */
  deadlineAt?: number;
  /** Internal phase used to explain which part of an Agent request timed out. */
  timeoutPhase?: string;
  /** Auto Reply buffers stream deltas and may retry the attempt before completion. */
  buffered?: boolean;
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
  safeProbe?(): Promise<ModelProbeResult>;
}

export interface ModelProbeResult {
  ok: boolean;
  code?: 'PROBE_UNSUPPORTED' | 'PROBE_TIMEOUT' | 'PROBE_FAILED' | 'PROBE_MODEL_MISSING' | 'PROBE_AUTH_FAILED';
  latencyMs?: number;
}

export type ModelTimeoutOrigin = 'agent_deadline' | 'provider_timeout' | 'external_abort';

export interface ModelProgressSnapshot {
  firstEventAt?: number;
  lastProgressAt?: number;
  maxIdleMs: number;
  emittedAny: boolean;
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
  probeStrategy?: 'models' | 'completion' | 'health_url' | 'none';
  probeUrl?: string;
  probeModel?: string;
  probeTimeoutMs?: number;
}

export type PiModelErrorCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'MODEL_ABORTED'
  | 'MODEL_TIMEOUT'
  | 'MODEL_HTTP_ERROR'
  | 'MODEL_NETWORK_ERROR'
  | 'MODEL_INVALID_RESPONSE'
  | 'MODEL_TOOL_LOOP_EXCEEDED'
  | 'MODEL_UNSUPPORTED_TOOL'
  | 'MODEL_PROVIDER_UNAVAILABLE'
  | 'MODEL_ROUTING_STATE_UNAVAILABLE';

export class PiModelClientError extends Error {
  readonly code: PiModelErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly origin?: ModelTimeoutOrigin;
  readonly timeoutPhase?: string;
  modelProgress?: ModelProgressSnapshot;

  constructor(code: PiModelErrorCode, message: string, status?: number, retryAfterMs?: number, meta?: { origin?: ModelTimeoutOrigin; timeoutPhase?: string; modelProgress?: ModelProgressSnapshot }) {
    super(message);
    this.name = 'PiModelClientError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.origin = meta?.origin;
    this.timeoutPhase = meta?.timeoutPhase;
    this.modelProgress = meta?.modelProgress;
  }
}

export class OpenAICompatibleModelClient implements ModelClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly wireApi: ModelWireApi;
  private readonly fetchImpl: typeof fetch;
  private readonly probeStrategy: NonNullable<OpenAICompatibleModelClientOptions['probeStrategy']>;
  private readonly probeUrl?: string;
  private readonly probeModel?: string;
  private readonly probeTimeoutMs: number;
  readonly supportsWebSearch: boolean;

  constructor(private readonly options: OpenAICompatibleModelClientOptions) {
    if (!options.apiKey.trim()) throw new Error('PI_RUNTIME_API_KEY_REQUIRED');
    if (!options.model.trim()) throw new Error('PI_RUNTIME_MODEL_REQUIRED');
    this.wireApi = normalizeWireApi(options.wireApi);
    this.supportsWebSearch = this.wireApi === 'responses';
    this.endpoint = this.wireApi === 'responses' ? toResponsesEndpoint(options.baseUrl) : toChatCompletionsEndpoint(options.baseUrl);
    this.timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_PI_TIMEOUT_MS);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.probeStrategy = options.probeStrategy ?? 'models';
    this.probeUrl = options.probeUrl?.trim() || undefined;
    this.probeModel = options.probeModel?.trim() || options.model.trim();
    this.probeTimeoutMs = positiveInteger(options.probeTimeoutMs, Math.min(this.timeoutMs, 10_000));
  }

  async safeProbe(): Promise<ModelProbeResult> {
    const started = Date.now();
    if (this.probeStrategy === 'none') return { ok: false, code: 'PROBE_UNSUPPORTED', latencyMs: 0 };
    if (this.probeStrategy === 'health_url') {
      if (!this.probeUrl) return { ok: false, code: 'PROBE_UNSUPPORTED', latencyMs: Date.now() - started };
      return this.probeHealthUrl(started);
    }
    if (this.probeStrategy === 'completion') return this.probeCompletion(started);
    return this.probeModels(started);
  }

  private async probeModels(started: number): Promise<ModelProbeResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), this.probeTimeoutMs);
    try {
      const url = toModelsEndpoint(this.options.baseUrl);
      const response = await this.fetchImpl(url, { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${this.options.apiKey}` }, signal: controller.signal });
      if (response.status === 404 || response.status === 405) return { ok: false, code: 'PROBE_UNSUPPORTED', latencyMs: Date.now() - started };
      if (!response.ok) {
        const code = response.status === 401 || response.status === 403
          ? 'PROBE_AUTH_FAILED'
          : response.status === 404 || response.status === 405
            ? 'PROBE_UNSUPPORTED'
            : 'PROBE_FAILED';
        return { ok: false, code, latencyMs: Date.now() - started };
      }
      const payload = await response.json() as { data?: Array<{ id?: unknown }> };
      const models = Array.isArray(payload?.data) ? payload.data : [];
      const found = models.some((item) => String(item?.id ?? '').trim() === this.probeModel);
      return { ok: found, code: found ? undefined : 'PROBE_MODEL_MISSING', latencyMs: Date.now() - started };
    } catch (error) {
      if (controller.signal.aborted) return { ok: false, code: 'PROBE_TIMEOUT', latencyMs: Date.now() - started };
      return { ok: false, code: 'PROBE_FAILED', latencyMs: Date.now() - started };
    } finally { clearTimeout(timeout); }
  }

  private async probeCompletion(started: number): Promise<ModelProbeResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), this.probeTimeoutMs);
    try {
      const result = await this.complete({ messages: [{ role: 'user', content: 'health probe: reply with OK' }], signal: controller.signal });
      return { ok: Boolean(result.content || result.toolCalls?.length), latencyMs: Date.now() - started };
    } catch (error) {
      const code = controller.signal.aborted || (error instanceof PiModelClientError && error.code === 'MODEL_TIMEOUT')
        ? 'PROBE_TIMEOUT'
        : error instanceof PiModelClientError && error.code === 'MODEL_HTTP_ERROR' && (error.status === 401 || error.status === 403)
          ? 'PROBE_AUTH_FAILED'
          : 'PROBE_FAILED';
      return { ok: false, code, latencyMs: Date.now() - started };
    } finally { clearTimeout(timeout); }
  }

  private async probeHealthUrl(started: number): Promise<ModelProbeResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), this.probeTimeoutMs);
    try {
      const url = new URL(this.probeUrl!);
      const base = new URL(this.options.baseUrl);
      if (url.host !== base.host) return { ok: false, code: 'PROBE_UNSUPPORTED', latencyMs: Date.now() - started };
      const response = await this.fetchImpl(url, { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${this.options.apiKey}` }, signal: controller.signal });
      const code = response.ok
        ? undefined
        : response.status === 401 || response.status === 403
          ? 'PROBE_AUTH_FAILED'
          : 'PROBE_FAILED';
      return { ok: response.ok, code, latencyMs: Date.now() - started };
    } catch (error) {
      return { ok: false, code: controller.signal.aborted ? 'PROBE_TIMEOUT' : 'PROBE_FAILED', latencyMs: Date.now() - started };
    } finally { clearTimeout(timeout); }
  }

  async complete(input: ModelCompletionRequest): Promise<ModelCompletionResult> {
    const controller = new AbortController();
    const transportTimeoutMs = requestTimeoutMs(input, this.timeoutMs);
    const timeout = setTimeout(() => controller.abort('provider_timeout'), transportTimeoutMs);
    const onAbort = () => controller.abort(input.signal?.reason ?? 'external_abort');

    if (input.signal?.aborted) controller.abort(input.signal.reason ?? 'external_abort');
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
        throw new PiModelClientError('MODEL_HTTP_ERROR', `model provider returned HTTP ${response.status}`, response.status, retryAfterMs(response));
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
        const reason = normalizeAbortReason(controller.signal.reason);
        if (reason === 'agent_deadline') throw new PiModelClientError('MODEL_TIMEOUT', 'model request exceeded the Agent deadline', undefined, undefined, { origin: 'agent_deadline', timeoutPhase: input.timeoutPhase });
        if (reason === 'external_abort' || input.signal?.aborted) throw new PiModelClientError('MODEL_ABORTED', 'model request aborted', undefined, undefined, { origin: 'external_abort', timeoutPhase: input.timeoutPhase });
        throw new PiModelClientError('MODEL_TIMEOUT', `model request timed out after ${transportTimeoutMs}ms`, undefined, undefined, { origin: 'provider_timeout', timeoutPhase: input.timeoutPhase });
      }
      throw new PiModelClientError('MODEL_NETWORK_ERROR', 'model provider request failed');
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', onAbort);
    }
  }

  async stream(input: ModelCompletionRequest, handlers: ModelStreamHandlers = {}): Promise<ModelCompletionResult> {
    const controller = new AbortController();
    const transportTimeoutMs = requestTimeoutMs(input, this.timeoutMs);
    const timeout = setTimeout(() => controller.abort('provider_timeout'), transportTimeoutMs);
    const onAbort = () => controller.abort(input.signal?.reason ?? 'external_abort');
    if (input.signal?.aborted) controller.abort(input.signal.reason ?? 'external_abort');
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
      if (!response.ok) throw new PiModelClientError('MODEL_HTTP_ERROR', `model provider returned HTTP ${response.status}`, response.status, retryAfterMs(response));

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
        const reason = normalizeAbortReason(controller.signal.reason);
        if (reason === 'agent_deadline') throw new PiModelClientError('MODEL_TIMEOUT', 'model request exceeded the Agent deadline', undefined, undefined, { origin: 'agent_deadline', timeoutPhase: input.timeoutPhase });
        if (reason === 'external_abort' || input.signal?.aborted) throw new PiModelClientError('MODEL_ABORTED', 'model request aborted', undefined, undefined, { origin: 'external_abort', timeoutPhase: input.timeoutPhase });
        throw new PiModelClientError('MODEL_TIMEOUT', `model request timed out after ${transportTimeoutMs}ms`, undefined, undefined, { origin: 'provider_timeout', timeoutPhase: input.timeoutPhase });
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
  /** Independent Workspace tool-loop safety budget. Zero or less means no round cap. */
  maxToolRounds?: number;
  redactSecrets?: string[];
  persistUserMessage?: boolean;
  resolveModelClient?: (input: { adminId?: string; accountId: string }) => Promise<ModelClient | undefined>;
  messageSink?: (message: PiRuntimeMessage) => void | Promise<void>;
  onEvent?: (event: PiRuntimeEvent) => void | Promise<void>;
  workspaceCommands?: WorkspaceCommandOrchestrator;
  skillManager?: PiSkillManager;
  /** Optional policy extension; generic runtime remains usable without one. */
  planPolicy?: WorkspacePlanPolicy;
}

export interface PiRuntimeEnqueueInput {
  adminId?: string;
  run: RunRecord;
  steps: StepRecord[];
  sessionId?: string;
  history?: ModelMessage[];
  attachments?: PiRuntimeAttachment[];
  /** Reconnect resumes the persisted run and must not duplicate its user message. */
  resumeFromFailure?: boolean;
  /** Confirmed mutations resume the existing run without restarting it. */
  resumeAfterConfirmation?: boolean;
}

export interface PiRuntimeAttachment {
  kind: 'image' | 'document';
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  textContent?: string;
}

const WORKSPACE_AGENT_SYSTEM_PROMPT = [
  '你是 Workspace Agent。请根据工具契约自主选择工具，并始终以工具返回的真实结果为依据。',
  '需要查询具体商品名称或外部编号时，优先使用 workspace_product_search，不要先加载完整商品列表；一旦 workspace_product_search 已返回 productId 或 data.productId，后续写操作必须直接复用该 ID，不要为了再次确认重复搜索，除非上次明确失败或无匹配。',
  '取消、下架、更新、发布、发货或其他写入操作必须使用 workspace_prepare_write，并等待用户确认；不要用 workspace_read 代替写操作。',
  '每次收到工具结果后，必须重新对照原始用户任务逐项检查；一个写操作成功不代表整个任务完成。',
  '只有当原始任务中的所有用户要求都已由真实工具结果确认完成时，才返回最终答复；仍有后续动作时继续规划并调用对应工具。',
  'Pi Skill 的登录状态按管理员和 Skill 持久化：已授权时复用已有状态，除非 Skill 返回 requiresLogin 或用户明确要求重新登录，否则不要再次调用 pi_skill_login。',
  '只为安装调用 pi_skill_install，只为登录调用 pi_skill_login，只能使用 Skill 明确记录的命令调用 pi_skill_exec；不要把 bash、install 等 shell 命令传给 pi_skill_exec。',
  'Skill 文档发现按层级推进：先调用 pi_skill_catalog 获取能力总览和文档索引，再选择最窄的文档路径调用 pi_skill_read 或 pi_skill_search，拿到可验证的命令片段后才调用对应的 pi_skill_exec。有 reference 文档时，pi_skill_read/pi_skill_search 必须显式传入 filePath；不要回读顶层 SKILL.md，也不要搜索 Skill 元数据或泛化标题。针对用户给出的文件名/商品名，优先将原始名称作为精确查询词，并选择文件分享/文件检索相关文档。不要猜命令，也不要在已定位文档后反复搜索整个 Skill。不同关键词如果没有新证据，不要继续换词；达到检索预算时转为可行动等待并停止。',
  'Skill preflight 由 Runtime 在 pi_skill_exec 前自动完成，不要单独调用 setup/preflight 工具。',
  '如果 Skill 返回 requiresLogin、unauthorized、pending_user_action 或 userActionRequired，不要重复原命令；最多发起一次登录流程，或直接返回用户需要完成的操作，然后停止工具执行。',
  '工具返回后，要么基于结果回答，要么只在结果明确要求修正时选择其他工具。没有拿到工具结果时，不要声称工具已经执行。',
  '如果上下文中出现 [WORKSPACE_PLAN]，这是 Runtime 持久化的执行计划：严格按当前步骤调用工具，不能跳过 pending 步骤，也不要重复执行已标记为 succeeded 的步骤；遇到失败先修正当前步骤。',
  '最终答复简洁、准确，并且只基于当前上下文和工具结果。',
].join('\n');

const WORKSPACE_LANGUAGE_INSTRUCTION = [
  '输出语言规则（最高优先级）：思考摘要、工具调用说明、工具结果说明和最终答复全部使用简体中文。',
  '不要因为当前用户输入、历史消息、工具名、字段名、代码、API 名称或系统配置中出现英文而输出英文自然语言；工具名、字段名、代码和 API 名称可以原样保留。',
].join('\n');

export type WorkspaceResponseLanguage = 'zh-CN';

/** Workspace 对话固定使用简体中文，避免按输入语言切换到英文。 */
export function detectWorkspaceResponseLanguage(_instruction: string): WorkspaceResponseLanguage {
  return 'zh-CN';
}

export function buildWorkspaceModelMessages(history: ModelMessage[], instruction: string, skillPrompt = '', attachments: PiRuntimeAttachment[] = []): ModelMessage[] {
  const messages: ModelMessage[] = [...history];
  if (messages.some((message) => message.role === 'system')) {
    // Keep caller-provided system context, but place the language rule before
    // conversation history so every Workspace response remains Chinese.
    const firstNonSystem = messages.findIndex((message) => message.role !== 'system');
    messages.splice(firstNonSystem < 0 ? messages.length : firstNonSystem, 0, { role: 'system', content: WORKSPACE_LANGUAGE_INSTRUCTION });
  } else {
    messages.unshift({ role: 'system', content: [WORKSPACE_AGENT_SYSTEM_PROMPT, skillPrompt, WORKSPACE_LANGUAGE_INSTRUCTION].filter(Boolean).join('\n\n') });
  }
  messages.push({ role: 'user', content: buildWorkspaceUserContent(instruction, attachments) });
  return messages;
}

function buildWorkspaceUserContent(instruction: string, attachments: PiRuntimeAttachment[]): ModelMessageContent {
  const parts: ModelMessageContentPart[] = [{ type: 'text', text: instruction }];
  for (const attachment of attachments.slice(0, 8)) {
    const label = `附件：${attachment.name}（${attachment.mimeType || '文件'}，${Math.max(0, Math.trunc(attachment.size))} bytes）`;
    if (attachment.kind === 'image' && attachment.dataUrl?.startsWith('data:image/')) {
      parts.push({ type: 'image_url', image_url: { url: attachment.dataUrl, detail: 'auto' } });
      continue;
    }
    if (attachment.kind === 'document' && attachment.dataUrl?.startsWith('data:')) {
      parts.push({ type: 'file', file: { filename: attachment.name, fileData: attachment.dataUrl } });
      if (attachment.textContent) parts.push({ type: 'text', text: `文档内容：\n${attachment.textContent}` });
      continue;
    }
    const textPart = parts[0];
    if (textPart.type === 'text') textPart.text += `\n${label}${attachment.textContent ? `\n${attachment.textContent}` : ''}`;
  }
  const firstPart = parts[0];
  return parts.length === 1 && firstPart.type === 'text' ? firstPart.text : parts;
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
  private readonly pendingConfirmations = new Map<string, PiRuntimeEnqueueInput>();
  private readonly cancelled = new Set<string>();
  private stopped = false;

  constructor(
    private readonly store: Store,
    private readonly modelClient: ModelClient,
    private readonly options: PiRuntimeAdapterOptions = {},
  ) {}

  enqueue(input: PiRuntimeEnqueueInput): void {
    if (this.stopped || this.active.has(input.run.id) || this.cancelled.has(input.run.id)) return;
    const controller = new AbortController();
    this.active.set(input.run.id, controller);
    void this.execute(input, controller.signal).catch(() => {
      // The execution path records a safe failure event. Keep enqueue fire-and-forget.
    }).finally(() => {
      this.active.delete(input.run.id);
      const continuation = this.pendingConfirmations.get(input.run.id);
      this.pendingConfirmations.delete(input.run.id);
      if (continuation && !this.stopped && !this.cancelled.has(input.run.id)) this.enqueue(continuation);
      this.cancelled.delete(input.run.id);
    });
  }

  async resume(input: PiRuntimeEnqueueInput): Promise<void> {
    if (this.stopped || this.active.has(input.run.id) || this.cancelled.has(input.run.id)) return;
    const prepared = await prepareWorkspaceRunResume({ store: this.store, run: input.run, steps: input.steps });
    if (!prepared) return;
    this.enqueue({ ...input, ...prepared });
  }

  async continueAfterConfirmation(input: PiRuntimeEnqueueInput): Promise<void> {
    if (this.stopped || this.cancelled.has(input.run.id)) return;
    const continuation = { ...input, resumeAfterConfirmation: true };
    if (this.active.has(input.run.id)) {
      this.pendingConfirmations.set(input.run.id, continuation);
      return;
    }
    this.enqueue(continuation);
  }

  cancel(runId: string): void {
    this.cancelled.add(runId);
    this.pendingConfirmations.delete(runId);
    this.active.get(runId)?.abort('user_cancelled');
  }

  stop(): void {
    this.stopped = true;
    this.pendingConfirmations.clear();
    for (const controller of this.active.values()) controller.abort();
  }

  private async execute(input: PiRuntimeEnqueueInput, signal: AbortSignal): Promise<void> {
    const step = findWorkspaceExecutionStep(input.steps);
    if (!step || this.stopped || this.cancelled.has(input.run.id)) return;
    try {
      const sessionId = input.sessionId ?? input.run.sessionId;
      const continuingAfterConfirmation = input.resumeAfterConfirmation === true;
      if (!continuingAfterConfirmation) {
        if (this.options.persistUserMessage !== false && !input.resumeFromFailure) await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'user_message', content: redactSensitiveText(input.run.instruction, this.options.redactSecrets) });
        const startedAt = new Date().toISOString();
        await this.transitionRun(input.run, 'running', { startedAt });
        await this.transitionStep(step, 'running', { startedAt });
        await this.emit(input.run.id, 'run.started', { status: 'running' });
        await this.emit(input.run.id, 'step.started', { stepId: step.id, status: 'running' });
        await this.emit(input.run.id, 'runtime.started', { status: 'running', model: this.options.model, messageType: 'tool_event' });
      } else {
        if (input.run.status === 'waiting_confirmation') await this.transitionRun(input.run, 'executing');
        if (step.status === 'waiting_confirmation') await this.transitionStep(step, 'executing');
        await this.emit(input.run.id, 'runtime.continuation.started', { status: 'executing', model: this.options.model, messageType: 'tool_event', reason: 'confirmation_result' });
      }

      const modelClient = await this.options.resolveModelClient?.({
        adminId: input.adminId ?? input.run.requestedBy,
        accountId: input.run.accountId,
      }) ?? this.modelClient;
      const skillInstruction = await this.options.skillManager?.handleInstruction({ adminId: input.adminId ?? input.run.requestedBy, instruction: input.run.instruction });
      if (this.stopped || signal.aborted || this.cancelled.has(input.run.id)) return;
      if (skillInstruction) {
        if (this.stopped || signal.aborted || this.cancelled.has(input.run.id)) return;
        const output = redactSensitiveText(skillInstruction.content, this.options.redactSecrets);
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

      const nativeWorkspaceStoreAvailable = typeof this.store.hasAccountScope === 'function';
      const nativeWrite = continuingAfterConfirmation
        ? undefined
        : this.options.workspaceCommands
        ? await this.options.workspaceCommands.prepareWrite({ adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: input.run.instruction, requestId: `workspace:${input.run.id}`, traceId: `workspace:${input.run.id}` })
        : nativeWorkspaceStoreAvailable
          ? await prepareNativeWorkspaceWrite({ store: this.store, adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: input.run.instruction })
          : undefined;
      if (this.stopped || signal.aborted || this.cancelled.has(input.run.id)) return;
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

      const nativeRead = continuingAfterConfirmation
        ? undefined
        : this.options.workspaceCommands
        ? await this.options.workspaceCommands.execute({ adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: input.run.instruction, requestId: `workspace:${input.run.id}`, traceId: `workspace:${input.run.id}` })
        : nativeWorkspaceStoreAvailable
          ? await executeNativeWorkspaceRead({ store: this.store, adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: input.run.instruction })
          : undefined;
      if (this.stopped || signal.aborted || this.cancelled.has(input.run.id)) return;
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
        messages: buildWorkspaceModelMessages(input.history ?? [], input.run.instruction, '', input.attachments),
        signal,
      });
      if (this.stopped || signal.aborted) return;

      const finishedAt = new Date().toISOString();
      const output = redactSensitiveText(result.content, this.options.redactSecrets);
      await this.transitionStep(step, 'succeeded', { finishedAt, outputSummary: output });
      await this.transitionRun(input.run, 'succeeded', { finishedAt, resultSummary: output });
      await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'reasoning_summary', content: `模型 ${result.model} 已返回结果，正在整理回复。`, summary: '整理模型结果' });
      await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'final_answer', content: output });
      await this.emit(input.run.id, 'step.succeeded', { stepId: step.id, status: 'succeeded', messageType: 'reasoning_summary', summary: step.label });
      await this.emit(input.run.id, 'runtime.succeeded', { status: 'succeeded', model: result.model, messageType: 'final_answer', content: output });
      await this.emit(input.run.id, 'run.succeeded', { status: 'succeeded', resultSummary: output, messageType: 'final_answer', content: output });
    } catch (error) {
      if (signal.aborted || this.cancelled.has(input.run.id)) return;
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
    const messages = buildWorkspaceModelMessages(input.history ?? [], input.run.instruction, skillPrompt, input.attachments);
    const priorEvents = await this.store.listRunEvents(input.adminId ?? input.run.requestedBy, input.run.id, 0);
    const replayableResults = completedReplayableResults(priorEvents);
    let executionPlan: WorkspaceExecutionPlan | undefined = restoreWorkspaceExecutionPlan(priorEvents);
    if (executionPlan) {
      const recoveredFacts = restoreWorkspacePlanFacts(priorEvents);
      if (Object.keys(recoveredFacts).length > 0) {
        executionPlan = { ...executionPlan, facts: mergeWorkspacePlanFacts(executionPlan.facts, recoveredFacts) };
      }
      if (executionPlan.policyKey && (
        this.options.planPolicy?.key !== executionPlan.policyKey
        || this.options.planPolicy?.version !== executionPlan.policyVersion
      )) {
        await this.recordToolFailure(input, step, {
          toolName: 'plan',
          code: 'PLAN_POLICY_UNAVAILABLE',
          summary: `持久化计划需要策略 ${executionPlan.policyKey}@${executionPlan.policyVersion ?? 'unknown'}，当前运行时未提供匹配策略`,
        });
        return;
      }
    }
    if (executionPlan?.status === 'waiting_confirmation' && input.resumeAfterConfirmation) {
      executionPlan = completeConfirmedWorkspacePlanStep(executionPlan, '确认写入已完成');
      await this.emit(input.run.id, 'workspace.plan.updated', { status: executionPlan.status, plan: executionPlan, reason: 'confirmation_succeeded' });
    }
    if (executionPlan?.status === 'blocked') {
      if (!input.resumeFromFailure) {
        await this.recordToolFailure(input, step, { toolName: 'plan', code: 'PLAN_STEP_BLOCKED', summary: 'Plan Mode 上次已阻塞，必须从失败步骤重连后才能继续执行' });
        return;
      }
      executionPlan = reopenBlockedWorkspacePlan(executionPlan);
      await this.emit(input.run.id, 'workspace.plan.updated', { status: executionPlan.status, plan: executionPlan, reason: 'reconnect_failed_step' });
    }
    if (!executionPlan && !input.resumeAfterConfirmation && !input.resumeFromFailure) {
      executionPlan = await createWorkspaceExecutionPlanFromModel(input.run.instruction, tools, modelClient, signal, { fallback: true, planPolicy: this.options.planPolicy });
      if (executionPlan && !signal.aborted) {
        await this.emit(input.run.id, 'workspace.plan.created', { status: executionPlan.status, plan: executionPlan });
        const planText = createWorkspacePlanMessage(executionPlan, cachedReplayableEvidence(replayableResults));
        upsertWorkspacePlanMessage(messages, planText);
        await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'reasoning_summary', content: redactSensitiveText(planText, this.options.redactSecrets), summary: '执行计划' });
      }
    }
    if (executionPlan) upsertWorkspacePlanMessage(messages, createWorkspacePlanMessage(executionPlan, cachedReplayableEvidence(replayableResults)));
    const updateExecutionPlan = async (planUpdate: { toolName: string; succeeded: boolean; waitingConfirmation?: boolean; evidence?: string; reason?: string; facts?: WorkspacePlanFacts }): Promise<boolean> => {
      if (!executionPlan) return false;
      if (!planUpdate.succeeded) {
        const revised = await reviseWorkspaceExecutionPlanFromModel(executionPlan, {
          toolName: planUpdate.toolName,
          code: planUpdate.reason ?? 'PLAN_STEP_FAILED',
          summary: planUpdate.evidence ?? '当前步骤无法完成',
        }, tools, modelClient, signal, { planPolicy: this.options.planPolicy });
        if (revised) {
          executionPlan = revised;
          await this.emit(input.run.id, 'workspace.plan.updated', {
            status: executionPlan.status,
            plan: executionPlan,
            reason: 'replanned_after_failure',
            failedTool: planUpdate.toolName,
            failureCode: planUpdate.reason ?? 'PLAN_STEP_FAILED',
          });
          upsertWorkspacePlanMessage(messages, createWorkspacePlanMessage(executionPlan, cachedReplayableEvidence(replayableResults)));
          return true;
        }
      }
      executionPlan = applyWorkspacePlanResult(executionPlan, planUpdate);
      if (planUpdate.facts) executionPlan = applyWorkspacePlanFacts(executionPlan, planUpdate.facts);
      await this.emit(input.run.id, 'workspace.plan.updated', { status: executionPlan.status, plan: executionPlan, ...(planUpdate.reason ? { reason: planUpdate.reason } : {}) });
      upsertWorkspacePlanMessage(messages, createWorkspacePlanMessage(executionPlan, cachedReplayableEvidence(replayableResults)));
      return false;
    };

    let reasoningDeltaCount = 0;
    let finalResult: ModelCompletionResult | undefined;
    let waitingConfirmation = false;
    let pendingUserAction: { title: string; summary: string; content: string; data?: Record<string, unknown> } | undefined;
    let completedWithoutTool = false;
    let planCompletedDuringResponse = false;
    let forceFinalAnswer = false;
    let pendingToolFailure: { toolName: string; code: string; summary: string } | undefined;
    const repeatedCalls = new Map<string, number>();
    const replayedCalls = new Map<string, number>();
    const skillProgress = restoreSkillProgress(priorEvents);
    const configuredMaxRounds = this.options.maxToolRounds;
    const maxRounds = configuredMaxRounds !== undefined && configuredMaxRounds > 0
      ? Math.max(1, Math.trunc(configuredMaxRounds))
      : DEFAULT_PI_MAX_TOOL_ROUNDS;
    const strictPlanExecution = Boolean(executionPlan?.policyKey || executionPlan?.goalPredicateId);
    for (let round = 0; round < maxRounds; round += 1) {
      if (this.stopped || signal.aborted) return;
      const planCompletion = strictPlanExecution ? workspacePlanCompletionStatus(executionPlan, this.options.planPolicy) : undefined;
      const finalAnswerRound = forceFinalAnswer || Boolean(planCompletion?.complete);
      const streamId = `${input.run.id}:stream:${round + 1}`;
      const assistantMessageId = `${streamId}:assistant`;
      let assistant = '';
      if (executionPlan) upsertWorkspacePlanMessage(messages, createWorkspacePlanMessage(executionPlan, cachedReplayableEvidence(replayableResults)));
      const compacted = await compactWorkspaceModelMessagesWithModel(messages, modelClient, false, signal);
      if (compacted.summary) {
        messages.splice(0, messages.length, ...compacted.messages);
        if (executionPlan) upsertWorkspacePlanMessage(messages, createWorkspacePlanMessage(executionPlan, cachedReplayableEvidence(replayableResults)));
        await this.emit(input.run.id, 'context.compacted', { round: round + 1, status: 'succeeded', method: compacted.method, beforeChars: compacted.beforeChars, afterChars: compacted.afterChars, summary: '已压缩上下文并保留任务目标及关键结果' });
        await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'reasoning_summary', content: redactSensitiveText(compacted.summary, this.options.redactSecrets), summary: '上下文摘要' });
      }
      await this.emit(input.run.id, 'stream.started', { streamId, round: round + 1, model: this.options.model, status: 'running' });
      await this.emit(input.run.id, 'workspace.execution.summary', { streamId, messageType: 'reasoning_summary', summary: round === 0 ? '分析任务' : '评估工具结果', content: round === 0 ? '正在核对任务目标与已有结果。' : '已读取上一轮工具结果，正在确定下一步。', status: 'running' });
      let surfacedToolCallCount = 0;
      // A strict contract plan advances one durable step at a time.  Even if
      // the provider returns several calls in one response, only the call for
      // the current step may be surfaced, persisted, and executed.
      const maxToolCallsForResponse = strictPlanExecution
        ? 1
        : Number.POSITIVE_INFINITY;
      const handlers: ModelStreamHandlers = {
        onReasoningDelta: async (delta) => {
          if (delta) reasoningDeltaCount += 1;
        },
        onTextDelta: async (delta) => {
          assistant += delta;
          await this.emit(input.run.id, 'assistant.delta', { streamId, messageId: assistantMessageId, contentDelta: redactSensitiveText(delta, this.options.redactSecrets), messageType: 'reasoning_summary', phase: 'draft', status: 'running' });
        },
        onToolCall: async (call) => {
          const shouldSurface = surfacedToolCallCount < maxToolCallsForResponse;
          surfacedToolCallCount += 1;
          if (!shouldSurface) return;
          const progress = workspaceToolProgress(call.function.name);
          await this.emit(input.run.id, 'tool.call.completed', { streamId, toolCallId: call.id, toolName: call.function.name, summary: progress.summary, argumentFingerprint: toolArgumentFingerprint(call.function.arguments), status: 'selected' });
        },
      };
      let result: ModelCompletionResult;
      try {
        result = await modelClient.stream({ messages, tools, toolChoice: finalAnswerRound ? 'none' : 'auto', signal }, handlers);
      } catch (error) {
        if (!(error instanceof PiModelClientError) || error.code !== 'MODEL_HTTP_ERROR' || ![400, 413].includes(error.status ?? 0)) throw error;
        const forced = await compactWorkspaceModelMessagesWithModel(messages, modelClient, true, signal);
        if (!forced.summary || forced.afterChars >= forced.beforeChars) throw error;
        messages.splice(0, messages.length, ...forced.messages);
        await this.emit(input.run.id, 'context.compacted', { round: round + 1, status: 'retrying', method: forced.method, beforeChars: forced.beforeChars, afterChars: forced.afterChars, summary: '模型上下文超限，已保留目标和关键结果后重试' });
        await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'reasoning_summary', content: redactSensitiveText(forced.summary ?? '', this.options.redactSecrets), summary: '上下文摘要' });
        result = await modelClient.stream({ messages, tools, toolChoice: finalAnswerRound ? 'none' : 'auto', signal }, handlers);
      }
      finalResult = result;
      let calls = result.toolCalls ?? [];
      if (Number.isFinite(maxToolCallsForResponse) && calls.length > maxToolCallsForResponse) calls = calls.slice(0, maxToolCallsForResponse);
      if (finalAnswerRound && calls.length > 0) {
        completedWithoutTool = true;
        break;
      }
      if (calls.length === 0) {
        if (executionPlan && workspacePlanHasPendingSteps(executionPlan)) {
          messages.push({ role: 'system', content: '[WORKSPACE_PLAN_GUARD] 当前 Plan Mode 仍有未完成步骤。不要返回最终答复，继续调用当前步骤对应工具；如果当前步骤确实无法执行，说明阻塞原因。' });
          continue;
        }
        completedWithoutTool = true;
        break;
      }

      messages.push({ role: 'assistant', content: result.content ?? assistant, toolCalls: calls });
      for (const call of calls) {
        const progress = workspaceToolProgress(call.function.name);
        await this.emit(input.run.id, 'workspace.execution.summary', {
          streamId,
          messageType: 'reasoning_summary',
          toolCallId: call.id,
          toolName: call.function.name,
          summary: progress.summary,
          content: progress.content,
          status: 'running',
        });
        const toolStartedAt = new Date().toISOString();
        await this.emit(input.run.id, 'tool.call.started', { streamId, toolCallId: call.id, toolName: call.function.name, summary: progress.summary, argumentFingerprint: toolArgumentFingerprint(call.function.arguments), readOnly: replayableCallIsReadOnly(call.function.name, call.function.arguments), startedAt: toolStartedAt, status: 'running' });
        let args: Record<string, unknown>;
        try {
          args = parseModelToolArguments(call.function.arguments);
        } catch {
          const failure = { toolName: call.function.name, code: 'INVALID_TOOL_ARGUMENTS', summary: '工具参数不是可解析的 JSON 对象' };
          pendingToolFailure = failure;
          const errorResult = toolFailureResult(failure);
          await this.emit(input.run.id, 'tool.result', { streamId, toolCallId: call.id, toolName: call.function.name, summary: failure.summary, status: 'failed', result: errorResult, completedAt: new Date().toISOString() });
          await this.emit(input.run.id, 'workspace.execution.summary', { streamId, messageType: 'reasoning_summary', summary: '工具参数错误', content: failure.summary, status: 'failed' });
          messages.push({ role: 'tool', name: call.function.name, toolCallId: call.id, content: JSON.stringify(errorResult) });
          const replanned = await updateExecutionPlan({ toolName: call.function.name, succeeded: false, evidence: failure.summary, reason: failure.code });
          if (replanned) {
            pendingToolFailure = undefined;
            break;
          }
          if (executionPlan?.status === 'blocked') break;
          continue;
        }
        const plannedTool = workspacePlanCurrentTool(executionPlan);
        const plannedStep = executionPlan?.currentStepId ? executionPlan.steps.find((candidate) => candidate.id === executionPlan?.currentStepId) : undefined;
        const planValidation = plannedStep
          ? validateWorkspacePlanCall(plannedStep, call.function.name, args, executionPlan?.facts ?? {}, this.options.planPolicy)
          : { ok: true };
        if (!planValidation.ok) {
          const failure = { toolName: call.function.name, code: planValidation.code ?? 'PLAN_STEP_MISMATCH', summary: planValidation.summary ?? `Plan Mode 当前步骤要求调用 ${plannedTool ?? '未知工具'}；请按计划顺序继续` };
          pendingToolFailure = failure;
          const errorResult = toolFailureResult(failure);
          await this.emit(input.run.id, 'tool.result', { streamId, toolCallId: call.id, toolName: call.function.name, summary: failure.summary, status: 'failed', result: toolFailureResult(failure), completedAt: new Date().toISOString() });
          await this.emit(input.run.id, 'workspace.execution.summary', { streamId, messageType: 'reasoning_summary', summary: '计划顺序校验', content: failure.summary, status: 'failed' });
          messages.push({ role: 'tool', name: call.function.name, toolCallId: call.id, content: JSON.stringify(errorResult) });
          const replanned = await updateExecutionPlan({ toolName: plannedTool ?? call.function.name, succeeded: false, evidence: failure.summary, reason: failure.code });
          if (replanned) pendingToolFailure = undefined;
          // Do not execute later calls from the same provider response. The
          // model can correct the choice on the next round using this error.
          break;
        }
        let result: WorkspaceModelToolResult;
        const replayKey = replayableToolKey(call.function.name, args);
        const reused = replayKey !== undefined && replayableResults.has(replayKey);
        if (replayKey) {
          const attempts = (repeatedCalls.get(replayKey) ?? 0) + 1;
          repeatedCalls.set(replayKey, attempts);
          const replayCount = reused ? (replayedCalls.get(replayKey) ?? 0) + 1 : 0;
          if (reused) replayedCalls.set(replayKey, replayCount);
          const extendedDiscoveryReplay = call.function.name === 'workspace_product_search'
            || call.function.name === 'pi_skill_catalog';
          const replayLimitReached = reused && (extendedDiscoveryReplay ? replayCount >= 3 : replayCount >= 2);
          if ((attempts >= 3 && !reused) || replayLimitReached) {
            const failure = { toolName: call.function.name, code: 'MODEL_TOOL_LOOP_EXCEEDED', summary: '相同工具和参数已重复调用，且没有新的写入进展；已停止本次执行' };
            await this.emit(input.run.id, 'tool.result', { streamId, toolCallId: call.id, toolName: call.function.name, summary: failure.summary, status: 'failed', result: toolFailureResult(failure), completedAt: new Date().toISOString() });
            await this.recordToolFailure(input, step, failure);
            return;
          }
        }
        try {
          const toolInput: WorkspaceCommandInput = { adminId: input.adminId ?? input.run.requestedBy, accountId: input.run.accountId, instruction: typeof args.instruction === 'string' ? args.instruction : input.run.instruction, operation: typeof args.operation === 'string' ? args.operation : undefined, parameters: isRecord(args.parameters) ? args.parameters : undefined, requestId: `workspace:${input.run.id}`, traceId: `workspace:${input.run.id}` };
          const rawResult: unknown = reused ? replayableResults.get(replayKey!) : this.options.skillManager && call.function.name.startsWith('pi_skill_')
            ? await this.options.skillManager.executeModelTool(call.function.name, args, toolInput)
            : await commands.executeModelTool(call.function.name, args, toolInput);
          if (this.stopped || signal.aborted) return;
          const normalized = normalizeModelToolResult(rawResult, call.function.name);
          if (!normalized.ok) {
            pendingToolFailure = { toolName: call.function.name, ...normalized.failure };
            const errorResult = toolFailureResult(pendingToolFailure);
            await this.emit(input.run.id, 'tool.result', { streamId, toolCallId: call.id, toolName: call.function.name, summary: pendingToolFailure.summary, status: 'failed', result: errorResult, completedAt: new Date().toISOString() });
            await this.emit(input.run.id, 'workspace.execution.summary', { streamId, messageType: 'reasoning_summary', summary: '工具返回错误', content: pendingToolFailure.summary, status: 'failed' });
            messages.push({ role: 'tool', name: call.function.name, toolCallId: call.id, content: JSON.stringify(errorResult) });
            const replanned = await updateExecutionPlan({ toolName: call.function.name, succeeded: false, evidence: pendingToolFailure.summary, reason: pendingToolFailure.code });
            if (replanned) {
              pendingToolFailure = undefined;
              break;
            }
            if (executionPlan?.status === 'blocked') break;
            continue;
          }
          result = normalized.result;
          if (!reused && toolInvalidatesReplayableReads(call.function.name, args, result)) {
            const preserveSkillReadCache = call.function.name === 'pi_skill_exec' && !skillCommandIsReadOnly(args);
            clearReplayableReads(replayableResults, preserveSkillReadCache);
            clearReplayableReadAttempts(repeatedCalls, preserveSkillReadCache);
            clearReplayableReadAttempts(replayedCalls, preserveSkillReadCache);
          }
          if (replayKey && isReusableToolResult(result, call.function.name) && !reused) {
            replayableResults.set(replayKey, result);
            replayedCalls.delete(replayKey);
          }
          pendingToolFailure = undefined;
        } catch (error) {
          const failure = toSafeFailure(error);
          const errorResult = toolFailureResult(failure);
          pendingToolFailure = { toolName: call.function.name, ...failure };
          await this.emit(input.run.id, 'tool.result', { streamId, toolCallId: call.id, toolName: call.function.name, summary: pendingToolFailure.summary, status: 'failed', result: errorResult, completedAt: new Date().toISOString() });
          await this.emit(input.run.id, 'workspace.execution.summary', { streamId, messageType: 'reasoning_summary', summary: '工具调用失败', content: pendingToolFailure.summary, status: 'failed' });
          messages.push({ role: 'tool', name: call.function.name, toolCallId: call.id, content: JSON.stringify(errorResult) });
          const replanned = await updateExecutionPlan({ toolName: call.function.name, succeeded: false, evidence: pendingToolFailure.summary, reason: pendingToolFailure.code });
          if (replanned) {
            pendingToolFailure = undefined;
            break;
          }
          if (executionPlan?.status === 'blocked') break;
          continue;
        }
        const redacted = this.redactToolResult(result);
        const modelResult = reused
          ? {
              ...redacted,
              reused: true,
              content: `已复用此前相同工具结果，请不要再次调用该工具，继续处理原任务。${typeof redacted.content === 'string' ? `\n${redacted.content}` : ''}`,
            }
          : redacted;
        if (call.function.name.startsWith('pi_skill_')) {
          const progress = updateSkillProgress(skillProgress, call.function.name, args, result);
          await this.emit(input.run.id, 'workspace.skill.progress', {
            streamId,
            toolName: call.function.name,
            phase: progress.phase,
            discoveryCalls: progress.discoveryCalls,
            executionCalls: progress.executionCalls,
            noProgressCount: progress.noProgressCount,
            evidenceFingerprint: progress.evidenceFingerprint,
            progressed: progress.progressed,
            suggestedTool: progress.suggestedTool,
          });
          if (progress.phase === 'discovery' && progress.noProgressCount >= SKILL_NO_PROGRESS_LIMIT) {
            pendingUserAction = {
              title: 'Skill 检索已暂停',
              summary: '连续 Skill 检索没有产生新证据',
              content: '连续 Skill 检索没有产生新证据，已停止继续换词。请补充明确的文件标识、公开分享链接或确认可执行命令后重连。',
              data: {
                status: 'pending_user_action',
                userActionRequired: true,
                code: 'SKILL_DISCOVERY_NO_PROGRESS',
                phase: progress.phase,
                noProgressCount: progress.noProgressCount,
                suggestedTool: progress.suggestedTool ?? 'pi_skill_exec',
              },
            };
          }
        }
        await this.emit(input.run.id, 'tool.result', { streamId, toolCallId: call.id, toolName: call.function.name, args, title: result.title, summary: result.summary, status: 'succeeded', reused, result: redacted, completedAt: new Date().toISOString() });
        await this.emit(input.run.id, 'workspace.execution.summary', { streamId, messageType: 'reasoning_summary', summary: result.title, content: result.summary, status: 'succeeded' });
        if (result.kind !== 'write_plan' && !reused) await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'tool_event', content: JSON.stringify(redacted), summary: result.summary });
        messages.push({ role: 'tool', name: call.function.name, toolCallId: call.id, content: JSON.stringify(modelResult) });
        // A replayed read is still a successful execution of the current plan
        // step. Advance the durable plan even when the underlying tool call is
        // served from the run cache after reconnect/compaction.
        const extractedFacts = extractWorkspacePlanFacts(call.function.name, args, result);
        await updateExecutionPlan({ toolName: call.function.name, succeeded: true, waitingConfirmation: result.kind === 'write_plan', evidence: planEvidence(result), facts: extractedFacts });
        if (executionPlan && workspacePlanCompletionStatus(executionPlan, this.options.planPolicy).complete) {
          if (strictPlanExecution) {
            planCompletedDuringResponse = true;
            completedWithoutTool = true;
          }
          break;
        }
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
        if (pendingUserAction) break;
      }
      await this.emit(input.run.id, 'stream.round.completed', { streamId, round: round + 1, toolCallCount: calls.length, status: waitingConfirmation ? 'waiting_confirmation' : pendingUserAction ? 'pending_user_action' : 'tool_completed' });
      if (waitingConfirmation) break;
      if (pendingUserAction) break;
      if (planCompletedDuringResponse) {
        forceFinalAnswer = true;
        planCompletedDuringResponse = false;
        continue;
      }
      // A blocked durable plan requires an explicit reconnect. Do not let the
      // next model round bypass the failed step while the run is still active.
      if (executionPlan?.status === 'blocked') break;
    }

    if (this.stopped || signal.aborted) return;

    if (waitingConfirmation) {
      await this.emit(input.run.id, 'stream.completed', { status: 'waiting_confirmation', model: finalResult?.model ?? this.options.model, reasoningMessageCount: reasoningDeltaCount });
      return;
    }
    if (pendingToolFailure) {
      await this.recordToolFailure(input, step, pendingToolFailure);
      return;
    }
    if (pendingUserAction) {
      const output = redactSensitiveText(pendingUserAction.content, this.options.redactSecrets);
      const finishedAt = new Date().toISOString();
      await this.transitionStep(step, 'succeeded', { finishedAt, outputSummary: pendingUserAction.summary });
      await this.transitionRun(input.run, 'succeeded', { finishedAt, resultSummary: output });
      await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'final_answer', content: output });
      await this.emit(input.run.id, 'workspace.skill.lifecycle', { status: 'pending_user_action', title: pendingUserAction.title, summary: pendingUserAction.summary, data: pendingUserAction.data ?? {} });
      await this.emit(input.run.id, 'stream.completed', { status: 'succeeded', model: finalResult?.model ?? this.options.model, content: output, reasoningMessageCount: reasoningDeltaCount });
      await this.emit(input.run.id, 'step.succeeded', { stepId: step.id, status: 'succeeded', messageType: 'final_answer', summary: step.label });
      await this.emit(input.run.id, 'runtime.succeeded', { status: 'succeeded', model: finalResult?.model ?? this.options.model, messageType: 'final_answer', content: output, resource: 'pi_skill' });
      await this.emit(input.run.id, 'run.succeeded', { status: 'succeeded', resultSummary: output, messageType: 'final_answer', content: output, resource: 'pi_skill' });
      return;
    }
    if (executionPlan?.status === 'blocked') {
      await this.recordToolFailure(input, step, { toolName: 'plan', code: 'PLAN_STEP_BLOCKED', summary: 'Plan Mode 有步骤执行失败，未能完成全部计划；请重试当前步骤或重新提交任务' });
      return;
    }
    const finalPlanStatus = workspacePlanCompletionStatus(executionPlan, this.options.planPolicy);
    if (strictPlanExecution && executionPlan && !finalPlanStatus.complete) {
      await this.recordToolFailure(input, step, {
        toolName: 'plan',
        code: finalPlanStatus.reason === 'GOAL_PREDICATE_UNSATISFIED' ? 'PLAN_GOAL_PREDICATE_UNSATISFIED' : 'PLAN_NOT_COMPLETE',
        summary: finalPlanStatus.goalStatus?.missing.length
          ? `Plan Mode 未满足完成条件：${finalPlanStatus.goalStatus.missing.join('、')}`
          : `Plan Mode 未满足完成条件：${finalPlanStatus.reason ?? '状态不一致'}`,
      });
      return;
    }
    if (!completedWithoutTool) throw new PiModelClientError('MODEL_TOOL_LOOP_EXCEEDED', `model tool loop exceeded ${Number.isFinite(maxRounds) ? maxRounds : 'configured'} rounds`);
    if (!finalResult) throw new PiModelClientError('MODEL_INVALID_RESPONSE', 'model provider returned no result');
    const output = redactSensitiveText(
      finalResult.content?.trim()
        || (executionPlan ? '执行计划已完成。' : '任务已完成。'),
      this.options.redactSecrets,
    );
    const finishedAt = new Date().toISOString();
    await this.transitionStep(step, 'succeeded', { finishedAt, outputSummary: output });
    await this.transitionRun(input.run, 'succeeded', { finishedAt, resultSummary: output });
    await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'final_answer', content: output });
    await this.emit(input.run.id, 'stream.completed', { status: 'succeeded', model: finalResult.model, content: output, reasoningMessageCount: reasoningDeltaCount });
    await this.emit(input.run.id, 'step.succeeded', { stepId: step.id, status: 'succeeded', messageType: 'final_answer', summary: step.label });
    await this.emit(input.run.id, 'runtime.succeeded', { status: 'succeeded', model: finalResult.model, messageType: 'final_answer', content: output });
    await this.emit(input.run.id, 'run.succeeded', { status: 'succeeded', resultSummary: output, messageType: 'final_answer', content: output });
  }

  private redactToolResult(result: WorkspaceModelToolResult): Record<string, unknown> {
    const data = result.data === undefined ? undefined : JSON.stringify(result.data);
    return {
      ok: true,
      kind: result.kind,
      title: result.title,
      summary: result.summary,
      content: redactSensitiveText(result.content, this.options.redactSecrets),
      ...(data ? { data: JSON.parse(redactSensitiveText(data, this.options.redactSecrets)) } : {}),
      ...(result.plan ? { requiresConfirmation: true, action: result.plan.action, policyRef: result.plan.policyRef, manifest: result.plan.manifest } : {}),
    };
  }

  private async recordToolFailure(input: PiRuntimeEnqueueInput, step: StepRecord, failure: { toolName: string; code: string; summary: string }): Promise<void> {
    const finishedAt = new Date().toISOString();
    const output = `工具 ${failure.toolName} 调用失败（${failure.code}）：${failure.summary}。本次任务已停止，请修正后点击重连。`;
    await this.transitionStep(step, 'failed', { finishedAt, errorCode: failure.code, outputSummary: output });
    await this.transitionRun(input.run, 'failed', { finishedAt, errorCode: failure.code, resultSummary: output });
    const sessionId = input.sessionId ?? input.run.sessionId;
    await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'reasoning_summary', content: output, summary: `工具调用失败：${failure.toolName}` });
    await this.persistMessage({ adminId: input.adminId, sessionId, runId: input.run.id, messageType: 'final_answer', content: output });
    await this.emit(input.run.id, 'stream.completed', { status: 'failed', model: this.options.model, content: output, errorCode: failure.code });
    await this.emit(input.run.id, 'step.failed', { stepId: step.id, status: 'failed', errorCode: failure.code, messageType: 'final_answer', content: output, summary: output });
    await this.emit(input.run.id, 'runtime.failed', { status: 'failed', model: this.options.model, errorCode: failure.code, messageType: 'final_answer', content: output });
    await this.emit(input.run.id, 'run.failed', { status: 'failed', errorCode: failure.code, resultSummary: output, messageType: 'final_answer', content: output });
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

export function toModelsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('PI_RUNTIME_BASE_URL_REQUIRED');
  if (normalized.endsWith('/models')) return normalized;
  if (normalized.endsWith('/responses') || normalized.endsWith('/chat/completions')) return `${normalized.replace(/\/(responses|chat\/completions)$/u, '')}/models`;
  return normalized.endsWith('/v1') ? `${normalized}/models` : `${normalized}/v1/models`;
}

function normalizeWireApi(value: string | undefined): ModelWireApi {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'chat') return 'chat';
  if (normalized === 'responses') return 'responses';
  return DEFAULT_PI_WIRE_API;
}

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('retry-after')?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(3_600_000, Math.max(1_000, Math.trunc(seconds * 1000)));
  const date = Date.parse(raw);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(3_600_000, Math.max(1_000, date - Date.now()));
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
      content: typeof message.content === 'string' ? message.content : message.content.map((part) => part.type === 'text'
        ? { type: 'text', text: part.text }
        : part.type === 'image_url'
          ? { type: 'image_url', image_url: part.image_url }
          : { type: 'text', text: `附件：${part.file.filename}` }),
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
    : part.type === 'image_url'
      ? { type: 'input_image', image_url: part.image_url.url, ...(part.image_url.detail ? { detail: part.image_url.detail } : {}) }
      : { type: 'input_file', filename: part.file.filename, file_data: part.file.fileData });
}

function modelContentToText(content: ModelMessageContent): string {
  if (typeof content === 'string') return content;
  return content.map((part) => part.type === 'text' ? part.text : part.type === 'file' ? `附件：${part.file.filename}` : '').filter(Boolean).join('\n');
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
    toolCalls: state.toolCalls.size > 0 ? [...state.toolCalls.entries()].sort(([left], [right]) => left - right).map(([index, value]) => ({ id: value.id || `call_${index}`, type: 'function' as const, function: { name: value.name, arguments: value.arguments } })) : undefined,
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
      const argumentsDelta = typeof fn?.arguments === 'string' ? fn.arguments : fn?.arguments === undefined ? '' : JSON.stringify(fn.arguments);
      state.toolCalls.set(index, { id, name, arguments: current.arguments + argumentsDelta });
      await handlers.onToolCallDelta?.({ index, ...(id ? { id } : {}), ...(name ? { name } : {}), ...(argumentsDelta ? { argumentsDelta } : {}) });
    }
  }
  if (choice?.finish_reason === 'tool_calls') {
    for (const [index, value] of [...state.toolCalls.entries()].sort(([left], [right]) => left - right)) {
      if (value.name) await handlers.onToolCall?.({ id: value.id || `call_${index}`, type: 'function', function: { name: value.name, arguments: value.arguments } });
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
      const id = typeof item.call_id === 'string' && item.call_id.trim() ? item.call_id : typeof item.id === 'string' && item.id.trim() ? item.id : `call_${index}`;
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

function requestTimeoutMs(input: ModelCompletionRequest, providerTimeoutMs: number): number {
  if (Number.isFinite(input.deadlineAt)) return Math.max(1, Math.trunc((input.deadlineAt as number) - Date.now()));
  return providerTimeoutMs;
}

function normalizeAbortReason(reason: unknown): 'agent_deadline' | 'provider_timeout' | 'external_abort' | 'other' {
  if (reason === 'agent_deadline' || reason === 'provider_timeout' || reason === 'external_abort') return reason;
  if (reason && typeof reason === 'object' && 'kind' in reason && (reason as { kind?: unknown }).kind === 'agent_deadline') return 'agent_deadline';
  return 'other';
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
  return message.tool_calls.flatMap((candidate, index): ModelToolCall[] => {
    if (!isRecord(candidate) || candidate.type !== 'function') return [];
    const fn = isRecord(candidate.function) ? candidate.function : undefined;
    if (!fn || typeof fn.name !== 'string' || !fn.name.trim()) return [];
    const args = typeof fn.arguments === 'string' ? fn.arguments : fn.arguments === undefined ? '{}' : JSON.stringify(fn.arguments);
    return [{ id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : `call_${index}`, type: 'function', function: { name: fn.name, arguments: args } }];
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
  return payload.output.flatMap((item, index): ModelToolCall[] => {
    if (!isRecord(item) || item.type !== 'function_call') return [];
    const id = typeof item.call_id === 'string' && item.call_id.trim() ? item.call_id : typeof item.id === 'string' && item.id.trim() ? item.id : `call_${index}`;
    const name = typeof item.name === 'string' ? item.name : undefined;
    const args = typeof item.arguments === 'string' ? item.arguments : item.arguments === undefined ? undefined : JSON.stringify(item.arguments);
    if (!name || !name.trim() || args === undefined) return [];
    return [{ id, type: 'function', function: { name, arguments: args } }];
  });
}

function extractResponsesWebSearchUsed(payload: unknown): boolean {
  if (!isRecord(payload) || !Array.isArray(payload.output)) return false;
  return payload.output.some((item) => isRecord(item) && item.type === 'web_search_call');
}

function redactSensitiveText(value: string, secrets: string[] = []): string {
  const redacted = secrets.filter(Boolean).reduce((current, secret) => current.split(secret).join('[REDACTED]'), value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
  return redacted;
}

function toSafeFailure(error: unknown): { code: string; summary: string } {
  if (error instanceof PiModelClientError) {
    return { code: error.code, summary: summarizePiFailure(error) };
  }
  const candidate = isRecord(error) ? error : undefined;
  const code = typeof candidate?.code === 'string' ? candidate.code : undefined;
  const message = typeof candidate?.message === 'string' ? candidate.message.trim() : undefined;
  const inferredCode = code ?? message?.match(/\b[A-Z][A-Z0-9_]{2,}\b/)?.[0];
  const safeCodes = ['VALIDATION_FAILED', 'NO_CHANGES', 'NOT_FOUND', 'FORBIDDEN', 'CONFLICT', 'ACCOUNT_SCOPE_FORBIDDEN', 'ACCOUNT_RECOVERY_UNAVAILABLE', 'ACCOUNT_VERIFY_UNAVAILABLE', 'DELIVERY_NOT_READY', 'ORDER_DELIVERY_UNAVAILABLE', 'WORKSPACE_PRODUCT_REQUIRED', 'WORKSPACE_PRODUCT_NOT_FOUND', 'WORKSPACE_WRITE_REQUIRED', 'WORKSPACE_PRODUCT_SEARCH_REQUIRED', 'WORKSPACE_PRODUCT_SEARCH_UNAVAILABLE', 'MODEL_TOOL_RUNTIME_UNAVAILABLE', 'DUPLICATE_TOOL_CALL'];
  if (inferredCode?.startsWith('SKILL_')) return { code: inferredCode, summary: message ?? 'Pi Skill 执行失败' };
  if (inferredCode && message && safeCodes.includes(inferredCode)) {
    return { code: inferredCode, summary: message };
  }
  return { code: 'RUNTIME_FAILED', summary: 'Pi Runtime 执行失败，请稍后重试' };
}

function summarizePiFailure(error: PiModelClientError): string {
  if (error.code === 'MODEL_TOOL_LOOP_EXCEEDED') return '模型重复调用工具或超过 Workspace 工具循环预算，已停止本次执行。';
  if (error.code === 'MODEL_TIMEOUT') return '模型请求超时，未能在限定时间内完成。';
  if (error.code === 'MODEL_ABORTED') return '模型请求已取消。';
  if (error.code === 'MODEL_NETWORK_ERROR') return '模型服务网络请求失败。';
  if (error.code === 'MODEL_HTTP_ERROR') return '模型服务返回 HTTP 错误。';
  if (error.code === 'MODEL_UNSUPPORTED_TOOL') return '模型请求了当前运行时不支持的工具。';
  if (error.code === 'MODEL_INVALID_RESPONSE') {
    if (/tool loop|identical tool|repeat/i.test(error.message)) return '模型重复调用工具或超过 Workspace 工具循环预算，已停止本次执行。';
    if (/empty content|no result/i.test(error.message)) return '模型返回为空，未生成可用结果。';
    return '模型返回格式无效，未生成可用结果。';
  }
  return 'Pi Runtime 执行失败，请稍后重试';
}

function workspaceToolProgress(toolName: string): { summary: string; content: string } {
  const labels: Record<string, string> = {
    workspace_read: '读取工作区数据',
    workspace_product_search: '检索商品信息',
    workspace_prepare_write: '准备受控写入',
    pi_skill_list: '读取已安装 Skill',
    pi_skill_catalog: '读取 Skill 能力总览',
    pi_skill_read: '读取 Skill 使用说明',
    pi_skill_search: '检索 Skill 使用说明',
    pi_skill_install: '安装 Skill',
    pi_skill_login: '登录 Skill',
    pi_skill_exec: '执行 Skill 命令',
  };
  const label = labels[toolName] ?? `执行 ${toolName}`;
  return {
    summary: label,
    content: `正在${label}，等待工具返回真实结果。`,
  };
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

function parseModelToolArguments(raw: string): Record<string, unknown> {
  let candidate: unknown = raw?.trim() || '{}';
  for (let attempt = 0; attempt < 2 && typeof candidate === 'string'; attempt += 1) {
    const normalized = candidate.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    candidate = JSON.parse(normalized || '{}');
  }
  if (!isRecord(candidate) || Array.isArray(candidate)) throw new Error('invalid tool arguments');
  return candidate;
}

function normalizeModelToolResult(value: unknown, toolName?: string): { ok: true; result: WorkspaceModelToolResult } | { ok: false; failure: { code: string; summary: string } } {
  let candidate = value;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch { return { ok: false, failure: { code: 'INVALID_TOOL_RESULT', summary: '工具返回结果不是有效 JSON' } }; }
  }
  if (!isRecord(candidate)) return { ok: false, failure: { code: 'INVALID_TOOL_RESULT', summary: '工具返回结果不是对象' } };
  if (candidate.ok === false) {
    return {
      ok: false,
      failure: {
        code: typeof candidate.code === 'string' && candidate.code.trim() ? candidate.code : 'TOOL_FAILED',
        summary: typeof candidate.message === 'string' && candidate.message.trim() ? candidate.message : '工具返回失败结果',
      },
    };
  }
  const data = isRecord(candidate.data) ? candidate.data : undefined;
  if (toolName?.startsWith('pi_skill_') && (data?.status === 'failed' || (toolName === 'pi_skill_exec' && typeof data?.code === 'number' && data.code !== 0 && data.requiresLogin !== true && data.userActionRequired !== true && data.status !== 'pending_user_action'))) {
    return { ok: false, failure: { code: 'SKILL_EXEC_FAILED', summary: typeof candidate.summary === 'string' ? candidate.summary : 'Skill 执行失败' } };
  }
  if (typeof candidate.kind !== 'string' || !candidate.kind.trim() || typeof candidate.title !== 'string' || typeof candidate.summary !== 'string' || typeof candidate.content !== 'string') {
    return { ok: false, failure: { code: 'INVALID_TOOL_RESULT', summary: '工具返回结果缺少可消费的 kind/title/summary/content 字段' } };
  }
  return { ok: true, result: candidate as unknown as WorkspaceModelToolResult };
}

function replayableToolKey(toolName: string, args: Record<string, unknown>): string | undefined {
  const category = replayableCategory(toolName, args);
  return category ? `${toolName}:${category}:${createHash('sha256').update(JSON.stringify(canonicalJson(args))).digest('hex')}` : undefined;
}

function replayableCategory(toolName: string, args: Record<string, unknown>): 'read' | 'write' | undefined {
  if (toolName === 'workspace_read' || toolName === 'workspace_product_search' || toolName === 'pi_skill_list' || toolName === 'pi_skill_catalog' || toolName === 'pi_skill_read' || toolName === 'pi_skill_search') return 'read';
  if (toolName === 'pi_skill_exec') return skillCommandIsReadOnly(args) ? 'read' : 'write';
  return undefined;
}

function toolInvalidatesReplayableReads(toolName: string, args: Record<string, unknown>, result: WorkspaceModelToolResult): boolean {
  if (toolName === 'pi_skill_install' || toolName === 'pi_skill_authorize') return true;
  if (toolName === 'pi_skill_login') return result.data?.status === 'succeeded';
  return replayableCategory(toolName, args) === 'write';
}

function replayableCallIsReadOnly(toolName: string, raw: string): boolean | undefined {
  try {
    const category = replayableCategory(toolName, parseModelToolArguments(raw));
    return category === undefined ? undefined : category === 'read';
  }
  catch { return undefined; }
}

function skillCommandIsReadOnly(args: Record<string, unknown>): boolean {
  const command = typeof args.command === 'string' ? args.command.trim().toLowerCase() : '';
  const readCommands = new Set(['search', 'browse', 'list', 'get-user-info', 'info', 'help']);
  const helpOnly = command === 'quark-drive' && Array.isArray(args.args) && args.args.length === 1 && args.args[0] === '--help';
  return readCommands.has(command) || /^(?:get|list|search|browse|info|check)(?:[-_.].*)?$/.test(command) || helpOnly;
}

type SkillProgressPhase = 'discovery' | 'execution';

interface SkillProgressState {
  phase: SkillProgressPhase;
  noProgressCount: number;
  discoveryCalls: number;
  executionCalls: number;
  evidenceKeys: Set<string>;
  suggestedTool?: string;
}

function restoreSkillProgress(events: RunEventRecord[]): SkillProgressState {
  const state: SkillProgressState = { phase: 'discovery', noProgressCount: 0, discoveryCalls: 0, executionCalls: 0, evidenceKeys: new Set<string>() };
  for (const event of events) {
    if (event.eventType !== 'workspace.skill.progress') continue;
    const payload = event.payload;
    if (payload.phase === 'execution' || payload.phase === 'discovery') state.phase = payload.phase;
    if (typeof payload.noProgressCount === 'number') state.noProgressCount = Math.max(0, Math.trunc(payload.noProgressCount));
    if (typeof payload.discoveryCalls === 'number') state.discoveryCalls = Math.max(0, Math.trunc(payload.discoveryCalls));
    if (typeof payload.executionCalls === 'number') state.executionCalls = Math.max(0, Math.trunc(payload.executionCalls));
    if (typeof payload.evidenceFingerprint === 'string' && payload.evidenceFingerprint) state.evidenceKeys.add(payload.evidenceFingerprint);
    if (typeof payload.suggestedTool === 'string') state.suggestedTool = payload.suggestedTool;
  }
  return state;
}

function updateSkillProgress(state: SkillProgressState, toolName: string, args: Record<string, unknown>, result: WorkspaceModelToolResult): { phase: SkillProgressPhase; noProgressCount: number; discoveryCalls: number; executionCalls: number; evidenceFingerprint: string; progressed: boolean; suggestedTool?: string } {
  const phase: SkillProgressPhase = toolName === 'pi_skill_exec' && !skillCommandIsReadOnly(args) ? 'execution' : 'discovery';
  if (phase === 'execution') {
    state.executionCalls += 1;
    state.phase = 'execution';
    state.noProgressCount = 0;
  } else {
    state.discoveryCalls += 1;
    state.phase = 'discovery';
  }
  const fingerprint = skillEvidenceFingerprint(toolName, result);
  const progressed = phase === 'execution' || !state.evidenceKeys.has(fingerprint);
  if (progressed) state.noProgressCount = 0;
  else state.noProgressCount += 1;
  state.evidenceKeys.add(fingerprint);
  const suggestedTool = phase === 'discovery' && hasCommandEvidence(result) ? 'pi_skill_exec' : state.suggestedTool;
  state.suggestedTool = suggestedTool;
  return { phase: state.phase, noProgressCount: state.noProgressCount, discoveryCalls: state.discoveryCalls, executionCalls: state.executionCalls, evidenceFingerprint: fingerprint, progressed, suggestedTool };
}

function skillEvidenceFingerprint(toolName: string, result: WorkspaceModelToolResult): string {
  const data = isRecord(result.data) ? result.data : undefined;
  if (data?.matches === 0 || /no\s+skill\s+instruction\s+matches|no\s+matches/i.test(result.summary)) return `${toolName}:no-match`;
  const normalized = JSON.stringify({ toolName, summary: result.summary, content: result.content.replace(/line\s+\d+:/gi, 'line:').slice(0, 2_000), data: data ? { sourceFile: data.sourceFile, parsed: data.parsed, code: data.code, status: data.status } : undefined });
  return createHash('sha256').update(normalized).digest('hex');
}

function hasCommandEvidence(result: WorkspaceModelToolResult): boolean {
  const data = isRecord(result.data) ? result.data : undefined;
  return Array.isArray(data?.commandEvidence) && data.commandEvidence.some((item) => isRecord(item) && typeof item.command === 'string' && item.command.trim().length > 0);
}

function clearReplayableReads(results: Map<string, WorkspaceModelToolResult>, preserveSkillReadCache = false): void {
  for (const key of results.keys()) {
    const preserve = preserveSkillReadCache && (
      key.startsWith('workspace_product_search:read:')
      || key.startsWith('pi_skill_catalog:read:')
      || key.startsWith('pi_skill_read:read:')
      || key.startsWith('pi_skill_search:read:')
    );
    if (isReadReplayKey(key) && !preserve) results.delete(key);
  }
}

function upsertWorkspacePlanMessage(messages: ModelMessage[], content: string): void {
  const existingIndex = messages.findIndex((message) => message.role === 'system' && typeof message.content === 'string' && message.content.startsWith('[WORKSPACE_PLAN]'));
  if (existingIndex >= 0) {
    messages[existingIndex] = { role: 'system', content };
    return;
  }
  const firstNonSystem = messages.findIndex((message) => message.role !== 'system');
  messages.splice(firstNonSystem < 0 ? messages.length : firstNonSystem, 0, { role: 'system', content });
}

function cachedReplayableEvidence(results: Map<string, WorkspaceModelToolResult>): string[] {
  const evidence: string[] = [];
  for (const result of [...results.values()].slice(-8)) {
    const identifiers = planIdentifiers(JSON.stringify(result));
    const detail = [result.summary, result.content.slice(0, 180), identifiers.length ? identifiers.join('；') : ''].filter(Boolean).join('；');
    if (detail) evidence.push(detail.slice(0, 320));
  }
  return [...new Set(evidence)];
}

function planEvidence(result: WorkspaceModelToolResult): string {
  const identifiers = planIdentifiers(JSON.stringify(result));
  return [result.summary, identifiers.length ? identifiers.join('；') : result.content.slice(0, 180)].filter(Boolean).join('；').slice(0, 350);
}

function planIdentifiers(value: string): string[] {
  const ids = value.match(/(?:batchId|productId|shareId|fid|externalProductRef)["=:\s]+[A-Za-z0-9_-]+/g) ?? [];
  const urls = value.match(/https?:\/\/[^\s"'\\]+/g) ?? [];
  return [...new Set([...ids, ...urls])].slice(-6);
}

function clearReplayableReadAttempts(attempts: Map<string, number>, preserveSkillReadCache = false): void {
  for (const key of attempts.keys()) {
    const preserve = preserveSkillReadCache && (
      key.startsWith('workspace_product_search:read:')
      || key.startsWith('pi_skill_catalog:read:')
      || key.startsWith('pi_skill_read:read:')
      || key.startsWith('pi_skill_search:read:')
    );
    if (isReadReplayKey(key) && !preserve) attempts.delete(key);
  }
}

function isReadReplayKey(key: string): boolean {
  return key.includes(':read:');
}

function isReusableToolResult(result: WorkspaceModelToolResult, toolName?: string): boolean {
  const readLike = result.kind === 'read' || (toolName === 'workspace_product_search' && result.kind === 'products');
  if (!readLike) return false;
  const data = isRecord(result.data) ? result.data : undefined;
  return data?.status !== 'failed' && data?.status !== 'unauthorized' && data?.status !== 'pending_user_action'
    && data?.requiresLogin !== true && data?.userActionRequired !== true
    && (typeof data?.code !== 'number' || data.code === 0);
}

function toolArgumentFingerprint(raw: string): string | undefined {
  try { return createHash('sha256').update(JSON.stringify(canonicalJson(parseModelToolArguments(raw)))).digest('hex'); }
  catch { return undefined; }
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalJson(item)]));
  return value;
}

function completedReplayableResults(events: RunEventRecord[]): Map<string, WorkspaceModelToolResult> {
  const calls = new Map<string, string>();
  const results = new Map<string, WorkspaceModelToolResult>();
  for (const event of events) {
    const payload = event.payload;
    if ((event.eventType === 'workspace.command.completed' || event.eventType === 'workspace.coupon.created') && payload.status === 'succeeded') clearReplayableReads(results);
    if (event.eventType === 'tool.call.started' && typeof payload.toolName === 'string' && typeof payload.toolCallId === 'string') {
      try {
        const knownRead = payload.toolName === 'workspace_read' || payload.toolName === 'workspace_product_search' || payload.toolName === 'pi_skill_list' || payload.toolName === 'pi_skill_catalog' || payload.toolName === 'pi_skill_read' || payload.toolName === 'pi_skill_search';
        const readOnly = knownRead ? true : payload.toolName === 'pi_skill_exec' && typeof payload.readOnly === 'boolean' ? payload.readOnly : undefined;
        const key = typeof payload.argumentFingerprint === 'string' && typeof readOnly === 'boolean'
          ? `${payload.toolName}:${readOnly ? 'read' : 'write'}:${payload.argumentFingerprint}`
          : typeof payload.arguments === 'string' ? replayableToolKey(payload.toolName, parseModelToolArguments(payload.arguments)) : undefined;
        if (key) calls.set(payload.toolCallId, key);
      } catch { /* Invalid arguments were never executed successfully. */ }
    }
    if (event.eventType === 'tool.result' && payload.status === 'succeeded' && typeof payload.toolCallId === 'string') {
      const key = calls.get(payload.toolCallId);
      const toolName = typeof payload.toolName === 'string' ? payload.toolName : undefined;
      const result = normalizeModelToolResult(payload.result, toolName);
      if (result.ok) {
        const invalidatesReads = toolName === 'pi_skill_install' || toolName === 'pi_skill_authorize'
          || (toolName === 'pi_skill_login' && result.result.data?.status === 'succeeded')
          || (key !== undefined && !isReadReplayKey(key));
        if (invalidatesReads) clearReplayableReads(results, toolName === 'pi_skill_exec' && result.result.kind === 'read');
        if (key && isReusableToolResult(result.result, toolName)) results.set(key, result.result);
      }
    }
  }
  return results;
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
