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
  toolTimeoutMs: 10_000,
  totalTimeoutMs: 60_000,
  maxHistory: 20,
  maxReplyLength: 1_000,
  replySegmentDelayMs: 800,
  debounceMs: 2_000,
  sendMode: 'simulate',
};

export function autoReplyAgentConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AutoReplyAgentConfig {
  return {
    enabled: parseBoolean(env.AUTO_REPLY_AGENT_ENABLED, DEFAULT_AUTO_REPLY_AGENT_CONFIG.enabled),
    systemPrompt: env.AUTO_REPLY_AGENT_SYSTEM_PROMPT?.trim() || DEFAULT_AUTO_REPLY_AGENT_CONFIG.systemPrompt,
    userPromptTemplate: env.AUTO_REPLY_AGENT_USER_PROMPT?.trim() || DEFAULT_AUTO_REPLY_AGENT_CONFIG.userPromptTemplate,
    maxLoops: parseBoundedInteger(env.AUTO_REPLY_AGENT_MAX_LOOPS, DEFAULT_AUTO_REPLY_AGENT_CONFIG.maxLoops, 1, 12),
    maxToolCalls: parseBoundedInteger(env.AUTO_REPLY_AGENT_MAX_TOOL_CALLS, DEFAULT_AUTO_REPLY_AGENT_CONFIG.maxToolCalls, 1, 32),
    toolTimeoutMs: parseBoundedInteger(env.AUTO_REPLY_AGENT_TOOL_TIMEOUT_MS, DEFAULT_AUTO_REPLY_AGENT_CONFIG.toolTimeoutMs, 100, 120_000),
    totalTimeoutMs: parseBoundedInteger(env.AUTO_REPLY_AGENT_TOTAL_TIMEOUT_MS, DEFAULT_AUTO_REPLY_AGENT_CONFIG.totalTimeoutMs, 1_000, 300_000),
    maxHistory: parseBoundedInteger(env.AUTO_REPLY_AGENT_MAX_HISTORY, DEFAULT_AUTO_REPLY_AGENT_CONFIG.maxHistory, 0, 100),
    maxReplyLength: parseBoundedInteger(env.AUTO_REPLY_AGENT_MAX_REPLY_LENGTH, DEFAULT_AUTO_REPLY_AGENT_CONFIG.maxReplyLength, 30, 4_000),
    replySegmentDelayMs: parseBoundedInteger(env.AUTO_REPLY_AGENT_REPLY_SEGMENT_DELAY_MS, DEFAULT_AUTO_REPLY_AGENT_CONFIG.replySegmentDelayMs, 0, 30_000),
    debounceMs: parseBoundedInteger(env.AUTO_REPLY_AGENT_DEBOUNCE_MS, DEFAULT_AUTO_REPLY_AGENT_CONFIG.debounceMs, 0, 30_000),
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
    const config = validateConfig({ ...current, ...input.patch });
    const saved = await this.store.upsertAutoReplyAgentConfig({ adminId: input.adminId, accountId: input.accountId, expectedVersion: input.expectedVersion, patch: input.patch, config, configDigest: digestJson(config) });
    if (!saved) throw new ServiceError(500, 'SETTINGS_SAVE_FAILED', 'auto reply agent settings could not be saved');
    await this.audit({ actorId: input.adminId, action: 'auto_reply_agent.settings.updated', targetRef: `${input.accountId}:v${saved.configVersion}`, requestId: input.requestId, traceId: input.traceId, payload: { configVersion: saved.configVersion, configDigest: saved.configDigest, changedFields: Object.keys(input.patch).sort() } });
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
    toolTimeoutMs: boundedNumber(config.toolTimeoutMs, 'toolTimeoutMs', 100, 120_000),
    totalTimeoutMs: boundedNumber(config.totalTimeoutMs, 'totalTimeoutMs', 1_000, 300_000),
    maxHistory: boundedNumber(config.maxHistory, 'maxHistory', 0, 100),
    maxReplyLength: boundedNumber(config.maxReplyLength, 'maxReplyLength', 30, 4_000),
    replySegmentDelayMs: boundedNumber(config.replySegmentDelayMs, 'replySegmentDelayMs', 0, 30_000),
    debounceMs: boundedNumber(config.debounceMs, 'debounceMs', 0, 30_000),
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

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseBoundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function resolveAutoReplyAgentDefaults(config: AppConfig): AutoReplyAgentConfig {
  return validateConfig({ ...autoReplyAgentConfigFromEnv(), ...(config.autoReplyAgent ?? {}) });
}
