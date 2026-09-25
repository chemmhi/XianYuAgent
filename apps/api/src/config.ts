import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveAutoReplyAgentConfig, type AutoReplyAgentRuntimeConfig } from './auto-reply-agent-config.js';
import { DEFAULT_PI_WIRE_API, type ModelWireApi } from './pi-runtime.js';
import { resolveProductAutomationLiveConfig, type ProductAutomationExecutionMode } from './product-automation-live-gate.js';
import { resolveAutoReplyRepairMode, type AutoReplyRepairMode } from './auto-reply-repair-config.js';
import type { XianyuVerificationBrowserMode } from './xianyu-verification-browser.js';
import type { XianyuSliderMode } from './xianyu-slider-solver.js';

export type AgentRuntimeMode = 'pi' | 'in-process';
export type AutoReplySendMode = 'simulate' | 'live';

export interface AppConfig {
  host: string;
  port: number;
  databaseUrl?: string;
  redisUrl?: string;
  cookieSecure: boolean;
  allowInMemory: boolean;
  sessionIdleMs: number;
  sessionAbsoluteMs: number;
  xianyuQrMode: 'real' | 'stub';
  xianyuVerificationBrowserMode: XianyuVerificationBrowserMode;
  xianyuVerificationSliderMode: XianyuSliderMode;
  xianyuVerificationSliderMaxRetries: number;
  xianyuVerificationBrowserHeadless: boolean;
  xianyuVerificationBrowserExecutablePath?: string;
  xianyuVerificationBrowserUserDataDir?: string;
  xianyuVerificationBrowserMaxWaitMs: number;
  webSocketAllowedOrigins: string[];
  agentRuntime: AgentRuntimeMode;
  modelApiKey?: string;
  modelBaseUrl?: string;
  modelName?: string;
  modelWireApi?: ModelWireApi;
  modelTimeoutMs: number;
  autoReplyModelEnabled?: boolean;
  /** Shared buyer allowlist used by Auto Reply and product automation. */
  autoReplyAgent?: AutoReplyAgentRuntimeConfig;
  credentialEncryptionKey: string;
  objectStorageEndpoint: string;
  objectStoragePublicEndpoint?: string;
  objectStorageAccessKey: string;
  objectStorageSecretKey: string;
  objectStorageBucket: string;
  objectStorageRegion: string;
  autoReplySendMode?: AutoReplySendMode;
  buyerAllowlist?: string[];
  /** Product automation external writes remain blocked until all live gates pass. */
  productAutomationExecutionMode: ProductAutomationExecutionMode;
  productAutomationLiveConfirmed: boolean;
  autoReplyRepairMode?: AutoReplyRepairMode;
  autoReplyPolicyJson?: string;
  /** Seed the built-in versioned repair policy when no account policy exists. */
  autoReplyPolicyBootstrapDefault?: boolean;
  autoReplyOutcomeReviewWorkerEnabled: boolean;
  autoReplyOutcomeReviewWorkerPollMs: number;
  autoReplyOutcomeReviewWorkerBatchSize: number;
  autoReplyOutcomeReviewWorkerLeaseSeconds: number;
}

export const DEFAULT_DATABASE_URL = 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

function asBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) loadLocalEnvFile();
  const modelApiKey = firstDefined(env.API_KEY, env.OPENAI_API_KEY, env.PI_API_KEY);
  const modelBaseUrl = firstDefined(env.BASE_URL, env.OPENAI_BASE_URL, env.PI_BASE_URL);
  const modelName = firstDefined(env.MODEL, env.OPENAI_MODEL, env.PI_MODEL);
  const modelWireApi = normalizeWireApi(firstDefined(env.WIRE_API, env.MODEL_WIRE_API));
  const autoReplySendMode: AutoReplySendMode = env.AUTO_REPLY_SEND_MODE?.trim().toLowerCase() === 'live' ? 'live' : 'simulate';
  const autoReplyRepairMode = resolveAutoReplyRepairMode(env.AUTO_REPLY_REPAIR_MODE);
  const autoReplyOutcomeReviewWorkerEnabled = asBoolean(env.AUTO_REPLY_OUTCOME_REVIEW_WORKER_ENABLED, true);
  const buyerAllowlist = parseBuyerNames(env.AUTOMATION_BUYER_ALLOWLIST);
  const autoReplyAgent = resolveAutoReplyAgentConfig(env);
  const productAutomationLive = resolveProductAutomationLiveConfig(env, buyerAllowlist);
  const configuredRuntime = env.AGENT_RUNTIME?.trim().toLowerCase();
  const agentRuntime: AgentRuntimeMode = configuredRuntime === 'in-process'
    ? 'in-process'
    : configuredRuntime === 'pi' || Boolean(modelApiKey && modelBaseUrl && modelName)
      ? 'pi'
      : 'in-process';
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8080),
    databaseUrl: env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    redisUrl: env.REDIS_URL ?? DEFAULT_REDIS_URL,
    cookieSecure: asBoolean(env.COOKIE_SECURE, false),
    allowInMemory: asBoolean(env.ALLOW_IN_MEMORY, false),
    sessionIdleMs: Number(env.SESSION_IDLE_MINUTES ?? 30) * 60_000,
    sessionAbsoluteMs: Number(env.SESSION_ABSOLUTE_HOURS ?? 8) * 3_600_000,
    xianyuQrMode: env.XIANYU_QR_MODE === 'stub' ? 'stub' : 'real',
    xianyuVerificationBrowserMode: normalizeVerificationBrowserMode(env.XIANYU_VERIFICATION_BROWSER_MODE),
    xianyuVerificationSliderMode: normalizeVerificationSliderMode(env.XIANYU_VERIFICATION_SLIDER_MODE),
    xianyuVerificationSliderMaxRetries: positiveInteger(env.XIANYU_VERIFICATION_SLIDER_MAX_RETRIES, 3),
    xianyuVerificationBrowserHeadless: asBoolean(env.XIANYU_VERIFICATION_BROWSER_HEADLESS, false),
    xianyuVerificationBrowserExecutablePath: env.XIANYU_VERIFICATION_BROWSER_EXECUTABLE?.trim() || undefined,
    xianyuVerificationBrowserUserDataDir: env.XIANYU_VERIFICATION_BROWSER_USER_DATA_DIR?.trim() || undefined,
    xianyuVerificationBrowserMaxWaitMs: positiveNumber(env.XIANYU_VERIFICATION_BROWSER_MAX_WAIT_MS, 3 * 60_000),
    webSocketAllowedOrigins: (env.WS_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080').split(',').map((value) => value.trim()).filter(Boolean),
    agentRuntime,
    modelApiKey,
    modelBaseUrl,
    modelName,
    modelWireApi,
    modelTimeoutMs: positiveNumber(env.MODEL_TIMEOUT_MS, 60_000),
    autoReplyModelEnabled: asBoolean(env.AUTO_REPLY_MODEL_ENABLED, Boolean(modelApiKey && modelBaseUrl && modelName)),
    credentialEncryptionKey: env.CREDENTIAL_ENCRYPTION_KEY?.trim() || 'development-only-credential-key-change-me',
    objectStorageEndpoint: env.OBJECT_STORAGE_ENDPOINT?.trim() || 'http://127.0.0.1:19000',
    objectStoragePublicEndpoint: env.OBJECT_STORAGE_PUBLIC_ENDPOINT?.trim() || undefined,
    objectStorageAccessKey: env.OBJECT_STORAGE_ACCESS_KEY?.trim() || 'xianyu',
    objectStorageSecretKey: env.OBJECT_STORAGE_SECRET_KEY?.trim() || 'xianyu_dev_only',
    objectStorageBucket: env.OBJECT_STORAGE_BUCKET?.trim() || 'xianyu-assets',
    objectStorageRegion: env.OBJECT_STORAGE_REGION?.trim() || 'us-east-1',
    autoReplySendMode,
    buyerAllowlist,
    autoReplyRepairMode,
    autoReplyPolicyJson: env.AUTO_REPLY_POLICY_JSON?.trim() || undefined,
    autoReplyPolicyBootstrapDefault: asBoolean(env.AUTO_REPLY_POLICY_BOOTSTRAP_DEFAULT, true),
    autoReplyOutcomeReviewWorkerEnabled,
    autoReplyOutcomeReviewWorkerPollMs: positiveNumber(env.AUTO_REPLY_OUTCOME_REVIEW_WORKER_POLL_MS, 1_000),
    autoReplyOutcomeReviewWorkerBatchSize: positiveNumber(env.AUTO_REPLY_OUTCOME_REVIEW_WORKER_BATCH_SIZE, 10),
    autoReplyOutcomeReviewWorkerLeaseSeconds: positiveNumber(env.AUTO_REPLY_OUTCOME_REVIEW_WORKER_LEASE_SECONDS, 60),
    autoReplyAgent,
    productAutomationExecutionMode: productAutomationLive.executionMode,
    productAutomationLiveConfirmed: productAutomationLive.liveConfirmed,
  };
}

function normalizeWireApi(value: string | undefined): ModelWireApi {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'chat') return 'chat';
  if (normalized === 'responses') return 'responses';
  return DEFAULT_PI_WIRE_API;
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveIntegerOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeVerificationBrowserMode(value: string | undefined): XianyuVerificationBrowserMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'launch') return normalized;
  return 'disabled';
}

function normalizeVerificationSliderMode(value: string | undefined): XianyuSliderMode {
  return value?.trim().toLowerCase() === 'auto' ? 'auto' : 'disabled';
}

function normalizeBuyerName(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

function parseBuyerNames(value: string | undefined): string[] {
  const raw = value?.trim();
  if (!raw) return [];
  const candidates: unknown[] = raw.startsWith('[')
    ? (() => {
      try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })()
    : raw.split(',');
  return [...new Set(candidates
    .filter((candidate): candidate is string => typeof candidate === 'string')
    .map(normalizeBuyerName)
    .filter((candidate): candidate is string => Boolean(candidate)))];
}

function loadLocalEnvFile(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '..', '.env')];
  const filename = candidates.find((candidate) => existsSync(candidate));
  if (!filename || typeof process.loadEnvFile !== 'function') return;
  try { process.loadEnvFile(filename); } catch { /* malformed local env must not crash config discovery */ }
}
