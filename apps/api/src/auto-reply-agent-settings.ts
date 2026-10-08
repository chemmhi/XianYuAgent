import type { AppConfig } from './config.js';
import type { AutoReplyAgentConfig, AutoReplyAgentConfigPatch, AutoReplyAgentConfigRecord, Store } from './domain.js';
import { digestJson } from './security.js';
import { ServiceError } from './services.js';

export const DEFAULT_AUTO_REPLY_AGENT_CONFIG: AutoReplyAgentConfig = {
  enabled: true,
  systemPrompt: '你是闲鱼卖家面向买家的自动回复 Agent。只根据工具事实回答，不确定时转人工。',
  userPromptTemplate: '{{buyerMessage}}',
  maxLoops: 4,
  maxToolCalls: 8,
  toolTimeoutSeconds: 10,
  totalTimeoutSeconds: 600,
  maxHistory: 20,
  maxReplyLength: 1_000,
  replySegmentDelaySeconds: 0.8,
  debounceMs: 2_000,
  sendDelaySeconds: 300,
  sendMode: 'simulate',
};

export function autoReplyAgentConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AutoReplyAgentConfig {
  return {
    enabled: parseBoolean(env.AUTO_REPLY_AGENT_ENABLED, DEFAULT_AUTO_REPLY_AGENT_CONFIG.enabled),
    systemPrompt: env.AUTO_REPLY_AGENT_SYSTEM_PROMPT?.trim() || DEFAULT_AUTO_REPLY_AGENT_CONFIG.systemPrompt,
    userPromptTemplate: env.AUTO_REPLY_AGENT_USER_PROMPT?.trim() || DEFAULT_AUTO_REPLY_AGENT_CONFIG.userPromptTemplate,
    maxLoops: parseBoundedInteger(env.AUTO_REPLY_AGENT_MAX_LOOPS, DEFAULT_AUTO_REPLY_AGENT_CONFIG.maxLoops, 1, 12),
    maxToolCalls: parseBoundedInteger(env.AUTO_REPLY_AGENT_MAX_TOOL_CALLS, DEFAULT_AUTO_REPLY_AGENT_CONFIG.maxToolCalls, 1, 32),
    toolTimeoutSeconds: parseDurationSeconds(env.AUTO_REPLY_AGENT_TOOL_TIMEOUT_SECONDS, env.AUTO_REPLY_AGENT_TOOL_TIMEOUT_MS, DEFAULT_AUTO_REPLY_AGENT_CONFIG.toolTimeoutSeconds, 0.1, 120),
    totalTimeoutSeconds: parseDurationSeconds(env.AUTO_REPLY_AGENT_TOTAL_TIMEOUT_SECONDS, env.AUTO_REPLY_AGENT_TOTAL_TIMEOUT_MS, DEFAULT_AUTO_REPLY_AGENT_CONFIG.totalTimeoutSeconds, 1, 600),
    maxHistory: parseBoundedInteger(env.AUTO_REPLY_AGENT_MAX_HISTORY, DEFAULT_AUTO_REPLY_AGENT_CONFIG.maxHistory, 0, 100),
    maxReplyLength: parseBoundedInteger(env.AUTO_REPLY_AGENT_MAX_REPLY_LENGTH, DEFAULT_AUTO_REPLY_AGENT_CONFIG.maxReplyLength, 30, 4_000),
    replySegmentDelaySeconds: parseDurationSeconds(env.AUTO_REPLY_AGENT_REPLY_SEGMENT_DELAY_SECONDS, env.AUTO_REPLY_AGENT_REPLY_SEGMENT_DELAY_MS, DEFAULT_AUTO_REPLY_AGENT_CONFIG.replySegmentDelaySeconds, 0, 30),
    debounceMs: parseBoundedInteger(env.AUTO_REPLY_AGENT_DEBOUNCE_MS, DEFAULT_AUTO_REPLY_AGENT_CONFIG.debounceMs, 0, 30_000),
    sendDelaySeconds: parseBoundedInteger(env.AUTO_REPLY_AGENT_SEND_DELAY_SECONDS, DEFAULT_AUTO_REPLY_AGENT_CONFIG.sendDelaySeconds, 0, 86_400),
    sendMode: env.AUTO_REPLY_SEND_MODE?.trim().toLowerCase() === 'live' ? 'live' : DEFAULT_AUTO_REPLY_AGENT_CONFIG.sendMode,
  };
}

export class AutoReplyAgentSettingsService {
  constructor(
    private readonly store: Store,
    private readonly defaults: AutoReplyAgentConfig,
    private readonly audit: (input: { actorId: string; action: string; targetRef?: string; requestId: string; traceId: string; payload: unknown }) => Promise<string>,
  ) {}

  async get(adminId: string, accountId: string): Promise<AutoReplyAgentConfigRecord> {
    await this.ensureScope(adminId, accountId);
    const current = await this.store.getAutoReplyAgentConfig(adminId, accountId);
    if (current) return current;
    return this.toDefaultRecord(accountId);
  }

  async update(input: { adminId: string; accountId: string; expectedVersion: number; patch: AutoReplyAgentConfigPatch; requestId: string; traceId: string }): Promise<AutoReplyAgentConfigRecord> {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) throw new ServiceError(422, 'VALIDATION_FAILED', 'expectedVersion must be a non-negative integer');
    const current = await this.get(input.adminId, input.accountId);
    if (current.configVersion !== input.expectedVersion) throw new ServiceError(409, 'VERSION_CONFLICT', 'auto reply agent settings version conflict', { server: current });
    const normalizedPatch = normalizeAutoReplyAgentConfigPatch(input.patch);
    const { debounceMs: _legacyDebounceMs, ...effectivePatch } = normalizedPatch;
    void _legacyDebounceMs;
    const config = validateConfig({ ...current, ...effectivePatch });
    const saved = await this.store.upsertAutoReplyAgentConfig({ adminId: input.adminId, accountId: input.accountId, expectedVersion: input.expectedVersion, patch: effectivePatch, config, configDigest: digestJson(config) });
    if (!saved) throw new ServiceError(500, 'SETTINGS_SAVE_FAILED', 'auto reply agent settings could not be saved');
    await this.audit({ actorId: input.adminId, action: 'auto_reply_agent.settings.updated', targetRef: `${input.accountId}:v${saved.configVersion}`, requestId: input.requestId, traceId: input.traceId, payload: { configVersion: saved.configVersion, configDigest: saved.configDigest, changedFields: Object.keys(effectivePatch).sort() } });
    return saved;
  }

  private async ensureScope(adminId: string, accountId: string): Promise<void> {
    if (!accountId.trim()) throw new ServiceError(422, 'VALIDATION_FAILED', 'accountId is required');
    if (!(await this.store.hasAccountScope(adminId, accountId))) throw new ServiceError(403, 'FORBIDDEN', 'account scope required');
  }

  private toDefaultRecord(accountId: string): AutoReplyAgentConfigRecord {
    return { ...this.defaults, accountId, configVersion: 0, configDigest: digestJson(this.defaults), createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
  }
}

function validateConfig(config: AutoReplyAgentConfig): AutoReplyAgentConfig {
  return {
    enabled: Boolean(config.enabled),
    systemPrompt: boundedText(config.systemPrompt, 'systemPrompt', 20_000),
    userPromptTemplate: boundedText(config.userPromptTemplate, 'userPromptTemplate', 20_000),
    maxLoops: boundedNumber(config.maxLoops, 'maxLoops', 1, 12),
    maxToolCalls: boundedNumber(config.maxToolCalls, 'maxToolCalls', 1, 32),
    toolTimeoutSeconds: boundedDuration(config.toolTimeoutSeconds, 'toolTimeoutSeconds', 0.1, 120),
    totalTimeoutSeconds: boundedDuration(config.totalTimeoutSeconds, 'totalTimeoutSeconds', 1, 600),
    maxHistory: boundedNumber(config.maxHistory, 'maxHistory', 0, 100),
    maxReplyLength: boundedNumber(config.maxReplyLength, 'maxReplyLength', 30, 4_000),
    replySegmentDelaySeconds: boundedDuration(config.replySegmentDelaySeconds, 'replySegmentDelaySeconds', 0, 30),
    debounceMs: boundedNumber(config.debounceMs, 'debounceMs', 0, 30_000),
    sendDelaySeconds: boundedNumber(config.sendDelaySeconds, 'sendDelaySeconds', 0, 86_400),
    sendMode: config.sendMode === 'live' ? 'live' : 'simulate',
  };
}

function boundedText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ServiceError(422, 'VALIDATION_FAILED', `${field} must be a non-empty string`);
  const result = value.trim();
  if (result.length > maxLength) throw new ServiceError(422, 'VALIDATION_FAILED', `${field} is too long`);
  return result;
}

function boundedNumber(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new ServiceError(422, 'VALIDATION_FAILED', `${field} must be an integer between ${min} and ${max}`);
  return Number(value);
}

function boundedDuration(value: unknown, field: string, min: number, max: number): number {
  const numeric = Number(value);
  const rounded = Number(numeric.toFixed(3));
  if (!Number.isFinite(numeric) || rounded !== numeric || numeric < min || numeric > max) {
    throw new ServiceError(422, 'VALIDATION_FAILED', `${field} must be a number with at most 3 decimal places between ${min} and ${max}`);
  }
  return rounded;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseBoundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function parseDurationSeconds(secondsValue: string | undefined, legacyMillisecondsValue: string | undefined, fallback: number, min: number, max: number): number {
  const raw = secondsValue ?? (legacyMillisecondsValue === undefined ? undefined : String(Number(legacyMillisecondsValue) / 1_000));
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return Number(parsed.toFixed(3));
}

export function millisecondsToSeconds(value: number): number {
  return Number((value / 1_000).toFixed(3));
}

export function secondsToMilliseconds(value: number): number {
  return Math.max(0, Math.round(value * 1_000));
}

function normalizeAutoReplyAgentConfigPatch(patch: AutoReplyAgentConfigPatch): AutoReplyAgentConfigPatch {
  const source = patch as AutoReplyAgentConfigPatch & Record<string, unknown>;
  const normalized: AutoReplyAgentConfigPatch = { ...patch };
  if (normalized.toolTimeoutSeconds === undefined && typeof source.toolTimeoutMs === 'number') normalized.toolTimeoutSeconds = millisecondsToSeconds(source.toolTimeoutMs);
  if (normalized.totalTimeoutSeconds === undefined && typeof source.totalTimeoutMs === 'number') normalized.totalTimeoutSeconds = millisecondsToSeconds(source.totalTimeoutMs);
  if (normalized.replySegmentDelaySeconds === undefined && typeof source.replySegmentDelayMs === 'number') normalized.replySegmentDelaySeconds = millisecondsToSeconds(source.replySegmentDelayMs);
  delete normalized.toolTimeoutMs;
  delete normalized.totalTimeoutMs;
  delete normalized.replySegmentDelayMs;
  return normalized;
}

export function resolveAutoReplyAgentDefaults(config: AppConfig): AutoReplyAgentConfig {
  const runtime = config.autoReplyAgent;
  const overrides = runtime ? {
    systemPrompt: runtime.systemPrompt,
    userPromptTemplate: runtime.userPromptTemplate,
    maxLoops: runtime.maxLoops,
    maxToolCalls: runtime.maxToolCalls,
    toolTimeoutSeconds: millisecondsToSeconds(runtime.toolTimeoutMs),
    totalTimeoutSeconds: millisecondsToSeconds(runtime.totalTimeoutMs),
    maxHistory: runtime.maxHistory,
    maxReplyLength: runtime.maxReplyLength,
    replySegmentDelaySeconds: millisecondsToSeconds(runtime.replySegmentDelayMs),
    debounceMs: runtime.debounceMs,
    sendDelaySeconds: runtime.sendDelaySeconds,
  } : {};
  return validateConfig({ ...autoReplyAgentConfigFromEnv(), ...overrides });
}
