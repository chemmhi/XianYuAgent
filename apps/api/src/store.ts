import type { AppConfig } from './config.js';
import type { Store } from './domain.js';
import { MemoryStore } from './store-memory.js';
import { PostgresStore } from './store-postgres.js';

export function createStore(config: AppConfig): Store {
  if (config.databaseUrl && !config.allowInMemory) return new PostgresStore(config.databaseUrl);
  return new MemoryStore();
}
