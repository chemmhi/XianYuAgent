import type { ModelClient, ModelCompletionRequest, ModelCompletionResult, ModelStreamHandlers } from './pi-runtime.js';

export type { ModelClient, ModelCompletionRequest, ModelCompletionResult, ModelMessage, ModelToolCall, ModelToolDefinition, ModelStreamHandlers, ModelToolCallDelta } from './pi-runtime.js';

export interface ModelClientFailoverEvent {
  provider: 'primary' | 'backup';
  error: unknown;
}

export interface ModelClientServiceOptions {
  primary: ModelClient;
  backup?: ModelClient;
  onFailover?: (event: ModelClientFailoverEvent) => void | Promise<void>;
}

/**
 * Single business-facing model service.
 *
 * Business modules must depend on this abstraction and never construct a
 * provider transport directly. The service owns primary/backup selection and
 * keeps provider-specific failures out of feature code.
 */
export class ModelClientService implements ModelClient {
  readonly supportsWebSearch: boolean;

  private readonly primary: ModelClient;
  private readonly backup?: ModelClient;
  private readonly onFailover?: ModelClientServiceOptions['onFailover'];

  constructor(options: ModelClientServiceOptions) {
    this.primary = options.primary;
    this.backup = options.backup;
    this.onFailover = options.onFailover;
    this.supportsWebSearch = this.primary.supportsWebSearch !== false && this.backup?.supportsWebSearch !== false;
  }

  async complete(input: ModelCompletionRequest): Promise<ModelCompletionResult> {
    try {
      return await this.primary.complete(input);
    } catch (error) {
      if (!this.backup) throw error;
      await this.emitFailover({ provider: 'primary', error });
      return this.backup.complete(input);
    }
  }

  async stream(input: ModelCompletionRequest, handlers: ModelStreamHandlers = {}): Promise<ModelCompletionResult> {
    const stream = this.primary.stream;
    try {
      if (stream) return await stream.call(this.primary, input, handlers);
      const result = await this.primary.complete(input);
      if (result.content) await handlers.onTextDelta?.(result.content);
      for (const call of result.toolCalls ?? []) await handlers.onToolCall?.(call);
      await handlers.onDone?.(result);
      return result;
    } catch (error) {
      if (!this.backup) throw error;
      await this.emitFailover({ provider: 'primary', error });
      const backupStream = this.backup.stream;
      if (backupStream) return backupStream.call(this.backup, input, handlers);
      const result = await this.backup.complete(input);
      if (result.content) await handlers.onTextDelta?.(result.content);
      for (const call of result.toolCalls ?? []) await handlers.onToolCall?.(call);
      await handlers.onDone?.(result);
      return result;
    }
  }

  private async emitFailover(event: ModelClientFailoverEvent): Promise<void> {
    try {
      await this.onFailover?.(event);
    } catch {
      // Observability must never prevent the backup provider from being tried.
    }
  }
}

export function createModelClientService(primary: ModelClient, backup?: ModelClient, onFailover?: ModelClientServiceOptions['onFailover']): ModelClientService {
  return new ModelClientService({ primary, backup, onFailover });
}
