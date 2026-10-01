import type { ModelClient, ModelCompletionRequest, ModelCompletionResult } from './pi-runtime.js';

export type { ModelClient, ModelCompletionRequest, ModelCompletionResult, ModelMessage, ModelToolCall, ModelToolDefinition } from './pi-runtime.js';

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
