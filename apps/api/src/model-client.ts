import { PiModelClientError, type ModelClient, type ModelCompletionRequest, type ModelCompletionResult, type ModelProbeResult, type ModelStreamHandlers } from './pi-runtime.js';

export type { ModelClient, ModelCompletionRequest, ModelCompletionResult, ModelMessage, ModelToolCall, ModelToolDefinition, ModelStreamHandlers, ModelToolCallDelta, ModelProbeResult } from './pi-runtime.js';

export type ModelProviderRole = 'primary' | 'backup';
export type ModelProviderCircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export type ModelProviderRoutingMode = 'auto' | 'manual_primary' | 'manual_backup';

export interface ModelClientFailoverEvent { provider: ModelProviderRole; error: unknown; reason?: string; cooldownUntil?: string; }
export interface ModelProviderCircuitSnapshot { role: ModelProviderRole; state: ModelProviderCircuitState; failureCount: number; cooldownUntil?: string; nextProbeAt?: string; generation: number; lastTransitionReason?: string; manualOnly?: boolean; backoffMs?: number; lastErrorStatus?: number; lastProbeLatencyMs?: number; }
export interface ModelClientRuntimeSnapshot { mode: ModelProviderRoutingMode; preferredRole?: ModelProviderRole; effectiveRole?: ModelProviderRole; lastSuccessfulRole?: ModelProviderRole; lastServedAt?: string; observedAt: string; configGeneration: number; routingVersion: number; stateRevision: number; providerStates: Record<ModelProviderRole, ModelProviderCircuitSnapshot>; }

export interface ModelClientServiceOptions {
  primary?: ModelClient;
  backup?: ModelClient;
  onFailover?: (event: ModelClientFailoverEvent) => void | Promise<void>;
  onStateChange?: (snapshot: ModelProviderCircuitSnapshot) => void | Promise<void>;
  onFastFail?: (input: { reason: string; snapshot: ModelClientRuntimeSnapshot }) => void | Promise<void>;
  overallTimeoutMs?: number;
  configGeneration?: number;
  routingVersion?: number;
  mode?: ModelProviderRoutingMode;
  preferredRole?: ModelProviderRole;
  now?: () => number;
}

const DEFAULT_OVERALL_TIMEOUT_MS = 60_000;
const INITIAL_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 10 * 60_000;

/** Stateful router; reuse it from a ModelClientPool so circuit state survives requests. */
export class ModelClientService implements ModelClient {
  readonly supportsWebSearch: boolean;
  private readonly primary?: ModelClient;
  private readonly backup?: ModelClient;
  private readonly onFailover?: ModelClientServiceOptions['onFailover'];
  private readonly onStateChange?: ModelClientServiceOptions['onStateChange'];
  private readonly onFastFail?: ModelClientServiceOptions['onFastFail'];
  private readonly overallTimeoutMs: number;
  private readonly now: () => number;
  private mode: ModelProviderRoutingMode;
  private preferredRole?: ModelProviderRole;
  private routingVersion: number;
  private readonly configGeneration: number;
  private stateRevision = 0;
  private lastSuccessfulRole?: ModelProviderRole;
  private lastServedAt?: string;
  private readonly circuits: Record<ModelProviderRole, CircuitState>;

  constructor(options: ModelClientServiceOptions) {
    this.primary = options.primary;
    this.backup = options.backup;
    this.onFailover = options.onFailover;
    this.onStateChange = options.onStateChange;
    this.onFastFail = options.onFastFail;
    this.overallTimeoutMs = Math.max(1_000, Math.trunc(options.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS));
    this.now = options.now ?? Date.now;
    this.mode = options.mode ?? 'auto';
    this.preferredRole = options.preferredRole;
    this.routingVersion = options.routingVersion ?? 0;
    this.configGeneration = options.configGeneration ?? 0;
    this.circuits = { primary: createCircuit('primary', this.configGeneration), backup: createCircuit('backup', this.configGeneration) };
    this.supportsWebSearch = (this.primary?.supportsWebSearch !== false) && (this.backup?.supportsWebSearch !== false);
  }

  setRouting(input: { mode: ModelProviderRoutingMode; preferredRole?: ModelProviderRole; routingVersion: number }): void {
    this.mode = input.mode;
    this.preferredRole = input.mode === 'auto' ? undefined : input.preferredRole;
    this.routingVersion = input.routingVersion;
  }

  hydrateCircuitSnapshots(input: { generation: number; stateRevision?: number; providerStates: Partial<Record<ModelProviderRole, ModelProviderCircuitSnapshot>>; lastSuccessfulRole?: ModelProviderRole; lastServedAt?: string }): void {
    if (input.generation !== this.configGeneration) return;
    const incomingRevision = Number(input.stateRevision ?? 0);
    if (incomingRevision <= this.stateRevision) return;
    for (const role of ['primary', 'backup'] as const) {
      const source = input.providerStates[role];
      const target = this.circuits[role];
      if (!source || source.generation !== this.configGeneration) continue;
      // A stale CLOSED snapshot must never erase a locally observed OPEN
      // circuit.  The only valid cross-process close for an OPEN circuit is
      // an explicit safe-probe success; ordinary request successes belong to
      // the pre-breaker state and can arrive late from another process.
      if (target.state === 'OPEN' && source.state === 'CLOSED' && source.lastTransitionReason !== 'safe_probe_succeeded') continue;
      target.state = source.state;
      target.failureCount = Math.max(0, Math.trunc(source.failureCount));
      target.cooldownUntil = source.cooldownUntil ? Date.parse(source.cooldownUntil) : undefined;
      target.nextProbeAt = source.nextProbeAt ? Date.parse(source.nextProbeAt) : undefined;
      target.lastTransitionReason = source.lastTransitionReason;
      target.manualOnly = source.manualOnly === true;
      target.backoffMs = Number.isFinite(source.backoffMs) ? Math.max(INITIAL_COOLDOWN_MS, Math.trunc(source.backoffMs!)) : target.backoffMs;
      target.lastErrorStatus = source.lastErrorStatus;
      target.lastProbeLatencyMs = source.lastProbeLatencyMs;
    }
    this.lastSuccessfulRole = input.lastSuccessfulRole;
    this.lastServedAt = input.lastServedAt;
    this.stateRevision = incomingRevision;
  }

  getRuntimeSnapshot(): ModelClientRuntimeSnapshot {
    const effectiveRole = this.chooseRole();
    return { mode: this.mode, preferredRole: this.preferredRole, effectiveRole, lastSuccessfulRole: this.lastSuccessfulRole, lastServedAt: this.lastServedAt, observedAt: new Date(this.now()).toISOString(), configGeneration: this.configGeneration, routingVersion: this.routingVersion, stateRevision: this.stateRevision, providerStates: { primary: snapshotOf(this.circuits.primary), backup: snapshotOf(this.circuits.backup) } };
  }

  async complete(input: ModelCompletionRequest): Promise<ModelCompletionResult> {
    const deadline = Number.isFinite(input.deadlineAt) ? input.deadlineAt! : this.now() + this.overallTimeoutMs;
    const firstRole = this.chooseRole();
    if (!firstRole) { await this.emitFastFail('no_available_provider'); throw unavailableError(); }
    const first = this.clientFor(firstRole);
    if (!first) throw unavailableError();
    try {
      const result = await this.invokeComplete(first, input, deadline);
      this.markSuccess(firstRole);
      return result;
    } catch (error) {
      if (!isHardProviderFailure(error)) throw error;
      await this.openCircuit(firstRole, error);
      const fallbackRole = this.otherRole(firstRole);
      const fallback = fallbackRole ? this.clientFor(fallbackRole) : undefined;
      if (!fallback || !this.isClosed(fallbackRole!)) { await this.emitFastFail('fallback_unavailable'); throw error; }
      await this.emitFailover({ provider: firstRole, error, reason: 'provider_failure', cooldownUntil: this.circuits[firstRole].cooldownUntil ? new Date(this.circuits[firstRole].cooldownUntil!).toISOString() : undefined });
      try {
        const result = await this.invokeComplete(fallback, input, deadline);
        this.markSuccess(fallbackRole!);
        return result;
      } catch (backupError) {
        if (isHardProviderFailure(backupError)) await this.openCircuit(fallbackRole!, backupError);
        throw backupError;
      }
    }
  }

  async stream(input: ModelCompletionRequest, handlers: ModelStreamHandlers = {}): Promise<ModelCompletionResult> {
    const deadline = Number.isFinite(input.deadlineAt) ? input.deadlineAt! : this.now() + this.overallTimeoutMs;
    const firstRole = this.chooseRole();
    if (!firstRole) { await this.emitFastFail('no_available_provider'); throw unavailableError(); }
    const first = this.clientFor(firstRole);
    if (!first) throw unavailableError();
    let emitted = false;
    const guardedHandlers: ModelStreamHandlers = {
      onTextDelta: async (delta) => { if (delta) emitted = true; await handlers.onTextDelta?.(delta); },
      onReasoningDelta: async (delta) => { if (delta) emitted = true; await handlers.onReasoningDelta?.(delta); },
      onToolCallDelta: async (delta) => { emitted = true; await handlers.onToolCallDelta?.(delta); },
      onToolCall: async (call) => { emitted = true; await handlers.onToolCall?.(call); },
      onDone: handlers.onDone,
    };
    try {
      const result = await this.invokeStream(first, input, guardedHandlers, deadline);
      this.markSuccess(firstRole);
      return result;
    } catch (error) {
      if (isHardProviderFailure(error)) await this.openCircuit(firstRole, error);
      if ((emitted && input.buffered !== true) || !isHardProviderFailure(error)) throw error;
      const fallbackRole = this.otherRole(firstRole);
      const fallback = fallbackRole ? this.clientFor(fallbackRole) : undefined;
      if (!fallback || !this.isClosed(fallbackRole!)) { await this.emitFastFail('fallback_unavailable'); throw error; }
      await this.emitFailover({ provider: firstRole, error, reason: 'stream_before_output' });
      try {
        const result = await this.invokeStream(fallback, input, handlers, deadline);
        this.markSuccess(fallbackRole!);
        return result;
      } catch (backupError) {
        if (isHardProviderFailure(backupError)) await this.openCircuit(fallbackRole!, backupError);
        throw backupError;
      }
    }
  }

  async safeProbe(): Promise<ModelProbeResult> {
    const role = this.chooseRole() ?? this.availableRoles()[0];
    if (!role) return { ok: false, code: 'PROBE_UNSUPPORTED', latencyMs: 0 };
    return this.probeProvider(role);
  }

  async probeProvider(role: ModelProviderRole): Promise<ModelProbeResult> {
    const client = this.clientFor(role);
    if (!client?.safeProbe) return { ok: false, code: 'PROBE_UNSUPPORTED', latencyMs: 0 };
    const circuit = this.circuits[role];
    if (circuit.probeInFlight) return { ok: false, code: 'PROBE_FAILED', latencyMs: 0 };
    circuit.probeInFlight = true;
    circuit.state = 'HALF_OPEN';
    circuit.lastTransitionReason = 'safe_probe_started';
    this.stateRevision += 1;
    await this.emitState(circuit);
    try {
      let result: ModelProbeResult;
      try {
        result = await client.safeProbe();
      } catch {
        result = { ok: false, code: 'PROBE_FAILED', latencyMs: 0 };
      }
      circuit.lastProbeLatencyMs = result.latencyMs;
      if (result.ok) {
        circuit.state = 'CLOSED';
        circuit.failureCount = 0;
        circuit.cooldownUntil = undefined;
        circuit.nextProbeAt = undefined;
        circuit.backoffMs = INITIAL_COOLDOWN_MS;
        circuit.lastErrorStatus = undefined;
        circuit.lastTransitionReason = 'safe_probe_succeeded';
      } else {
        circuit.state = 'OPEN';
        circuit.lastTransitionReason = result.code ?? 'safe_probe_failed';
        if (result.code === 'PROBE_AUTH_FAILED') {
          circuit.manualOnly = true;
          circuit.cooldownUntil = undefined;
          circuit.nextProbeAt = undefined;
        } else {
          circuit.manualOnly = false;
          this.scheduleCooldown(circuit, result.code === 'PROBE_UNSUPPORTED' ? 5 * 60_000 : undefined);
        }
      }
      this.stateRevision += 1;
      await this.emitState(circuit);
      return result;
    } finally { circuit.probeInFlight = false; }
  }

  async probeDue(): Promise<void> {
    for (const role of this.availableRoles()) {
      const circuit = this.circuits[role];
      if (circuit.state === 'OPEN' && circuit.nextProbeAt !== undefined && this.now() >= circuit.nextProbeAt) await this.probeProvider(role);
    }
  }

  private async invokeComplete(client: ModelClient, input: ModelCompletionRequest, deadline: number): Promise<ModelCompletionResult> {
    const scoped = scopedRequest(input, deadline, this.now);
    try { return await client.complete(scoped.request); } finally { scoped.dispose(); }
  }

  private async invokeStream(client: ModelClient, input: ModelCompletionRequest, handlers: ModelStreamHandlers, deadline: number): Promise<ModelCompletionResult> {
    const scoped = scopedRequest(input, deadline, this.now);
    try {
      if (client.stream) return await client.stream(scoped.request, handlers);
      const result = await client.complete(scoped.request);
      if (result.content) await handlers.onTextDelta?.(result.content);
      for (const call of result.toolCalls ?? []) await handlers.onToolCall?.(call);
      await handlers.onDone?.(result);
      return result;
    } finally { scoped.dispose(); }
  }

  private chooseRole(): ModelProviderRole | undefined {
    const ordered: ModelProviderRole[] = this.mode === 'manual_backup' ? ['backup', 'primary'] : ['primary', 'backup'];
    for (const role of ordered) if (this.clientFor(role) && this.isClosed(role)) return role;
    return undefined;
  }
  private availableRoles(): ModelProviderRole[] { const roles: ModelProviderRole[] = ['primary', 'backup']; return roles.filter((role) => Boolean(this.clientFor(role))); }
  private otherRole(role: ModelProviderRole): ModelProviderRole | undefined { const other: ModelProviderRole = role === 'primary' ? 'backup' : 'primary'; return this.clientFor(other) ? other : undefined; }
  private clientFor(role: ModelProviderRole): ModelClient | undefined { return role === 'primary' ? this.primary : this.backup; }
  private isClosed(role: ModelProviderRole): boolean { return this.circuits[role].state === 'CLOSED'; }

  private markSuccess(role: ModelProviderRole): void {
    const circuit = this.circuits[role];
    circuit.state = 'CLOSED';
    circuit.failureCount = 0;
    circuit.cooldownUntil = undefined;
    circuit.nextProbeAt = undefined;
    circuit.backoffMs = INITIAL_COOLDOWN_MS;
    circuit.manualOnly = false;
    circuit.lastErrorStatus = undefined;
    circuit.lastProbeLatencyMs = undefined;
    circuit.lastTransitionReason = 'request_succeeded';
    this.stateRevision += 1;
    this.lastSuccessfulRole = role;
    this.lastServedAt = new Date(this.now()).toISOString();
    void this.emitState(circuit);
  }

  private async openCircuit(role: ModelProviderRole, error: unknown): Promise<void> {
    const circuit = this.circuits[role];
    circuit.state = 'OPEN';
    circuit.failureCount += 1;
    const retryAfter = error instanceof PiModelClientError ? error.retryAfterMs : undefined;
    const status = error instanceof PiModelClientError ? error.status : undefined;
    if (status === 401 || status === 403) {
      circuit.manualOnly = true;
      circuit.cooldownUntil = undefined;
      circuit.nextProbeAt = undefined;
    } else {
      circuit.manualOnly = false;
      this.scheduleCooldown(circuit, retryAfter ?? circuit.backoffMs);
    }
    circuit.lastTransitionReason = errorCode(error);
    circuit.lastErrorStatus = status;
    this.stateRevision += 1;
    await this.emitState(circuit);
  }

  private scheduleCooldown(circuit: CircuitState, overrideMs?: number): void {
    const baseCooldown = Math.min(60 * 60_000, Math.max(1_000, overrideMs ?? circuit.backoffMs));
    const cooldown = Math.min(60 * 60_000, Math.max(1_000, Math.round(baseCooldown * (1 + Math.random() * 0.1))));
    circuit.cooldownUntil = this.now() + cooldown;
    circuit.nextProbeAt = circuit.cooldownUntil;
    circuit.backoffMs = Math.min(MAX_COOLDOWN_MS, Math.max(INITIAL_COOLDOWN_MS, circuit.backoffMs * 2));
  }

  private async emitFailover(event: ModelClientFailoverEvent): Promise<void> { try { await this.onFailover?.(event); } catch { /* observability must not block backup */ } }
  private async emitState(circuit: CircuitState): Promise<void> { try { await this.onStateChange?.(snapshotOf(circuit)); } catch { /* observability must not block routing */ } }
  private async emitFastFail(reason: string): Promise<void> { try { await this.onFastFail?.({ reason, snapshot: this.getRuntimeSnapshot() }); } catch { /* observability must not block routing */ } }
}

interface CircuitState { role: ModelProviderRole; state: ModelProviderCircuitState; failureCount: number; cooldownUntil?: number; nextProbeAt?: number; generation: number; backoffMs: number; lastTransitionReason?: string; probeInFlight: boolean; manualOnly?: boolean; lastErrorStatus?: number; lastProbeLatencyMs?: number; }
function createCircuit(role: ModelProviderRole, generation: number): CircuitState { return { role, state: 'CLOSED', failureCount: 0, generation, backoffMs: INITIAL_COOLDOWN_MS, probeInFlight: false, manualOnly: false }; }
function snapshotOf(circuit: CircuitState): ModelProviderCircuitSnapshot { return { role: circuit.role, state: circuit.state, failureCount: circuit.failureCount, cooldownUntil: circuit.cooldownUntil === undefined ? undefined : new Date(circuit.cooldownUntil).toISOString(), nextProbeAt: circuit.nextProbeAt === undefined ? undefined : new Date(circuit.nextProbeAt).toISOString(), generation: circuit.generation, lastTransitionReason: circuit.lastTransitionReason, manualOnly: circuit.manualOnly, backoffMs: circuit.backoffMs, lastErrorStatus: circuit.lastErrorStatus, lastProbeLatencyMs: circuit.lastProbeLatencyMs }; }
function isHardProviderFailure(error: unknown): boolean {
  if (!(error instanceof PiModelClientError)) return true;
  if (error.origin === 'agent_deadline') return false;
  if (error.code === 'MODEL_ABORTED' || error.code === 'MODEL_TOOL_LOOP_EXCEEDED' || error.code === 'MODEL_UNSUPPORTED_TOOL') return false;
  if (error.code === 'MODEL_HTTP_ERROR' && error.status !== undefined && error.status >= 400 && error.status < 500 && ![401, 403, 408, 429].includes(error.status)) return false;
  return ['MODEL_TIMEOUT', 'MODEL_NETWORK_ERROR', 'MODEL_INVALID_RESPONSE', 'MODEL_HTTP_ERROR'].includes(error.code);
}
function errorCode(error: unknown): string { return error instanceof PiModelClientError ? `${error.code}${error.status ? `:${error.status}` : ''}` : error instanceof Error ? error.name : 'UNKNOWN_ERROR'; }
function unavailableError(): PiModelClientError { return new PiModelClientError('MODEL_PROVIDER_UNAVAILABLE', 'model providers are temporarily unavailable'); }
function scopedRequest(input: ModelCompletionRequest, deadline: number, now: () => number): { request: ModelCompletionRequest; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('agent_deadline'), Math.max(1, deadline - now()));
  const onAbort = () => controller.abort(input.signal?.reason ?? 'external_abort');
  if (input.signal?.aborted) controller.abort(input.signal.reason ?? 'external_abort'); else input.signal?.addEventListener('abort', onAbort, { once: true });
  return { request: { ...input, deadlineAt: deadline, signal: controller.signal }, dispose: () => { clearTimeout(timer); input.signal?.removeEventListener('abort', onAbort); } };
}

export function createModelClientService(primary?: ModelClient, backup?: ModelClient, onFailover?: ModelClientServiceOptions['onFailover']): ModelClientService { return new ModelClientService({ primary, backup, onFailover }); }
