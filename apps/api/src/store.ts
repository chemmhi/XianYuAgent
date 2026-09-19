import type { AppConfig } from './config.js';
import type { Store } from './domain.js';
import { MemoryStore } from './store-memory.js';
import { PostgresStore } from './store-postgres.js';

export function createStore(config: AppConfig): Store {
  if (config.allowInMemory) return new MemoryStore();
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required when ALLOW_IN_MEMORY=false');
  return new PostgresStore(config.databaseUrl);
}
