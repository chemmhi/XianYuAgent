import type { ModelProgressSnapshot } from './pi-runtime.js';

export type AutoReplyTimeoutPhase = 'model_generation' | 'tool_wait' | 'reply_segmentation' | 'send_wait';

export interface AutoReplyDeadline {
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
  remainingMs(): number;
  dispose(): void;
}

export class AutoReplyDeadlineError extends Error {
  readonly code = 'AGENT_TOTAL_TIMEOUT';
  readonly origin = 'agent_deadline' as const;
  readonly timeoutPhase: AutoReplyTimeoutPhase;

  constructor(timeoutPhase: AutoReplyTimeoutPhase) {
    super(`auto reply agent exceeded its total deadline during ${timeoutPhase}`);
    this.name = 'AutoReplyDeadlineError';
    this.timeoutPhase = timeoutPhase;
  }
}

export function createAutoReplyDeadline(totalTimeoutMs: number, now: () => number = Date.now): AutoReplyDeadline {
  const deadlineAt = now() + Math.max(1, Math.trunc(totalTimeoutMs));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort({ kind: 'agent_deadline' }), Math.max(1, deadlineAt - now()));
  timer.unref?.();
  return {
    controller,
    signal: controller.signal,
    deadlineAt,
    remainingMs: () => Math.max(0, deadlineAt - now()),
    dispose: () => clearTimeout(timer),
  };
}

export function withAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, phase: AutoReplyTimeoutPhase): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal.reason, phase));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortError(signal.reason, phase)));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export function timeoutProgress(error: unknown): ModelProgressSnapshot | undefined {
  const candidate = error as { modelProgress?: unknown } | null;
  const progress = candidate?.modelProgress;
  if (!progress || typeof progress !== 'object') return undefined;
  const value = progress as Partial<ModelProgressSnapshot>;
  return {
    firstEventAt: typeof value.firstEventAt === 'number' ? value.firstEventAt : undefined,
    lastProgressAt: typeof value.lastProgressAt === 'number' ? value.lastProgressAt : undefined,
    maxIdleMs: typeof value.maxIdleMs === 'number' && Number.isFinite(value.maxIdleMs) ? Math.max(0, value.maxIdleMs) : 0,
    emittedAny: value.emittedAny === true,
  };
}

function abortError(reason: unknown, phase: AutoReplyTimeoutPhase): Error {
  if (reason && typeof reason === 'object' && (reason as { kind?: unknown }).kind === 'agent_deadline') return new AutoReplyDeadlineError(phase);
  if (reason === 'agent_deadline') return new AutoReplyDeadlineError(phase);
  const error = new Error(`auto reply agent request aborted during ${phase}`);
  error.name = 'AutoReplyAbortError';
  return error;
}
