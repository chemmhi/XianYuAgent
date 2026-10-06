import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile, cp } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { ModelToolDefinition } from './pi-runtime.js';
import type { WorkspaceCommandInput, WorkspaceModelToolResult } from './workspace-commands.js';

const execFileAsync = promisify(execFile);
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_SKILL_TEXT = 16 * 1024;
const MAX_TOTAL_PROMPT = 48 * 1024;
const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
const REGISTRY_FILE = '.registry.json';
const AUTH_STATE_FILE = 'authorization.json';

export interface PiSkillInfo {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  sourceUrl?: string;
  installedAt: string;
  updatedAt: string;
  enabled: boolean;
  authorized: boolean;
  entry?: string;
  statePaths?: string[];
  path: string;
}

export interface PiSkillInstallInput {
  adminId: string;
  source: string;
  expectedSha256?: string;
}

export interface PiSkillExecutionInput {
  adminId: string;
  skillId: string;
  command: string;
  args?: string[];
  sessionInput?: string;
  sessionId?: string;
}

export interface PiSkillExecutionResult {
  skillId: string;
  command: string;
  code: number;
  stdout: string;
  stderr: string;
  parsed?: unknown;
  timedOut?: boolean;
  requiresLogin?: boolean;
}

export type PiSkillLoginStatus = 'succeeded' | 'already_authorized' | 'pending_user_action' | 'failed';

export interface PiSkillLoginInput {
  adminId: string;
  skillId: string;
  token?: string;
  args?: string[];
  sessionInput?: string;
  sessionId?: string;
}

export interface PiSkillLoginResult {
  skillId: string;
  status: PiSkillLoginStatus;
  code: number;
  stdout: string;
  stderr: string;
  prompt?: string;
  authUrl?: string;
  userActionRequired?: boolean;
  reusedAuthorization?: boolean;
}

export interface PiSkillInstructionResult {
  title: string;
  summary: string;
  content: string;
  data: Record<string, unknown>;
}

export class PiSkillError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'PiSkillError';
    this.code = code;
    this.details = details;
  }
}

interface SkillManifest {
  name: string;
  version?: string;
  description?: string;
  entry?: string;
  statePaths?: string[];
}

interface RegistryState {
  items: PiSkillInfo[];
}

interface PiSkillAuthorizationState {
  authorized: boolean;
  updatedAt: string;
  lastValidatedAt?: string;
  invalidatedAt?: string;
  reason?: string;
}

export interface PiSkillManagerOptions {
  rootDir?: string;
  fetchImpl?: typeof fetch;
  execFileImpl?: typeof execFile;
  executionTimeoutMs?: number;
}

/**
 * Filesystem-backed Pi skill lifecycle manager.
 *
 * Skills are treated as instruction-plus-CLI bundles. The manager never loads
 * arbitrary JavaScript into the API process; it only invokes an explicit
 * entrypoint in a child process with an admin-scoped HOME directory.
 */
export class PiSkillManager {
  readonly rootDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly execFileImpl: typeof execFile;
  private readonly executionTimeoutMs: number;

  constructor(options: PiSkillManagerOptions = {}) {
    this.rootDir = resolve(options.rootDir ?? process.env.PI_SKILL_ROOT ?? join(homedir(), '.pi', 'skills'));
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.execFileImpl = options.execFileImpl ?? execFile;
    this.executionTimeoutMs = positiveInteger(options.executionTimeoutMs, DEFAULT_EXEC_TIMEOUT_MS);
  }

  async list(adminId: string): Promise<PiSkillInfo[]> {
    const state = await this.readRegistry(adminId);
    return state.items.map((item) => ({ ...item }));
  }

  async install(input: PiSkillInstallInput): Promise<PiSkillInfo> {
    const source = input.source.trim();
    if (!source) throw new PiSkillError('SKILL_SOURCE_REQUIRED', 'skill source is required');
    const adminRoot = await this.ensureAdminRoot(input.adminId);
    const downloaded = await this.materializeSource(source, input.expectedSha256);
    const staging = await mkdtemp(join(tmpdir(), 'pi-skill-install-'));
    try {
      const archivePath = join(staging, 'skill.archive');
      await writeFile(archivePath, downloaded.bytes);
      const extractionRoot = join(staging, 'extracted');
      await mkdir(extractionRoot, { recursive: true });
      await this.extractArchive(archivePath, extractionRoot);
      const skillRoot = await findSkillRoot(extractionRoot);
      if (!skillRoot) throw new PiSkillError('SKILL_MANIFEST_MISSING', 'archive does not contain SKILL.md');
      const manifest = await parseSkillManifest(join(skillRoot, 'SKILL.md'));
      const id = sanitizeSkillId(manifest.name || basenameFromSource(source));
      const target = join(adminRoot, id);
      const targetParent = dirname(target);
      await mkdir(targetParent, { recursive: true });
      const replacement = join(staging, 'replacement');
      await cp(skillRoot, replacement, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
      try {
        await rename(replacement, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
        await cp(replacement, target, { recursive: true, force: true });
        await rm(replacement, { recursive: true, force: true });
      }
      const entry = manifest.entry ?? await findEntry(target);
      const now = new Date().toISOString();
      const state = await this.readRegistry(input.adminId);
      const previous = state.items.find((item) => item.id === id);
      const item: PiSkillInfo = {
        id,
        name: manifest.name || id,
        version: manifest.version,
        description: manifest.description,
        source: source,
        sourceUrl: normalizeSkillSource(source),
        installedAt: previous?.installedAt ?? now,
        updatedAt: now,
        enabled: previous?.enabled ?? true,
        authorized: previous?.authorized ?? false,
        entry,
        statePaths: manifest.statePaths,
        path: target,
      };
      state.items = [...state.items.filter((candidate) => candidate.id !== id), item].sort((a, b) => a.id.localeCompare(b.id));
      await this.writeRegistry(input.adminId, state);
      return { ...item };
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async authorize(adminId: string, skillId: string, token: string): Promise<PiSkillExecutionResult> {
    const cleanToken = token.trim();
    if (!cleanToken) throw new PiSkillError('SKILL_AUTH_TOKEN_REQUIRED', 'skill authorization token is required');
    if (cleanToken.length > 4096) throw new PiSkillError('SKILL_AUTH_TOKEN_INVALID', 'skill authorization token is too long');
    const login = await this.login({ adminId, skillId, token: cleanToken });
    if (login.status !== 'succeeded' && login.status !== 'already_authorized') {
      throw new PiSkillError('SKILL_AUTH_FAILED', sanitizeSkillOutput(login.stderr || login.stdout || login.prompt || 'skill authorization failed', [cleanToken]), login);
    }
    return {
      skillId: login.skillId,
      command: 'login',
      code: login.code,
      stdout: login.stdout,
      stderr: login.stderr,
    };
  }

  /**
   * Start an account login flow for a Skill. Token mode completes immediately;
   * interactive mode returns a pending-user-action result when the child CLI
   * needs a browser or pasted authorization code.
   */
  async login(input: PiSkillLoginInput): Promise<PiSkillLoginResult> {
    const id = sanitizeSkillId(input.skillId);
    const token = typeof input.token === 'string' ? input.token.trim() : '';
    if (token.length > 4096) throw new PiSkillError('SKILL_AUTH_TOKEN_INVALID', 'skill authorization token is too long');
    const state = await this.readRegistry(input.adminId);
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) throw new PiSkillError('SKILL_NOT_INSTALLED', `skill ${input.skillId} is not installed`);
    if (!item.enabled) throw new PiSkillError('SKILL_DISABLED', `skill ${input.skillId} is disabled`);
    if (!token && await this.hasUsableAuthorization(input.adminId, id, item.authorized)) {
      await this.touchAuthorization(input.adminId, id);
      return {
        skillId: id,
        status: 'already_authorized',
        code: -118,
        stdout: 'Reused persisted login state.',
        stderr: '',
        reusedAuthorization: true,
      };
    }
    const args = token ? ['--token', token, ...(input.args ?? [])] : [...(input.args ?? [])];
    const result = await this.executeInternal({
      adminId: input.adminId,
      skillId: id,
      command: 'login',
      args,
      sessionInput: input.sessionInput,
      sessionId: input.sessionId,
    }, token || undefined);
    const parsedCode = skillPayloadCode(result.parsed);
    const effectiveCode = parsedCode ?? result.code;
    const alreadyAuthorized = parsedCode === -118 || /\balready\s+authorized\b|授权仍然有效|已授权/i.test(`${result.stdout}\n${result.stderr}`);
    if ((effectiveCode === 0 || alreadyAuthorized) && !result.timedOut) {
      await this.markAuthorized(input.adminId, id);
      return {
        skillId: id,
        status: alreadyAuthorized ? 'already_authorized' : 'succeeded',
        code: effectiveCode,
        stdout: result.stdout,
        stderr: result.stderr,
        reusedAuthorization: false,
      };
    }
    const combined = sanitizeSkillOutput(`${result.stdout}\n${result.stderr}`.trim(), token ? [token] : []);
    const authUrl = extractAuthUrl(combined);
    const pending = !token && Boolean(result.timedOut || authUrl || looksLikeLoginPrompt(combined));
    if (pending) {
      return {
        skillId: id,
        status: 'pending_user_action',
        code: effectiveCode,
        stdout: result.stdout,
        stderr: result.stderr,
        prompt: combined || '请在浏览器中完成 Skill 登录；完成后把授权码粘贴回当前对话。',
        authUrl,
        userActionRequired: true,
      };
    }
    return {
      skillId: id,
      status: 'failed',
      code: effectiveCode,
      stdout: result.stdout,
      stderr: result.stderr,
      prompt: combined || 'Skill 登录失败，请检查登录信息后重试。',
      userActionRequired: false,
    };
  }

  async setEnabled(adminId: string, skillId: string, enabled: boolean): Promise<PiSkillInfo> {
    const state = await this.readRegistry(adminId);
    const item = state.items.find((candidate) => candidate.id === sanitizeSkillId(skillId));
    if (!item) throw new PiSkillError('SKILL_NOT_INSTALLED', `skill ${skillId} is not installed`);
    item.enabled = enabled;
    item.updatedAt = new Date().toISOString();
    await this.writeRegistry(adminId, state);
    return { ...item };
  }

  async execute(input: PiSkillExecutionInput): Promise<PiSkillExecutionResult> {
    return this.executeInternal(input);
  }

  async buildSystemPrompt(adminId: string): Promise<string> {
    const skills = (await this.list(adminId)).filter((skill) => skill.enabled);
    if (skills.length === 0) return '';
    let remaining = MAX_TOTAL_PROMPT;
    const sections: string[] = [];
    for (const skill of skills) {
      if (remaining <= 0) break;
      const skillPath = join(skill.path, 'SKILL.md');
      let body = '';
      try { body = await readFile(skillPath, 'utf8'); } catch { continue; }
      body = body.slice(0, Math.min(MAX_SKILL_TEXT, remaining));
      remaining -= body.length;
      sections.push(`## ${skill.name} (${skill.id})\nAuthorized: ${skill.authorized ? 'yes' : 'no'}\n${body}`);
    }
    if (sections.length === 0) return '';
    return [
      'Installed Pi skills are available below. Login state is persisted per admin and Skill across sessions, so reuse an authorized state and do not call pi_skill_login again unless pi_skill_exec reports requiresLogin or the user explicitly asks to re-authenticate. Use pi_skill_exec for skill CLI operations and pi_skill_login only for login. Never reveal authorization tokens or local paths. If a Skill result reports requiresLogin or unauthorized, do not repeat the original command; start login once or ask the user to finish login. Interactive login may return pending_user_action; stop and wait for the user to finish login or paste the code, and do not auto-retry.',
      sections.join('\n\n'),
    ].join('\n\n');
  }

  getModelTools(): ModelToolDefinition[] {
    return [
      {
        type: 'function',
        function: {
          name: 'pi_skill_list',
          description: 'List installed Pi skills and whether each is enabled and authorized.',
          parameters: { type: 'object', additionalProperties: false, properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'pi_skill_install',
          description: 'Install a Pi skill from a direct HTTP(S), GitHub repository, or local archive source. Use only when the user explicitly requests installation.',
          parameters: {
            type: 'object', additionalProperties: false,
            properties: { source: { type: 'string', description: 'HTTP(S), GitHub repository URL, file:// URL, or local archive path.' }, expectedSha256: { type: 'string' } },
            required: ['source'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'pi_skill_authorize',
          description: 'Authorize an installed Pi skill with a user-provided token. Never invent or expose tokens.',
          parameters: {
            type: 'object', additionalProperties: false,
            properties: { skillId: { type: 'string' }, token: { type: 'string' } },
            required: ['skillId', 'token'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'pi_skill_login',
          description: 'Start an interactive or token-based login for an installed Pi skill. If no token is provided, return the user action needed to finish login in a browser or by pasting a code.',
          parameters: {
            type: 'object', additionalProperties: false,
            properties: { skillId: { type: 'string' }, token: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } },
            required: ['skillId'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'pi_skill_exec',
          description: 'Execute an installed Pi skill command. Pass command name and argv-style args exactly as documented by the skill.',
          parameters: {
            type: 'object', additionalProperties: false,
            properties: { skillId: { type: 'string' }, command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } },
            required: ['skillId', 'command'],
          },
        },
      },
    ];
  }

  async executeModelTool(name: string, args: Record<string, unknown>, input: WorkspaceCommandInput): Promise<WorkspaceModelToolResult> {
    if (name === 'pi_skill_list') {
      const items = await this.list(input.adminId);
      return {
        kind: 'read',
        title: 'Pi Skill list',
        summary: `${items.length} installed skill(s)`,
        content: items.length
          ? items.map((item) => `${item.id} | ${item.version ?? 'unknown'} | ${item.enabled ? 'enabled' : 'disabled'} | ${item.authorized ? 'authorized' : 'unauthorized'}`).join('\n')
          : 'No Pi Skills are installed.',
        data: { items },
      };
    }
    if (name === 'pi_skill_install') {
      const source = typeof args.source === 'string' ? args.source.trim() : '';
      const expectedSha256 = typeof args.expectedSha256 === 'string' ? args.expectedSha256.trim() : undefined;
      const item = await this.install({ adminId: input.adminId, source, expectedSha256 });
      return {
        kind: 'read',
        title: 'Pi Skill installed',
        summary: `${item.name} ${item.version ?? ''}`.trim(),
        content: `Installed ${item.name} (${item.id}). ${item.authorized ? 'Authorization is complete.' : 'Authorization is still required.'}`,
        data: { item },
      };
    }
    if (name === 'pi_skill_authorize') {
      const skillId = typeof args.skillId === 'string' ? args.skillId.trim() : '';
      const token = typeof args.token === 'string' ? args.token : '';
      const result = await this.authorize(input.adminId, skillId, token);
      return {
        kind: 'read',
        title: 'Pi Skill authorized',
        summary: `${skillId} authorization complete`,
        content: sanitizeSkillOutput(result.stdout || result.stderr || 'Authorization complete.', [token]),
        data: { skillId, code: result.code },
      };
    }
    if (name === 'pi_skill_login') {
      const skillId = typeof args.skillId === 'string' ? args.skillId.trim() : '';
      const token = typeof args.token === 'string' ? args.token : undefined;
      const argv = Array.isArray(args.args) ? args.args.filter((value): value is string => typeof value === 'string').slice(0, 16) : [];
      const result = await this.login({ adminId: input.adminId, skillId, token, args: argv, sessionInput: input.instruction, sessionId: input.requestId });
      const secretList = token ? [token] : [];
      const content = sanitizeSkillOutput(result.status === 'pending_user_action'
        ? (result.prompt || '请完成 Skill 登录后把授权码粘贴回当前对话。')
        : (result.stdout || result.stderr || result.prompt || `Skill login ${result.status}.`), secretList);
      return {
        kind: 'read',
        title: `${skillId} | login`,
        summary: result.status === 'succeeded' || result.status === 'already_authorized' ? 'Skill login complete' : result.status === 'pending_user_action' ? 'Skill login needs user action' : 'Skill login failed',
        content,
        data: { skillId: result.skillId, status: result.status, code: result.code, userActionRequired: result.userActionRequired ?? false, authUrl: result.authUrl, reusedAuthorization: result.reusedAuthorization ?? false },
      };
    }
    if (name === 'pi_skill_exec') {
      const skillId = typeof args.skillId === 'string' ? args.skillId.trim() : '';
      const command = typeof args.command === 'string' ? args.command.trim() : '';
      const argv = Array.isArray(args.args) ? args.args.filter((value): value is string => typeof value === 'string') : [];
      const result = await this.execute({ adminId: input.adminId, skillId, command, args: argv, sessionInput: input.instruction, sessionId: input.requestId });
      const output = sanitizeSkillOutput(result.stdout || result.stderr || JSON.stringify(result.parsed ?? {}), argv.filter((value) => value.length >= 12));
      return {
        kind: 'read',
        title: `${skillId} | ${command}`,
        summary: result.requiresLogin ? 'Skill login required' : result.code === 0 ? 'Skill execution complete' : `Skill execution failed (${result.code})`,
        content: result.requiresLogin
          ? `${output}\nSkill login is required before retrying this command. Use pi_skill_login once; do not repeat the original command until login completes.`.trim()
          : output,
        data: { code: result.code, parsed: result.parsed, status: result.requiresLogin ? 'unauthorized' : result.code === 0 ? 'succeeded' : 'failed', requiresLogin: result.requiresLogin ?? false, userActionRequired: result.requiresLogin ?? false },
      };
    }
    throw new PiSkillError('SKILL_TOOL_UNKNOWN', `unknown Pi Skill tool: ${name}`);
  }

  async handleInstruction(input: { adminId: string; instruction: string }): Promise<PiSkillInstructionResult | undefined> {
    const normalized = input.instruction.replace(/\s+/g, ' ').trim();
    const urlMatch = normalized.match(/(?:https?:\/\/|file:\/\/)[^\s)\]}>]+|(?:[A-Za-z]:[\\/]|\/)[^\s)\]}>]+/i);
    const source = urlMatch?.[0].replace(/[),\]}>，。！？；：]+$/g, '');
    const tokenMatch = normalized.match(/(?:\u6388\u6743\u7801|\u6388\u6743\s*token|token|code|\u6388\u6743[^A-Za-z0-9]{0,12})\s*[:：]?\s*([A-Za-z0-9._-]{8,})/i)
      ?? normalized.match(/\b(CAC-[A-Za-z0-9_-]{8,})\b/i);
    const loginIntent = /(?:\u6388\u6743|\u7ed1\u5b9a|\u767b\u5f55|\u626b\u7801|authorize|login|sign\s*in)/i.test(normalized);
    const requestedSkill = extractSkillId(normalized);
    const installIntent = (/(?:\u5b89\u88c5|\u4e0b\u8f7d|\u6dfb\u52a0|install)/i.test(normalized) || /\bskill\b/i.test(normalized)) && Boolean(source);
    if (installIntent) {
      const item = await this.install({ adminId: input.adminId, source: source! });
      const authResult = tokenMatch?.[1] ? await this.login({ adminId: input.adminId, skillId: item.id, token: tokenMatch[1], sessionInput: normalized }) : undefined;
      const completed = authResult?.status === 'succeeded' || authResult?.status === 'already_authorized';
      return {
        title: 'Pi Skill install',
        summary: completed ? `${item.name} installed and authorized` : authResult?.status === 'pending_user_action' ? `${item.name} installed; login needs user action` : `${item.name} installed; authorization pending`,
        content: completed
          ? `Installed and \u6388\u6743 ${item.name} (${item.id}). The Skill is ready to use in Workspace.`
          : authResult?.status === 'pending_user_action'
            ? `Installed ${item.name} (${item.id}). ${authResult.prompt || '请完成登录后把授权码粘贴回当前对话。'}`
            : `Installed ${item.name} (${item.id}). Provide the Skill \u6388\u6743 token or ask me to start browser login before using account-scoped commands.`,
        data: { item, authorized: completed, loginStatus: authResult?.status, authUrl: authResult?.authUrl },
      };
    }
    if (loginIntent || Boolean(tokenMatch?.[1])) {
      const skills = await this.list(input.adminId);
      const candidate = (requestedSkill && skills.find((item) => item.id === sanitizeSkillId(requestedSkill) || item.name.toLowerCase() === requestedSkill.toLowerCase()))
        ?? skills.find((item) => /quark|夸克/i.test(item.name) || /quark|夸克/i.test(item.id))
        ?? (skills.length === 1 ? skills[0] : undefined)
        ?? (tokenMatch?.[1] ? skills.find((item) => !item.authorized) : undefined);
      if (!candidate) return undefined;
      const result = await this.login({ adminId: input.adminId, skillId: candidate.id, token: tokenMatch?.[1], sessionInput: normalized });
      const secretList = tokenMatch?.[1] ? [tokenMatch[1]] : [];
      const content = result.status === 'pending_user_action'
        ? sanitizeSkillOutput(result.prompt || '请在浏览器中完成登录；完成后把授权码粘贴回当前对话。', secretList)
        : result.status === 'succeeded' || result.status === 'already_authorized'
          ? `${candidate.name} is authorized.`
          : sanitizeSkillOutput(result.prompt || result.stderr || result.stdout || `${candidate.name} login failed.`, secretList);
      return { title: 'Pi Skill login', summary: result.status === 'succeeded' || result.status === 'already_authorized' ? `${candidate.name} login complete` : result.status === 'pending_user_action' ? `${candidate.name} login needs user action` : `${candidate.name} login failed`, content, data: { skillId: candidate.id, code: result.code, status: result.status, userActionRequired: result.userActionRequired ?? false, authUrl: result.authUrl } };
    }
    return undefined;
  }

  redactInput(value: string): string {
    return value
      .replace(/(\u6388\u6743\u7801|\u6388\u6743\s*token|token|code)\s*[:：]?\s*[A-Za-z0-9._-]{8,}/gi, '$1: [REDACTED]')
      .replace(/CAC-[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
  }

  private async executeInternal(input: PiSkillExecutionInput, secretToRedact?: string): Promise<PiSkillExecutionResult> {
    const id = sanitizeSkillId(input.skillId);
    const state = await this.readRegistry(input.adminId);
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) throw new PiSkillError('SKILL_NOT_INSTALLED', `skill ${input.skillId} is not installed`);
    if (!item.enabled) throw new PiSkillError('SKILL_DISABLED', `skill ${input.skillId} is disabled`);
    if (!item.entry) throw new PiSkillError('SKILL_ENTRYPOINT_MISSING', `skill ${input.skillId} has no executable entrypoint`);
    const command = input.command.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/.test(command)) throw new PiSkillError('SKILL_COMMAND_INVALID', 'skill command contains unsupported characters');
    const args = (input.args ?? []).map((arg) => String(arg)).slice(0, 64);
    const argv = [...args];
    if (input.sessionInput && !argv.includes('--session-input')) argv.push('--session-input', input.sessionInput);
    if (input.sessionId && !argv.includes('--session-id')) argv.push('--session-id', input.sessionId);
    const skillRoot = resolve(item.path);
    const entryPath = resolve(skillRoot, item.entry);
    if (!isWithin(skillRoot, entryPath) || !existsSync(entryPath)) throw new PiSkillError('SKILL_ENTRYPOINT_INVALID', 'skill entrypoint is outside the installed skill directory');
    const stateDir = join(this.rootDir, sanitizeAdminId(input.adminId), '.state', id);
    const runtimeDir = join(this.rootDir, sanitizeAdminId(input.adminId), '.runtime', id);
    const configDir = join(this.rootDir, sanitizeAdminId(input.adminId), '.config', id);
    const dataDir = join(this.rootDir, sanitizeAdminId(input.adminId), '.data', id);
    await Promise.all([mkdir(stateDir, { recursive: true }), mkdir(runtimeDir, { recursive: true }), mkdir(configDir, { recursive: true }), mkdir(dataDir, { recursive: true })]);
    await this.prepareStateBridge(skillRoot, stateDir, item.statePaths);
    const env = {
      ...process.env,
      HOME: runtimeDir,
      USERPROFILE: runtimeDir,
      OPENCLAW_CLI: '1',
      OPENCLAW_SERVICE_MARKER: 'openclaw',
      OPENCLAW_RUNTIME_DIR: runtimeDir,
      XDG_CONFIG_HOME: configDir,
      XDG_DATA_HOME: dataDir,
      XDG_STATE_HOME: stateDir,
      CODEX_HOME: join(configDir, 'codex'),
      PI_SKILL_ADMIN_ID: input.adminId,
      PI_SKILL_ROOT: skillRoot,
      PI_SKILL_RUNTIME_DIR: runtimeDir,
      PI_SKILL_CONFIG_DIR: configDir,
      PI_SKILL_DATA_DIR: dataDir,
      PI_SKILL_ID: id,
      PI_SKILL_STATE_DIR: stateDir,
      SKILL_STATE_DIR: stateDir,
      PI_SKILL_SESSION_ID: input.sessionId ?? '',
      PI_SKILL_SESSION_INPUT: input.sessionInput ?? '',
      PI_SKILL_LOGIN_MODE: input.command === 'login' ? (input.args?.includes('--token') ? 'token' : 'interactive') : 'command',
    };
    const executable = extname(entryPath).toLowerCase() === '.sh' ? 'bash' : process.execPath;
    try {
      const result = await promisify(this.execFileImpl)(executable, [entryPath, command, ...argv], { cwd: skillRoot, env, timeout: this.executionTimeoutMs, maxBuffer: 512 * 1024, windowsHide: true });
      const stdout = sanitizeSkillOutput(String(result.stdout ?? ''), secretToRedact ? [secretToRedact] : []);
      const stderr = sanitizeSkillOutput(String(result.stderr ?? ''), secretToRedact ? [secretToRedact] : []);
      const parsed = parseLastJsonLine(`${stdout}\n${stderr}`);
      const requiresLogin = detectRequiresLogin(command, stdout, stderr, parsed);
      if (requiresLogin) await this.markUnauthorized(input.adminId, id, 'skill reported an unauthenticated or expired session').catch(() => undefined);
      else if (item.authorized) await this.touchAuthorization(input.adminId, id).catch(() => undefined);
      await this.persistStateBridge(skillRoot, stateDir, item.statePaths);
      return { skillId: id, command, code: 0, stdout, stderr, parsed, requiresLogin };
    } catch (error) {
      const candidate = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
      const timedOut = candidate.code === 'ETIMEDOUT' || (candidate as { killed?: unknown }).killed === true || (candidate as { signal?: unknown }).signal === 'SIGTERM';
      const numeric = typeof candidate.code === 'number' ? candidate.code : 1;
      const stdout = sanitizeSkillOutput(String(candidate.stdout ?? ''), secretToRedact ? [secretToRedact] : []);
      const stderr = sanitizeSkillOutput(String(candidate.stderr ?? (error instanceof Error ? error.message : String(error))), secretToRedact ? [secretToRedact] : []);
      const parsed = parseLastJsonLine(`${stdout}\n${stderr}`);
      const requiresLogin = detectRequiresLogin(input.command, stdout, stderr, parsed);
      if (requiresLogin) await this.markUnauthorized(input.adminId, id, 'skill reported an unauthenticated or expired session').catch(() => undefined);
      await this.persistStateBridge(skillRoot, stateDir, item.statePaths).catch(() => undefined);
      return { skillId: id, command, code: numeric, stdout, stderr, parsed, timedOut, requiresLogin };
    }
  }

  private async markAuthorized(adminId: string, skillId: string): Promise<void> {
    const state = await this.readRegistry(adminId);
    const item = state.items.find((candidate) => candidate.id === sanitizeSkillId(skillId));
    if (!item) throw new PiSkillError('SKILL_NOT_INSTALLED', `skill ${skillId} is not installed`);
    item.authorized = true;
    item.updatedAt = new Date().toISOString();
    await this.writeRegistry(adminId, state);
    await this.writeAuthorizationState(adminId, skillId, {
      authorized: true,
      updatedAt: item.updatedAt,
      lastValidatedAt: item.updatedAt,
    });
  }

  private async markUnauthorized(adminId: string, skillId: string, reason: string): Promise<void> {
    const state = await this.readRegistry(adminId);
    const item = state.items.find((candidate) => candidate.id === sanitizeSkillId(skillId));
    if (!item) throw new PiSkillError('SKILL_NOT_INSTALLED', `skill ${skillId} is not installed`);
    const now = new Date().toISOString();
    item.authorized = false;
    item.updatedAt = now;
    await this.writeRegistry(adminId, state);
    await this.writeAuthorizationState(adminId, skillId, {
      authorized: false,
      updatedAt: now,
      invalidatedAt: now,
      reason,
    });
  }

  private async hasUsableAuthorization(adminId: string, skillId: string, registryAuthorized: boolean): Promise<boolean> {
    const persisted = await this.readAuthorizationState(adminId, skillId);
    return persisted ? persisted.authorized : registryAuthorized;
  }

  private async touchAuthorization(adminId: string, skillId: string): Promise<void> {
    const now = new Date().toISOString();
    const persisted = await this.readAuthorizationState(adminId, skillId);
    await this.writeAuthorizationState(adminId, skillId, {
      authorized: true,
      updatedAt: persisted?.updatedAt ?? now,
      lastValidatedAt: now,
    });
  }

  private authorizationStatePath(adminId: string, skillId: string): string {
    return join(this.rootDir, sanitizeAdminId(adminId), '.state', sanitizeSkillId(skillId), AUTH_STATE_FILE);
  }

  private async readAuthorizationState(adminId: string, skillId: string): Promise<PiSkillAuthorizationState | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.authorizationStatePath(adminId, skillId), 'utf8')) as Partial<PiSkillAuthorizationState>;
      if (typeof parsed.authorized !== 'boolean' || typeof parsed.updatedAt !== 'string') return undefined;
      return {
        authorized: parsed.authorized,
        updatedAt: parsed.updatedAt,
        lastValidatedAt: typeof parsed.lastValidatedAt === 'string' ? parsed.lastValidatedAt : undefined,
        invalidatedAt: typeof parsed.invalidatedAt === 'string' ? parsed.invalidatedAt : undefined,
        reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      };
    } catch {
      return undefined;
    }
  }

  private async writeAuthorizationState(adminId: string, skillId: string, value: PiSkillAuthorizationState): Promise<void> {
    const target = this.authorizationStatePath(adminId, skillId);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
    await rename(temp, target);
  }

  private async prepareStateBridge(skillRoot: string, stateDir: string, configuredPaths?: string[]): Promise<void> {
    for (const relativePath of normalizeStatePaths(configuredPaths)) {
      const source = join(skillRoot, relativePath);
      const mirror = join(stateDir, 'bridge', relativePath);
      if (!existsSync(mirror) && existsSync(source)) {
        await mkdir(dirname(mirror), { recursive: true });
        await cp(source, mirror, { recursive: true, force: true });
      }
      if (existsSync(mirror)) {
        await rm(source, { recursive: true, force: true }).catch(() => undefined);
        await mkdir(dirname(source), { recursive: true });
        await cp(mirror, source, { recursive: true, force: true });
      }
    }
  }

  private async persistStateBridge(skillRoot: string, stateDir: string, configuredPaths?: string[]): Promise<void> {
    for (const relativePath of normalizeStatePaths(configuredPaths)) {
      const source = join(skillRoot, relativePath);
      const mirror = join(stateDir, 'bridge', relativePath);
      if (!existsSync(source)) continue;
      await rm(mirror, { recursive: true, force: true }).catch(() => undefined);
      await mkdir(dirname(mirror), { recursive: true });
      await cp(source, mirror, { recursive: true, force: true });
    }
  }

  private async materializeSource(source: string, expectedSha256?: string): Promise<{ bytes: Buffer; sourceUrl?: string }> {
    if (source.startsWith('file://')) {
      const path = decodeURIComponent(new URL(source).pathname.replace(/^\/[A-Za-z]:/, (value) => value.slice(1)));
      const bytes = await readFile(path);
      return { bytes, sourceUrl: source };
    }
    if (!/^https?:\/\//i.test(source) && existsSync(source)) return { bytes: await readFile(source), sourceUrl: source };
    const url = normalizeSkillSource(source);
    if (!url) throw new PiSkillError('SKILL_SOURCE_INVALID', 'skill source must be an HTTP(S), GitHub, file://, or local archive path');
    const response = await this.fetchImpl(url, { redirect: 'follow' });
    if (!response.ok) throw new PiSkillError('SKILL_DOWNLOAD_FAILED', `skill download returned HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_ARCHIVE_BYTES) throw new PiSkillError('SKILL_ARCHIVE_TOO_LARGE', 'skill archive exceeds the 64 MB limit');
    if (expectedSha256) {
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual.toLowerCase() !== expectedSha256.trim().toLowerCase()) throw new PiSkillError('SKILL_CHECKSUM_MISMATCH', 'skill archive checksum does not match expectedSha256');
    }
    return { bytes, sourceUrl: url };
  }

  private async extractArchive(archivePath: string, targetDir: string): Promise<void> {
    let names: string[];
    let tarListingError: unknown;
    try {
      const listing = await execFileAsync('tar', ['-tf', archivePath], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
      names = String(listing.stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    } catch (error) {
      tarListingError = error;
      try {
        const listing = await execFileAsync('unzip', ['-Z1', archivePath], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
        names = String(listing.stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      } catch (unzipError) {
        throw new PiSkillError('SKILL_ARCHIVE_INVALID', unzipError instanceof Error ? unzipError.message : tarListingError instanceof Error ? tarListingError.message : 'unable to inspect skill archive');
      }
    }
    if (names.length === 0 || names.length > 20_000) throw new PiSkillError('SKILL_ARCHIVE_INVALID', 'skill archive is empty or contains too many entries');
    for (const name of names) if (!safeArchiveEntry(name)) throw new PiSkillError('SKILL_ARCHIVE_UNSAFE', `skill archive contains an unsafe entry: ${name}`);
    try {
      await execFileAsync('tar', ['-xf', archivePath, '-C', targetDir], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
      return;
    } catch (tarExtractError) {
      try {
        await execFileAsync('unzip', ['-q', archivePath, '-d', targetDir], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
      } catch (unzipError) {
        throw new PiSkillError('SKILL_ARCHIVE_INVALID', unzipError instanceof Error ? unzipError.message : tarExtractError instanceof Error ? tarExtractError.message : 'unable to extract skill archive');
      }
    }
  }

  private async ensureAdminRoot(adminId: string): Promise<string> {
    const root = join(this.rootDir, sanitizeAdminId(adminId));
    await mkdir(root, { recursive: true });
    return root;
  }

  private async readRegistry(adminId: string): Promise<RegistryState> {
    const root = await this.ensureAdminRoot(adminId);
    try {
      const parsed = JSON.parse(await readFile(join(root, REGISTRY_FILE), 'utf8')) as Partial<RegistryState>;
      return { items: Array.isArray(parsed.items) ? parsed.items.filter(isSkillInfo) : [] };
    } catch { return { items: [] }; }
  }

  private async writeRegistry(adminId: string, state: RegistryState): Promise<void> {
    const root = await this.ensureAdminRoot(adminId);
    const target = join(root, REGISTRY_FILE);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
    await rename(temp, target);
  }
}

function positiveInteger(value: number | undefined, fallback: number): number { return Number.isInteger(value) && value! > 0 ? value! : fallback; }

function sanitizeAdminId(value: string): string { return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'anonymous'; }

function sanitizeSkillId(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'skill'; }

function basenameFromSource(source: string): string {
  const value = source.split(/[\\/]/).at(-1) ?? 'skill';
  return value.replace(/\.(zip|tar|gz|tgz)$/i, '').replace(/\.tar$/i, '') || 'skill';
}

export function normalizeSkillSource(source: string): string | undefined {
  const trimmed = source.trim();
  if (trimmed.startsWith('file://')) return trimmed;
  if (/^https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/tree\/[^/]+)?\/?$/i.test(trimmed)) {
    const match = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/tree\/([^/]+))?\/?$/i);
    if (!match) return undefined;
    const branch = match[3] ?? 'main';
    return `https://github.com/${match[1]}/${match[2]}/archive/refs/heads/${encodeURIComponent(branch)}.zip`;
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return undefined;
}

function safeArchiveEntry(name: string): boolean {
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  const parts = normalized.split('/');
  if (parts.at(-1) === '') parts.pop();
  return parts.length > 0 && parts.every((part) => part !== '..' && part !== '');
}

async function findSkillRoot(root: string): Promise<string | undefined> {
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth > 5) continue;
    if (existsSync(join(current.path, 'SKILL.md'))) return current.path;
    let entries: Array<import('node:fs').Dirent<string>> = [];
    try { entries = await readdir(current.path, { withFileTypes: true, encoding: 'utf8' }); } catch { continue; }
    for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith('.')) queue.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
  }
  return undefined;
}

async function parseSkillManifest(path: string): Promise<SkillManifest> {
  const text = await readFile(path, 'utf8');
  const frontMatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const lines = (frontMatter?.[1] ?? '').split(/\r?\n/);
  const values = new Map<string, string>();
  for (const line of lines) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    values.set(match[1].toLowerCase(), stripQuotes(match[2]));
  }
  const name = values.get('name')?.trim() || '';
  const description = values.get('description')?.trim();
  const version = values.get('version')?.trim();
  const entry = values.get('entry')?.trim();
  const statePaths = values.get('statepaths')?.split(',').map((value) => value.trim()).filter(Boolean);
  if (!name) throw new PiSkillError('SKILL_NAME_MISSING', 'SKILL.md front matter must include name');
  return { name, version, description, entry, statePaths };
}

async function findEntry(root: string): Promise<string | undefined> {
  const preferred = ['scripts/quark-drive.cjs', 'scripts/main.cjs', 'scripts/main.js', 'index.cjs', 'index.js', 'main.cjs', 'main.js'];
  for (const entry of preferred) if (existsSync(join(root, entry))) return entry;
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { bin?: string | Record<string, string> };
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && Object.values(pkg.bin)[0];
    if (bin && existsSync(join(root, bin))) return bin.replace(/\\/g, '/');
  } catch { /* no package manifest */ }
  return undefined;
}

function stripQuotes(value: string): string { return value.replace(/^['"]|['"]$/g, ''); }

function isWithin(root: string, child: string): boolean {
  const rootPath = resolve(root) + sep;
  return resolve(child).startsWith(rootPath);
}

function parseLastJsonLine(value: string): unknown {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    try { return JSON.parse(line); } catch { /* keep scanning */ }
  }
  return undefined;
}

function skillPayloadCode(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === 'number' && Number.isFinite(code) ? code : undefined;
}

function detectRequiresLogin(command: string, stdout: string, stderr: string, parsed: unknown): boolean {
  if (command.trim().toLowerCase() === 'login') return false;
  const payloadCode = skillPayloadCode(parsed);
  if (payloadCode !== undefined && [-103, -104, -1408].includes(payloadCode)) return true;
  const text = `${stdout}\n${stderr}\n${JSON.stringify(parsed ?? '')}`;
  return /(?:not[_ -]?authenticated|unauthori[sz]ed|authentication\s+(?:required|failed|expired)|authorization\s+(?:required|failed|expired)|login\s+(?:required|failed|expired)|token\s+(?:expired|invalid)|session\s+expired|action\s*[:=]\s*not_authenticated|未登录|未授权|认证失败|认证已过期|授权失败|授权已过期|登录已过期|需要登录)/i.test(text);
}

function looksLikeLoginPrompt(value: string): boolean {
  return /(?:oauth|authorize|authorization|login|sign\s*in|browser|扫码|登录|授权|验证码|授权码|粘贴)/i.test(value);
}

function extractAuthUrl(value: string): string | undefined {
  const matches = value.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  return matches.find((url) => /oauth|auth|login|authorize|quark|pan\./i.test(url));
}

function extractSkillId(value: string): string | undefined {
  const explicit = value.match(/(?:skill(?:\s*(?:id|name))?|技能(?:\s*(?:id|名称))?)\s*[:：]?\s*([A-Za-z0-9._-]{2,80})/i);
  if (explicit?.[1]) return explicit[1];
  const named = value.match(/(?:夸克网盘|夸克|quark(?:clouddrive)?)/i);
  return named?.[0];
}

function normalizeStatePaths(paths?: string[]): string[] {
  const values = paths?.length ? paths : ['codex', '.codex', '.quarkclouddrive'];
  return [...new Set(values.map((value) => value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter((value) => value && !value.split('/').includes('..') && !/^[A-Za-z]:/.test(value)))];
}

function sanitizeSkillOutput(value: string, secrets: string[]): string {
  let result = value.slice(0, 32_000);
  for (const secret of secrets) if (secret) result = result.split(secret).join('[REDACTED]');
  return result;
}

function isSkillInfo(value: unknown): value is PiSkillInfo {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PiSkillInfo>;
  return typeof candidate.id === 'string' && typeof candidate.name === 'string' && typeof candidate.path === 'string';
}


