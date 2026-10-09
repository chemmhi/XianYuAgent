import { Redis } from 'ioredis';
import type { OpenAIResolvedConfig } from './openai-settings.js';
import type { ModelProviderRoutingRecord } from './domain.js';
import { ModelClientService, type ModelClientRuntimeSnapshot, type ModelProviderCircuitSnapshot, type ModelProviderRole } from './model-client.js';
import { PiModelClientError, type ModelClient } from './pi-runtime.js';

export interface ModelProviderRuntimePoolOptions {
  createClient: (config: OpenAIResolvedConfig) => Promise<ModelClient>;
  loadAccount?: (adminId: string, accountId: string) => Promise<{ configs: OpenAIResolvedConfig[]; mode: 'auto' | 'manual_primary' | 'manual_backup'; preferredRole?: ModelProviderRole; routingVersion: number; configGeneration: number }>;
  overallTimeoutMs?: number;
  redisUrl?: string;
  onFailover?: (input: { adminId: string; accountId: string; provider: ModelProviderRole; error: unknown; cooldownUntil?: string }) => void | Promise<void>;
  onStateChange?: (input: { adminId: string; accountId: string; snapshot: ModelClientRuntimeSnapshot }) => void | Promise<void>;
  onFastFail?: (input: { adminId: string; accountId: string; reason: string; snapshot: ModelClientRuntimeSnapshot }) => void | Promise<void>;
  onRedisDegraded?: (input: { adminId?: string; accountId?: string; error: unknown }) => void | Promise<void>;
}

type PersistedSnapshot = ModelClientRuntimeSnapshot & { updatedAt: string };
type PoolEntry = { signature: string; generation: number; service: ModelClientService; lastUsedAt: number; adminId: string; accountId: string; probeTimeoutMs: Partial<Record<ModelProviderRole, number>> };

const STATE_PREFIX = 'model:provider:state:v2';
const DUE_KEY = 'model:probe:due:v2';
const ROUTING_PREFIX = 'model:routing:v2';

/** Account-scoped client pool. Routing is refreshed from the caller on every resolve; transport and breaker state are reused. */
export class ModelProviderRuntimePool {
  private readonly entries = new Map<string, PoolEntry>();
  private readonly persistChains = new Map<string, Promise<void>>();
  private readonly redis?: Redis;
  private scheduler?: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(private readonly options: ModelProviderRuntimePoolOptions) {
    if (options.redisUrl?.trim()) {
      this.redis = new Redis(options.redisUrl, {
        lazyConnect: true,
        connectTimeout: 1_000,
        enableReadyCheck: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy: (attempt: number) => Math.min(1_000, Math.max(100, attempt * 100)),
      });
      this.redis.on('error', (error) => { void this.options.onRedisDegraded?.({ error }); });
    }
  }

  async resolve(input: { adminId: string; accountId: string; configs: OpenAIResolvedConfig[]; mode: 'auto' | 'manual_primary' | 'manual_backup'; preferredRole?: ModelProviderRole; routingVersion: number; configGeneration?: number }): Promise<ModelClientService> {
    const configs = input.configs.slice(0, 2);
    const generation = Math.max(0, Math.trunc(input.configGeneration ?? configs.reduce((max, item) => Math.max(max, item.version), 0)));
    const signature = configs.map((item) => `${item.role}:${item.id ?? 'none'}:${item.version}:${item.fingerprint ?? ''}`).join('|');
    const key = `${input.adminId}:${input.accountId}`;
    const existing = this.entries.get(key);
    let service: ModelClientService;
    if (!existing || existing.signature !== signature || existing.generation !== generation) {
      const creations = await Promise.allSettled(configs.map((item) => this.options.createClient(item)));
      const clients = creations.map((result) => result.status === 'fulfilled' ? result.value : undefined);
      const constructionErrors: Partial<Record<ModelProviderRole, string>> = {};
      creations.forEach((result, index) => {
        if (result.status !== 'rejected') return;
        const role = configs[index]?.role;
        if (role) constructionErrors[role] = constructionErrorCode(result.reason);
      });
      const primaryIndex = configs.findIndex((item) => item.role === 'primary');
      const backupIndex = configs.findIndex((item) => item.role === 'backup');
      service = new ModelClientService({
        primary: primaryIndex >= 0 ? clients[primaryIndex] : undefined,
        backup: backupIndex >= 0 ? clients[backupIndex] : undefined,
        constructionErrors,
        mode: input.mode,
        preferredRole: input.preferredRole,
        routingVersion: input.routingVersion,
        configGeneration: generation,
        overallTimeoutMs: this.options.overallTimeoutMs,
        onFailover: (event) => this.options.onFailover?.({ adminId: input.adminId, accountId: input.accountId, provider: event.provider, error: event.error, cooldownUntil: event.cooldownUntil }),
        onFastFail: (event) => this.options.onFastFail?.({ adminId: input.adminId, accountId: input.accountId, reason: event.reason, snapshot: event.snapshot }),
        onStateChange: () => this.persistEntrySnapshot(input.adminId, input.accountId),
      });
      const probeTimeoutMs: Partial<Record<ModelProviderRole, number>> = {};
      for (const item of configs) probeTimeoutMs[item.role] = normalizedProbeTimeoutMs(item);
      this.entries.set(key, { signature, generation, service, lastUsedAt: Date.now(), adminId: input.adminId, accountId: input.accountId, probeTimeoutMs });
    } else {
      service = existing.service;
      existing.lastUsedAt = Date.now();
      service.setRouting({ mode: input.mode, preferredRole: input.preferredRole, routingVersion: input.routingVersion });
    }
    const persisted = await this.loadPersistedSnapshot(input.accountId, generation);
    if (persisted) service.hydrateCircuitSnapshots({ ...persisted, generation: persisted.configGeneration });
    return service;
  }

  async forceProbe(input: { adminId: string; accountId: string; role: ModelProviderRole }): Promise<Awaited<ReturnType<ModelClientService['safeProbe']>>> {
    const entry = this.entries.get(`${input.adminId}:${input.accountId}`);
    if (!entry) throw new Error('MODEL_PROVIDER_RUNTIME_NOT_READY');
    const generation = entry.service.getRuntimeSnapshot().configGeneration;
    const token = `${process.pid}:${Math.random().toString(36).slice(2, 10)}`;
    const leaseKey = `model:probe:lease:${input.accountId}:${input.role}:${generation}`;
    if (!(await this.tryAcquireLease(leaseKey, token, probeLeaseTtlMs(entry.probeTimeoutMs[input.role])))) return { ok: false, code: 'PROBE_FAILED', latencyMs: 0 };
    try {
      const result = await entry.service.probeProvider(input.role);
      await this.persistEntrySnapshot(input.adminId, input.accountId);
      return result;
    } finally { await this.releaseLease(leaseKey, token); }
  }

  async syncRouting(input: { accountId: string; routing: unknown }): Promise<void> {
    if (!this.redis || this.closed) return;
    try {
      await this.ensureRedis();
      await this.redis.set(`${ROUTING_PREFIX}:${input.accountId}`, JSON.stringify(input.routing));
      await this.redis.publish(`${ROUTING_PREFIX}:events`, JSON.stringify({ accountId: input.accountId }));
    } catch (error) {
      void this.options.onRedisDegraded?.({ accountId: input.accountId, error });
      throw new Error('MODEL_ROUTING_STATE_UNAVAILABLE');
    }
  }

  async readRoutingMirror(accountId: string): Promise<ModelProviderRoutingRecord | undefined> {
    if (!this.redis || this.closed) return undefined;
    try {
      await this.ensureRedis();
      const raw = await this.redis.get(`${ROUTING_PREFIX}:${accountId}`);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as ModelProviderRoutingRecord;
      return parsed?.accountId === accountId ? parsed : undefined;
    } catch (error) {
      void this.options.onRedisDegraded?.({ accountId, error });
      return undefined;
    }
  }

  getSnapshot(adminId: string, accountId: string): ModelClientRuntimeSnapshot | undefined { return this.entries.get(`${adminId}:${accountId}`)?.service.getRuntimeSnapshot(); }

  startScheduler(intervalMs = 5_000): void {
    if (this.scheduler) return;
    this.scheduler = setInterval(() => { void this.probeDue(); }, Math.max(1_000, intervalMs));
    this.scheduler.unref?.();
  }

  stopScheduler(): void { if (this.scheduler) clearInterval(this.scheduler); this.scheduler = undefined; }

  async probeDue(): Promise<void> {
    for (const entry of this.entries.values()) {
      try {
        const snapshot = entry.service.getRuntimeSnapshot();
        for (const role of ['primary', 'backup'] as const) {
          const state = snapshot.providerStates[role];
          if (state?.state !== 'OPEN' || !state.nextProbeAt || Date.parse(state.nextProbeAt) > Date.now()) continue;
          const token = `${process.pid}:${Math.random().toString(36).slice(2, 10)}`;
          const leaseKey = `model:probe:lease:${entry.accountId}:${role}:${snapshot.configGeneration}`;
          if (!(await this.tryAcquireLease(leaseKey, token, probeLeaseTtlMs(entry.probeTimeoutMs[role])))) continue;
          try { await entry.service.probeProvider(role); } finally { await this.releaseLease(leaseKey, token); }
        }
        await this.persistEntrySnapshot(entry.adminId, entry.accountId);
      } catch (error) { void this.options.onRedisDegraded?.({ adminId: entry.adminId, accountId: entry.accountId, error }); }
    }
    if (!this.redis || !this.options.loadAccount || this.closed) return;
    try {
      await this.ensureRedis();
      const dueMembers = await this.redis.zrangebyscore(DUE_KEY, '-inf', String(Date.now()), 'LIMIT', 0, 100);
      for (const member of dueMembers) {
        const [adminId, accountId, generationText, role] = member.split(':');
        if (!adminId || !accountId || !generationText || (role !== 'primary' && role !== 'backup')) continue;
        const loaded = await this.options.loadAccount(adminId, accountId);
        const service = await this.resolve({ adminId, accountId, ...loaded });
        const generation = Number(generationText);
        if (service.getRuntimeSnapshot().configGeneration !== generation) continue;
        const token = `${process.pid}:${Math.random().toString(36).slice(2, 10)}`;
        const leaseKey = `model:probe:lease:${accountId}:${role}:${generation}`;
        const dueEntry = this.entries.get(`${adminId}:${accountId}`);
        if (!(await this.tryAcquireLease(leaseKey, token, probeLeaseTtlMs(dueEntry?.probeTimeoutMs[role])))) continue;
        try { await service.probeProvider(role); } finally { await this.releaseLease(leaseKey, token); }
        await this.persistEntrySnapshot(adminId, accountId);
      }
    } catch (error) {
      void this.options.onRedisDegraded?.({ error });
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopScheduler();
    if (this.redis) {
      if (['ready', 'connecting', 'reconnecting'].includes(this.redis.status)) {
        try { await this.redis.quit(); } catch { this.redis.disconnect(); }
      } else this.redis.disconnect();
    }
  }

  private async persistEntrySnapshot(adminId: string, accountId: string): Promise<void> {
    const chainKey = `${adminId}:${accountId}`;
    const previous = this.persistChains.get(chainKey) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.writeEntrySnapshot(adminId, accountId));
    this.persistChains.set(chainKey, next);
    try { await next; } finally { if (this.persistChains.get(chainKey) === next) this.persistChains.delete(chainKey); }
  }

  private async writeEntrySnapshot(adminId: string, accountId: string): Promise<void> {
    const snapshot = this.getSnapshot(adminId, accountId);
    if (!snapshot) return;
    await this.options.onStateChange?.({ adminId, accountId, snapshot });
    if (!this.redis || this.closed) return;
    try {
      await this.ensureRedis();
      const key = this.stateKey(accountId, snapshot.configGeneration);
      const payload = JSON.stringify({ ...snapshot, updatedAt: new Date().toISOString() });
      const stateWriteResult = await this.redis.eval(
        "local incoming = cjson.decode(ARGV[1]); local current = redis.call('get', KEYS[1]); if current then local ok, parsed = pcall(cjson.decode, current); if ok then if tonumber(parsed.configGeneration or -1) ~= tonumber(ARGV[3]) then return 0 end; if tonumber(parsed.stateRevision or 0) > tonumber(ARGV[2]) then return 0 end; local currentStates = parsed.providerStates or {}; local incomingStates = incoming.providerStates or {}; for _, role in ipairs({'primary','backup'}) do local currentState = currentStates[role]; local incomingState = incomingStates[role]; if currentState and incomingState and currentState.state == 'OPEN' and incomingState.state == 'CLOSED' and incomingState.lastTransitionReason ~= 'safe_probe_succeeded' then return 0 end end end end; redis.call('set', KEYS[1], ARGV[1]); return 1",
        1,
        key,
        payload,
        String(snapshot.stateRevision),
        String(snapshot.configGeneration),
      );
      if (Number(stateWriteResult) !== 1) return;
      for (const role of ['primary', 'backup'] as const) {
        const due = snapshot.providerStates[role]?.nextProbeAt;
        const member = `${adminId}:${accountId}:${snapshot.configGeneration}:${role}`;
        if (due) await this.redis.zadd(DUE_KEY, String(Date.parse(due)), member);
        else await this.redis.zrem(DUE_KEY, member);
      }
    } catch (error) {
      void this.options.onRedisDegraded?.({ adminId, accountId, error });
    }
  }

  private async loadPersistedSnapshot(accountId: string, generation: number): Promise<PersistedSnapshot | undefined> {
    if (!this.redis || this.closed) return undefined;
    try {
      await this.ensureRedis();
      const raw = await this.redis.get(this.stateKey(accountId, generation));
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as PersistedSnapshot;
      return parsed?.configGeneration === generation ? parsed : undefined;
    } catch (error) {
      void this.options.onRedisDegraded?.({ accountId, error });
      return undefined;
    }
  }

  private stateKey(accountId: string, generation: number): string { return `${STATE_PREFIX}:${accountId}:${generation}`; }

  private async ensureRedis(): Promise<void> {
    if (!this.redis || this.closed) return;
    if (this.redis.status === 'ready' || this.redis.status === 'connecting' || this.redis.status === 'reconnecting') return;
    await this.redis.connect();
  }

  private async tryAcquireLease(key: string, token: string, ttlMs: number): Promise<boolean> {
    if (!this.redis || this.closed) return true;
    try {
      await this.ensureRedis();
      return (await this.redis.set(key, token, 'PX', ttlMs, 'NX')) === 'OK';
    } catch (error) {
      void this.options.onRedisDegraded?.({ error });
      return true;
    }
  }

  private async releaseLease(key: string, token: string): Promise<void> {
    if (!this.redis || this.closed) return;
    try {
      await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token);
    } catch (error) {
      void this.options.onRedisDegraded?.({ error });
    }
  }
}

function constructionErrorCode(error: unknown): string {
  if (error instanceof PiModelClientError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_:-]{1,64}$/.test(error.name)) return error.name;
  return 'MODEL_PROVIDER_RUNTIME_INIT_FAILED';
}

export function providerStateLabel(state: ModelProviderCircuitSnapshot['state']): string { return state; }

function normalizedProbeTimeoutMs(config: OpenAIResolvedConfig): number {
  const fallback = Math.min(Math.max(1_000, Math.trunc(config.timeoutMs || 60_000)), 10_000);
  const value = Number(config.probeTimeoutMs ?? fallback);
  return Number.isFinite(value) ? Math.min(60_000, Math.max(500, Math.trunc(value))) : fallback;
}

function probeLeaseTtlMs(probeTimeoutMs: number | undefined): number {
  const timeout = Number.isFinite(probeTimeoutMs) ? Math.max(500, Math.trunc(probeTimeoutMs!)) : 10_000;
  // Cover the configured probe timeout, bounded jitter, and a release grace
  // period so a crashed process does not block recovery for a full business
  // request timeout.
  return Math.min(120_000, timeout + 1_000 + 5_000);
}
