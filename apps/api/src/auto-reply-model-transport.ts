import type { ModelClient, ModelCompletionRequest, ModelCompletionResult, ModelProgressSnapshot, ModelStreamHandlers } from './pi-runtime.js';

export async function completeBufferedModel(client: ModelClient, input: ModelCompletionRequest): Promise<ModelCompletionResult> {
  const tracker = new ProgressTracker();
  const request = { ...input, buffered: true };
  const handlers: ModelStreamHandlers = {
    onTextDelta: async () => tracker.mark(),
    onReasoningDelta: async () => tracker.mark(),
    onToolCallDelta: async () => tracker.mark(),
    onToolCall: async () => tracker.mark(),
  };
  try {
    if (client.stream) return await client.stream(request, handlers);
    return await client.complete(request);
  } catch (error) {
    if (error && typeof error === 'object') (error as { modelProgress?: ModelProgressSnapshot }).modelProgress = tracker.snapshot();
    throw error;
  }
}

class ProgressTracker {
  private firstEventAt?: number;
  private lastProgressAt?: number;
  private maxIdleMs = 0;

  mark(now = Date.now()): void {
    if (this.lastProgressAt !== undefined) this.maxIdleMs = Math.max(this.maxIdleMs, now - this.lastProgressAt);
    this.firstEventAt ??= now;
    this.lastProgressAt = now;
  }

  snapshot(now = Date.now()): ModelProgressSnapshot {
    const tailIdleMs = this.lastProgressAt === undefined ? 0 : Math.max(0, now - this.lastProgressAt);
    return { firstEventAt: this.firstEventAt, lastProgressAt: this.lastProgressAt, maxIdleMs: Math.max(this.maxIdleMs, tailIdleMs), emittedAny: this.firstEventAt !== undefined };
  }
}
