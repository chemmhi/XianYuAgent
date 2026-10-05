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
}

interface RegistryState {
  items: PiSkillInfo[];
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
      await rename(replacement, target);
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
    const result = await this.executeInternal({ adminId, skillId, command: 'login', args: ['--token', cleanToken] }, cleanToken);
    if (result.code !== 0) throw new PiSkillError('SKILL_AUTH_FAILED', sanitizeSkillOutput(result.stderr || result.stdout, [cleanToken]), result);
    const state = await this.readRegistry(adminId);
    const item = state.items.find((candidate) => candidate.id === sanitizeSkillId(skillId));
    if (!item) throw new PiSkillError('SKILL_NOT_INSTALLED', `skill ${skillId} is not installed`);
    item.authorized = true;
    item.updatedAt = new Date().toISOString();
    await this.writeRegistry(adminId, state);
    return result;
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
      'Installed Pi skills are available below. Use pi_skill_exec for skill CLI operations. Never reveal authorization tokens or local paths. If a skill is not authorized, explain the authorization requirement and do not fabricate success.',
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
    if (name === 'pi_skill_exec') {
      const skillId = typeof args.skillId === 'string' ? args.skillId.trim() : '';
      const command = typeof args.command === 'string' ? args.command.trim() : '';
      const argv = Array.isArray(args.args) ? args.args.filter((value): value is string => typeof value === 'string') : [];
      const result = await this.execute({ adminId: input.adminId, skillId, command, args: argv, sessionInput: input.instruction, sessionId: input.requestId });
      const output = sanitizeSkillOutput(result.stdout || result.stderr || JSON.stringify(result.parsed ?? {}), argv.filter((value) => value.length >= 12));
      return {
        kind: 'read',
        title: `${skillId} | ${command}`,
        summary: result.code === 0 ? 'Skill execution complete' : `Skill execution failed (${result.code})`,
        content: output,
        data: { code: result.code, parsed: result.parsed },
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
    const installIntent = (/(?:\u5b89\u88c5|\u4e0b\u8f7d|\u6dfb\u52a0|install)/i.test(normalized) || /\bskill\b/i.test(normalized)) && Boolean(source);
    if (installIntent) {
      const item = await this.install({ adminId: input.adminId, source: source! });
      let authResult: PiSkillExecutionResult | undefined;
      if (tokenMatch?.[1]) authResult = await this.authorize(input.adminId, item.id, tokenMatch[1]);
      return {
        title: 'Pi Skill install',
        summary: authResult ? `${item.name} installed and authorized` : `${item.name} installed; authorization pending`,
        content: authResult
          ? `Installed and \u6388\u6743 ${item.name} (${item.id}). The Skill is ready to use in Workspace.`
          : `Installed ${item.name} (${item.id}). Provide the Skill \u6388\u6743 token before using account-scoped commands.`,
        data: { item, authorized: Boolean(authResult) },
      };
    }
    if (tokenMatch?.[1] && /(?:\u6388\u6743|\u7ed1\u5b9a|\u767b\u5f55|authorize|login)/i.test(normalized)) {
      const skills = await this.list(input.adminId);
      const candidate = skills.find((item) => /quark|\u66f2\u5361/i.test(item.name) || /quark|\u66f2\u5361/i.test(item.id));
      if (!candidate) return undefined;
      const result = await this.authorize(input.adminId, candidate.id, tokenMatch[1]);
      return { title: 'Pi Skill authorization', summary: `${candidate.name} authorization complete`, content: `${candidate.name} is authorized.`, data: { skillId: candidate.id, code: result.code } };
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
    const skillRoot = resolve(item.path);
    const entryPath = resolve(skillRoot, item.entry);
    if (!isWithin(skillRoot, entryPath) || !existsSync(entryPath)) throw new PiSkillError('SKILL_ENTRYPOINT_INVALID', 'skill entrypoint is outside the installed skill directory');
    const stateDir = join(this.rootDir, sanitizeAdminId(input.adminId), '.state', id);
    await mkdir(stateDir, { recursive: true });
    const env = {
      ...process.env,
      HOME: stateDir,
      USERPROFILE: stateDir,
      PI_SKILL_ID: id,
      PI_SKILL_STATE_DIR: stateDir,
      SKILL_STATE_DIR: stateDir,
      PI_SKILL_SESSION_ID: input.sessionId ?? '',
      PI_SKILL_SESSION_INPUT: input.sessionInput ?? '',
    };
    const executable = extname(entryPath).toLowerCase() === '.sh' ? 'bash' : process.execPath;
    const argv = extname(entryPath).toLowerCase() === '.sh' ? [entryPath, command, ...args] : [entryPath, command, ...args];
    try {
      const result = await promisify(this.execFileImpl)(executable, argv, { cwd: skillRoot, env, timeout: this.executionTimeoutMs, maxBuffer: 512 * 1024, windowsHide: true });
      const stdout = sanitizeSkillOutput(String(result.stdout ?? ''), secretToRedact ? [secretToRedact] : []);
      const stderr = sanitizeSkillOutput(String(result.stderr ?? ''), secretToRedact ? [secretToRedact] : []);
      return { skillId: id, command, code: 0, stdout, stderr, parsed: parseLastJsonLine(stdout) };
    } catch (error) {
      const candidate = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
      const numeric = typeof candidate.code === 'number' ? candidate.code : 1;
      const stdout = sanitizeSkillOutput(String(candidate.stdout ?? ''), secretToRedact ? [secretToRedact] : []);
      const stderr = sanitizeSkillOutput(String(candidate.stderr ?? (error instanceof Error ? error.message : String(error))), secretToRedact ? [secretToRedact] : []);
      return { skillId: id, command, code: numeric, stdout, stderr, parsed: parseLastJsonLine(stdout) };
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
  if (!name) throw new PiSkillError('SKILL_NAME_MISSING', 'SKILL.md front matter must include name');
  return { name, version, description, entry };
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


