import type { RunEventRecord, RunRecord, RunStatus, StepRecord, StepStatus, Store } from './domain.js';
import type { WorkspaceRuntime } from './workspace.js';

export const DEFAULT_PI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_PI_MODEL = 'gpt-4o-mini';
export const DEFAULT_PI_TIMEOUT_MS = 30_000;

export type ModelMessageRole = 'system' | 'user' | 'assistant';

export interface ModelMessage {
  role: ModelMessageRole;
  content: string;
}

export interface ModelCompletionRequest {
  messages: ModelMessage[];
  signal?: AbortSignal;
}

export interface ModelCompletionResult {
  content: string;
  model: string;
  usage?: Record<string, unknown>;
}

export interface ModelClient {
  complete(input: ModelCompletionRequest): Promise<ModelCompletionResult>;
}

export interface PiRuntimeConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface OpenAICompatibleModelClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type PiModelErrorCode =
  | 'MODEL_ABORTED'
  | 'MODEL_TIMEOUT'
  | 'MODEL_HTTP_ERROR'
  | 'MODEL_NETWORK_ERROR'
  | 'MODEL_INVALID_RESPONSE';

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
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAICompatibleModelClientOptions) {
    if (!options.apiKey.trim()) throw new Error('PI_RUNTIME_API_KEY_REQUIRED');
    if (!options.model.trim()) throw new Error('PI_RUNTIME_MODEL_REQUIRED');
    this.endpoint = toChatCompletionsEndpoint(options.baseUrl);
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
        body: JSON.stringify({ model: this.options.model, messages: input.messages }),
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

      const content = extractCompletionContent(payload);
      if (!content) throw new PiModelClientError('MODEL_INVALID_RESPONSE', 'model provider returned empty content');
      const record = isRecord(payload) ? payload : undefined;
      return {
        content,
        model: typeof record?.model === 'string' && record.model.trim() ? record.model : this.options.model,
        usage: isRecord(record?.usage) ? record.usage : undefined,
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
  messageSink?: (message: PiRuntimeMessage) => void | Promise<void>;
  onEvent?: (event: PiRuntimeEvent) => void | Promise<void>;
}

export interface PiRuntimeEnqueueInput {
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
      await this.persistMessage({ sessionId, runId: input.run.id, messageType: 'user_message', content: redactSensitiveText(input.run.instruction, this.options.outputLimit ?? 2_000, this.options.redactSecrets) });
      const startedAt = new Date().toISOString();
      await this.transitionRun(input.run, 'running', { startedAt });
      await this.transitionStep(step, 'running', { startedAt });
      await this.emit(input.run.id, 'run.started', { status: 'running' });
      await this.emit(input.run.id, 'step.started', { stepId: step.id, status: 'running' });
      await this.emit(input.run.id, 'runtime.started', { status: 'running', model: this.options.model, messageType: 'tool_event' });

      await this.transitionRun(input.run, 'executing');
      await this.transitionStep(step, 'executing');
      await this.emit(input.run.id, 'run.executing', { status: 'executing', messageType: 'tool_event' });
      await this.emit(input.run.id, 'step.executing', { stepId: step.id, status: 'executing', messageType: 'tool_event' });

      const result = await this.modelClient.complete({
        messages: [...(input.history ?? []), { role: 'user', content: input.run.instruction }],
        signal,
      });
      if (this.stopped || signal.aborted) return;

      const finishedAt = new Date().toISOString();
      const output = redactSensitiveText(result.content, this.options.outputLimit ?? 2_000, this.options.redactSecrets);
      await this.transitionStep(step, 'succeeded', { finishedAt, outputSummary: output });
      await this.transitionRun(input.run, 'succeeded', { finishedAt, resultSummary: output });
      await this.persistMessage({ sessionId, runId: input.run.id, messageType: 'reasoning_summary', content: 'Pi Runtime 已完成模型生成步骤', summary: step.label });
      await this.persistMessage({ sessionId, runId: input.run.id, messageType: 'final_answer', content: output });
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
      await this.persistMessage({ sessionId, runId: run.id, messageType: 'final_answer', content: failure.summary });
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
  const apiKey = firstNonEmpty(env.API_KEY, env.OPENAI_API_KEY);
  if (!apiKey) return undefined;
  return {
    apiKey,
    baseUrl: firstNonEmpty(env.BASE_URL, env.OPENAI_BASE_URL) ?? DEFAULT_PI_BASE_URL,
    model: firstNonEmpty(env.MODEL, env.OPENAI_MODEL) ?? DEFAULT_PI_MODEL,
    timeoutMs: positiveInteger(env.PI_RUNTIME_TIMEOUT_MS ?? env.MODEL_TIMEOUT_MS, DEFAULT_PI_TIMEOUT_MS),
  };
}

export function createPiRuntimeAdapterFromEnv(store: Store, env: NodeJS.ProcessEnv = process.env): PiRuntimeAdapter | undefined {
  const config = loadPiRuntimeConfig(env);
  if (!config) return undefined;
  return new PiRuntimeAdapter(store, new OpenAICompatibleModelClient(config), { model: config.model, redactSecrets: [config.apiKey] });
}

export function toChatCompletionsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('PI_RUNTIME_BASE_URL_REQUIRED');
  if (normalized.endsWith('/chat/completions')) return normalized;
  return normalized.endsWith('/v1') ? `${normalized}/chat/completions` : `${normalized}/v1/chat/completions`;
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
