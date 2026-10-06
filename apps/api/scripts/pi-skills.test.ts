import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { PiSkillManager, normalizeSkillSource } from '../src/pi-skills.js';
import { MemoryStore } from '../src/store-memory.js';
import { PiRuntimeAdapter, type ModelClient, type ModelCompletionResult, type ModelStreamHandlers } from '../src/pi-runtime.js';
import type { WorkspaceCommandOrchestrator } from '../src/workspace-commands.js';

const execFile = promisify(execFileCallback);

test('normalizes GitHub skill repository URLs', () => {
  assert.equal(normalizeSkillSource('https://github.com/acme/demo'), 'https://github.com/acme/demo/archive/refs/heads/main.zip');
  assert.equal(normalizeSkillSource('https://github.com/acme/demo/tree/dev'), 'https://github.com/acme/demo/archive/refs/heads/dev.zip');
  assert.equal(normalizeSkillSource('https://example.com/skill.zip'), 'https://example.com/skill.zip');
});

test('installs, lists, authorizes, injects, and executes a local Pi skill archive', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'pi-skill-fixture-'));
  const skillRoot = join(fixtureRoot, 'demo-skill');
  const root = join(fixtureRoot, 'installed');
  try {
    await mkdir(join(skillRoot, 'scripts'), { recursive: true });
    await writeFile(join(skillRoot, 'SKILL.md'), '---\nname: demo-skill\nversion: 1.2.3\ndescription: Demo skill\n---\nUse demo_exec.\n');
    await writeFile(join(skillRoot, 'scripts', 'main.cjs'), [
      "const args = process.argv.slice(2);",
      "if (args[0] === 'login' && args[2] === 'secret-token') { console.log(JSON.stringify({ code: 0, msg: 'authorized' })); process.exit(0); }",
      "console.log(JSON.stringify({ code: 0, msg: 'ran', args }));",
    ].join('\n'));
    const archive = join(fixtureRoot, 'demo-skill.zip');
    await execFile('tar', ['-a', '-c', '-f', archive, '-C', fixtureRoot, 'demo-skill']);

    const manager = new PiSkillManager({ rootDir: root });
    const installed = await manager.install({ adminId: 'admin/1', source: archive });
    assert.equal(installed.id, 'demo-skill');
    assert.equal(installed.version, '1.2.3');
    assert.equal(installed.authorized, false);
    assert.match(await readFile(join(root, 'admin_1', 'demo-skill', 'SKILL.md'), 'utf8'), /Demo skill/);

    const auth = await manager.authorize('admin/1', 'demo-skill', 'secret-token');
    assert.equal(auth.code, 0);
    const listed = await manager.list('admin/1');
    assert.equal(listed[0]?.authorized, true);
    const prompt = await manager.buildSystemPrompt('admin/1');
    assert.match(prompt, /demo-skill/);
    const execution = await manager.execute({ adminId: 'admin/1', skillId: 'demo-skill', command: 'search', args: ['--keyword', 'hello'] });
    assert.equal(execution.code, 0);
    assert.deepEqual(execution.parsed, { code: 0, msg: 'ran', args: ['search', '--keyword', 'hello'] });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('resolves canonical Skill IDs and hydrates aliases from legacy registries', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'pi-skill-canonical-id-'));
  try {
    const skillRoot = join(fixtureRoot, 'quarkclouddrive');
    const installedRoot = join(fixtureRoot, 'installed');
    await mkdir(join(skillRoot, 'scripts'), { recursive: true });
    await writeFile(join(skillRoot, 'SKILL.md'), '---\nname: quarkclouddrive\nmetadata.canonicalSkillId: quarkclouddrive_816db00f\nversion: 1.0.0\n---\n');
    await writeFile(join(skillRoot, 'scripts', 'main.cjs'), "console.log(JSON.stringify({ code: 0, args: process.argv.slice(2) }))");
    const archive = join(fixtureRoot, 'quarkclouddrive.zip');
    await execFile('tar', ['-a', '-c', '-f', archive, '-C', fixtureRoot, 'quarkclouddrive']);

    const manager = new PiSkillManager({ rootDir: installedRoot });
    const installed = await manager.install({ adminId: 'admin/canonical', source: archive });
    assert.equal(installed.id, 'quarkclouddrive');
    assert.equal(installed.canonicalSkillId, 'quarkclouddrive_816db00f');
    const aliasExecution = await manager.execute({ adminId: 'admin/canonical', skillId: 'quarkclouddrive_816db00f', command: 'browse', args: ['--all'] });
    assert.equal(aliasExecution.code, 0);
    assert.deepEqual(aliasExecution.parsed, { code: 0, args: ['browse', '--all'] });

    const registryPath = join(installedRoot, 'admin_canonical', '.registry.json');
    const legacyRegistry = JSON.parse(await readFile(registryPath, 'utf8')) as { items: Array<Record<string, unknown>> };
    delete legacyRegistry.items[0].canonicalSkillId;
    await writeFile(registryPath, JSON.stringify(legacyRegistry, null, 2), 'utf8');
    const reloaded = new PiSkillManager({ rootDir: installedRoot });
    const hydratedExecution = await reloaded.execute({ adminId: 'admin/canonical', skillId: 'quarkclouddrive_816db00f', command: 'browse' });
    assert.equal(hydratedExecution.code, 0);
    assert.equal((await reloaded.list('admin/canonical'))[0]?.canonicalSkillId, 'quarkclouddrive_816db00f');
    const persisted = JSON.parse(await readFile(registryPath, 'utf8')) as { items: Array<{ canonicalSkillId?: string }> };
    assert.equal(persisted.items[0]?.canonicalSkillId, 'quarkclouddrive_816db00f');
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('passes the original Workspace input and stable session id to every Skill command', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'pi-skill-session-args-'));
  try {
    const skillRoot = join(fixtureRoot, 'session-skill');
    await mkdir(join(skillRoot, 'scripts'), { recursive: true });
    await writeFile(join(skillRoot, 'SKILL.md'), '---\nname: session-skill\nversion: 1.0.0\n---\n');
    await writeFile(join(skillRoot, 'scripts', 'main.cjs'), [
      "console.log(JSON.stringify({ code: 0, args: process.argv.slice(2) }));",
    ].join('\n'));
    const archive = join(fixtureRoot, 'session-skill.zip');
    await execFile('tar', ['-a', '-c', '-f', archive, '-C', fixtureRoot, 'session-skill']);

    const manager = new PiSkillManager({ rootDir: join(fixtureRoot, 'installed') });
    const installed = await manager.install({ adminId: 'admin/session', source: archive });
    const result = await manager.execute({ adminId: 'admin/session', skillId: installed.id, command: 'browse', args: ['--all'], sessionInput: '帮我查看夸克网盘里都有哪些文件', sessionId: '1770000000-a1b2c3' });
    assert.equal(result.code, 0);
    assert.deepEqual(result.parsed, {
      code: 0,
      args: ['browse', '--all', '--session-input', '帮我查看夸克网盘里都有哪些文件', '--session-id', '1770000000-a1b2c3'],
    });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('handles the install plus authorization instruction without exposing the token in output', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'pi-skill-instruction-'));
  const skillRoot = join(fixtureRoot, 'quarkclouddrive');
  try {
    await mkdir(join(skillRoot, 'scripts'), { recursive: true });
    await writeFile(join(skillRoot, 'SKILL.md'), '---\nname: quarkclouddrive\nversion: 1.0.22\ndescription: Quark Drive\n---\n');
    await writeFile(join(skillRoot, 'scripts', 'quark-drive.cjs'), "console.log(JSON.stringify({code: 0, msg: 'authorized'}))");
    const archive = join(fixtureRoot, 'quarkclouddrive.zip');
    await execFile('tar', ['-a', '-c', '-f', archive, '-C', fixtureRoot, 'quarkclouddrive']);
    const manager = new PiSkillManager({ rootDir: join(fixtureRoot, 'installed') });
    const result = await manager.handleInstruction({ adminId: 'admin-1', instruction: `请安装 夸克网盘 Skill，地址：${archive} 授权码：CAC-ddd49a24b991547f8970f2ef923dcd` });
    assert.ok(result);
    assert.match(result.content, /授权/);
    assert.doesNotMatch(JSON.stringify(result), /CAC-ddd49a24b991547f8970f2ef923dcd/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('completes the runtime lifecycle for a direct Skill instruction', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'pi-skill-runtime-lifecycle-'));
  try {
    const skillRoot = join(fixtureRoot, 'demo-skill');
    await mkdir(join(skillRoot, 'scripts'), { recursive: true });
    await writeFile(join(skillRoot, 'SKILL.md'), '---\nname: demo-skill\nversion: 1.0.0\ndescription: Demo skill\n---\n');
    await writeFile(join(skillRoot, 'scripts', 'main.cjs'), "console.log(JSON.stringify({ code: 0, msg: 'ok' }))");
    const archive = join(fixtureRoot, 'demo-skill.zip');
    await execFile('tar', ['-a', '-c', '-f', archive, '-C', fixtureRoot, 'demo-skill']);

    const manager = new PiSkillManager({ rootDir: join(fixtureRoot, 'installed') });
    const store = new MemoryStore();
    const admin = await store.createAdmin({ email: 'pi-skill-lifecycle@example.com', passwordHash: 'hash', displayName: 'Pi Skill Lifecycle' });
    const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'pi-skill-lifecycle' });
    const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Pi Skill Lifecycle' });
    const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: `请安装 Skill，技能地址：${archive}` });
    const runtime = new PiRuntimeAdapter(store, { async complete(): Promise<ModelCompletionResult> { return { content: 'unused', model: 'unused' }; } }, { skillManager: manager, model: 'pi-skill-test' });
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });

    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const bundle = await store.getRun(admin.id, created.run.id);
      if (bundle?.run.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const bundle = await store.getRun(admin.id, created.run.id);
    assert.equal(bundle?.run.status, 'succeeded');
    assert.equal(bundle?.steps[0]?.status, 'succeeded');
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.ok(events.some((event) => event.eventType === 'workspace.skill.lifecycle' && event.payload.status === 'succeeded'));
    assert.ok(events.some((event) => event.eventType === 'run.succeeded'));
    runtime.stop();
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('exposes Pi Skill tools to the runtime and routes tool calls to the skill manager', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'pi-skill-runtime-'));
  try {
    const manager = new PiSkillManager({ rootDir: join(fixtureRoot, 'installed') });
    const store = new MemoryStore();
    const admin = await store.createAdmin({ email: 'pi-skill-runtime@example.com', passwordHash: 'hash', displayName: 'Pi Skill Runtime' });
    const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'pi-skill-runtime' });
    const session = await store.createAgentSession({ adminId: admin.id, accountId: account.id, title: 'Pi Skill Runtime' });
    const created = await store.createRun({ adminId: admin.id, accountId: account.id, sessionId: session.id, instruction: 'list installed skills' });
    let round = 0;
    let seenSkillTool = false;
    const model: ModelClient = {
      async stream(input, handlers: ModelStreamHandlers): Promise<ModelCompletionResult> {
        round += 1;
        if (round === 1) {
          seenSkillTool = Boolean(input.tools?.some((tool) => tool.type === 'function' && tool.function.name === 'pi_skill_list'));
          const call = { id: 'pi-skill-call', type: 'function' as const, function: { name: 'pi_skill_list', arguments: '{}' } };
          await handlers.onToolCall?.(call);
          return { content: '', model: 'pi-skill-test', toolCalls: [call] };
        }
        await handlers.onTextDelta?.('Pi Skills listed');
        return { content: 'Pi Skills listed', model: 'pi-skill-test' };
      },
      async complete() { return { content: 'unused', model: 'unused' }; },
    };
    const commandTool = {
      getModelTools: () => [],
      executeModelTool: async () => { throw new Error('workspace tool should not be called'); },
    } as unknown as WorkspaceCommandOrchestrator;
    const runtime = new PiRuntimeAdapter(store, model, { workspaceCommands: commandTool, skillManager: manager, model: 'pi-skill-test' });
    runtime.enqueue({ adminId: admin.id, sessionId: session.id, run: created.run, steps: created.steps });
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const bundle = await store.getRun(admin.id, created.run.id);
      if (bundle?.run.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(seenSkillTool, true);
    assert.equal((await store.getRun(admin.id, created.run.id))?.run.status, 'succeeded');
    const events = await store.listRunEvents(admin.id, created.run.id, 0);
    assert.ok(events.some((event) => event.eventType === 'tool.result' && event.payload.toolName === 'pi_skill_list' && event.payload.status === 'succeeded'));
    runtime.stop();
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('starts interactive login with isolated runtime directories and leaves authorization pending', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'pi-skill-login-pending-'));
  try {
    const skillRoot = join(fixtureRoot, 'login-skill');
    await mkdir(join(skillRoot, 'scripts'), { recursive: true });
    await mkdir(join(skillRoot, 'codex'), { recursive: true });
    await writeFile(join(skillRoot, 'SKILL.md'), '---\nname: login-skill\nversion: 1.0.0\n---\n');
    await writeFile(join(skillRoot, 'codex', 'config.json'), '{"seed":true}');
    await writeFile(join(skillRoot, 'scripts', 'main.cjs'), [
      "const args = process.argv.slice(2);",
      "if (args[0] === 'login' && !args.includes('--token')) { console.log(JSON.stringify({ code: -1408, msg: 'open browser https://example.test/oauth/login', env: { home: process.env.HOME, runtime: process.env.OPENCLAW_RUNTIME_DIR, config: process.env.XDG_CONFIG_HOME, data: process.env.XDG_DATA_HOME, state: process.env.XDG_STATE_HOME, codex: process.env.CODEX_HOME, admin: process.env.PI_SKILL_ADMIN_ID, root: process.env.PI_SKILL_ROOT, mode: process.env.PI_SKILL_LOGIN_MODE, openclawCli: process.env.OPENCLAW_CLI, openclawMarker: process.env.OPENCLAW_SERVICE_MARKER } })); process.exit(1); }",
      "console.log(JSON.stringify({ code: 0, msg: 'ok' }));",
    ].join('\n'));
    const archive = join(fixtureRoot, 'login-skill.zip');
    await execFile('tar', ['-a', '-c', '-f', archive, '-C', fixtureRoot, 'login-skill']);

    const manager = new PiSkillManager({ rootDir: join(fixtureRoot, 'installed'), executionTimeoutMs: 5_000 });
    const installed = await manager.install({ adminId: 'admin/login', source: archive });
    const result = await manager.login({ adminId: 'admin/login', skillId: installed.id });
    assert.equal(result.status, 'pending_user_action');
    assert.equal(result.userActionRequired, true);
    assert.match(result.authUrl ?? '', /example\.test\/oauth\/login/);
    assert.match(result.prompt ?? '', /open browser/);
    assert.equal((await manager.list('admin/login'))[0]?.authorized, false);
    const parsed = parseLastJson(result.prompt ?? '');
    assert.equal(parsed?.env?.admin, 'admin/login');
    assert.equal(parsed?.env?.mode, 'interactive');
    assert.equal(parsed?.env?.openclawCli, '1');
    assert.equal(parsed?.env?.openclawMarker, 'openclaw');
    assert.notEqual(parsed?.env?.runtime, parsed?.env?.config);
    assert.match(parsed?.env?.root ?? '', /login-skill/);

    const instruction = await manager.handleInstruction({ adminId: 'admin/login', instruction: '请登录 login-skill' });
    assert.ok(instruction);
    assert.equal(instruction.data.status, 'pending_user_action');
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('marks authorization only after the Skill reports a successful login payload', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'pi-skill-login-result-'));
  try {
    const skillRoot = join(fixtureRoot, 'token-skill');
    await mkdir(join(skillRoot, 'scripts'), { recursive: true });
    await writeFile(join(skillRoot, 'SKILL.md'), '---\nname: token-skill\nversion: 1.0.0\n---\n');
    await writeFile(join(skillRoot, 'scripts', 'main.cjs'), [
      "const args = process.argv.slice(2);",
      "if (args[0] === 'login' && args[2] === 'good-token') { console.log(JSON.stringify({ code: 0, msg: 'authorized' })); process.exit(0); }",
      "if (args[0] === 'login') { console.log(JSON.stringify({ code: -401, msg: 'invalid token' })); process.exit(0); }",
      "console.log(JSON.stringify({ code: 0, msg: 'ok' }));",
    ].join('\n'));
    const archive = join(fixtureRoot, 'token-skill.zip');
    await execFile('tar', ['-a', '-c', '-f', archive, '-C', fixtureRoot, 'token-skill']);
    const manager = new PiSkillManager({ rootDir: join(fixtureRoot, 'installed') });
    const installed = await manager.install({ adminId: 'admin/token', source: archive });

    const failed = await manager.login({ adminId: 'admin/token', skillId: installed.id, token: 'bad-token' });
    assert.equal(failed.status, 'failed');
    assert.equal((await manager.list('admin/token'))[0]?.authorized, false);

    const succeeded = await manager.login({ adminId: 'admin/token', skillId: installed.id, token: 'good-token' });
    assert.equal(succeeded.status, 'succeeded');
    assert.equal((await manager.list('admin/token'))[0]?.authorized, true);
    assert.doesNotMatch(JSON.stringify(succeeded), /good-token/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('persists authorization across manager instances, reuses it, and invalidates it after expiry', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'pi-skill-login-persisted-'));
  try {
    const skillRoot = join(fixtureRoot, 'persist-skill');
    const installedRoot = join(fixtureRoot, 'installed');
    await mkdir(join(skillRoot, 'scripts'), { recursive: true });
    await writeFile(join(skillRoot, 'SKILL.md'), '---\nname: persist-skill\nversion: 1.0.0\n---\n');
    await writeFile(join(skillRoot, 'scripts', 'main.cjs'), [
      "const fs = require('fs');",
      "const path = require('path');",
      "const args = process.argv.slice(2);",
      "const countFile = path.join(process.env.PI_SKILL_STATE_DIR, 'login-count.txt');",
      "const count = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, 'utf8')) : 0;",
      "if (args[0] === 'login') fs.writeFileSync(countFile, String(count + 1));",
      "if (args[0] === 'login' && args[2] === 'good-token') { console.log(JSON.stringify({ code: 0, msg: 'authorized' })); process.exit(0); }",
      "if (args[0] === 'login') { console.log(JSON.stringify({ code: -1408, msg: 'open browser https://example.test/oauth/login' })); process.exit(1); }",
      "if (args[0] === 'search') { console.log(JSON.stringify({ code: -103, action: 'not_authenticated', msg: 'session expired' })); process.exit(1); }",
      "console.log(JSON.stringify({ code: 0, msg: 'ok' }));",
    ].join('\n'));
    const archive = join(fixtureRoot, 'persist-skill.zip');
    await execFile('tar', ['-a', '-c', '-f', archive, '-C', fixtureRoot, 'persist-skill']);

    const manager = new PiSkillManager({ rootDir: installedRoot, executionTimeoutMs: 5_000 });
    const installed = await manager.install({ adminId: 'admin/persist', source: archive });
    const firstLogin = await manager.login({ adminId: 'admin/persist', skillId: installed.id, token: 'good-token' });
    assert.equal(firstLogin.status, 'succeeded');

    const authStatePath = join(installedRoot, 'admin_persist', '.state', installed.id, 'authorization.json');
    const authState = JSON.parse(await readFile(authStatePath, 'utf8')) as { authorized?: boolean; lastValidatedAt?: string };
    assert.equal(authState.authorized, true);
    assert.equal(typeof authState.lastValidatedAt, 'string');
    assert.doesNotMatch(await readFile(authStatePath, 'utf8'), /good-token/);

    const nextSessionManager = new PiSkillManager({ rootDir: installedRoot, executionTimeoutMs: 5_000 });
    const reused = await nextSessionManager.login({ adminId: 'admin/persist', skillId: installed.id });
    assert.equal(reused.status, 'already_authorized');
    assert.equal(reused.reusedAuthorization, true);
    const loginCountAfterReuse = await readFile(join(installedRoot, 'admin_persist', '.state', installed.id, 'login-count.txt'), 'utf8');
    assert.equal(loginCountAfterReuse, '1');

    const expired = await nextSessionManager.execute({ adminId: 'admin/persist', skillId: installed.id, command: 'search' });
    assert.equal(expired.requiresLogin, true);
    assert.equal((await nextSessionManager.list('admin/persist'))[0]?.authorized, false);
    const invalidated = JSON.parse(await readFile(authStatePath, 'utf8')) as { authorized?: boolean; invalidatedAt?: string };
    assert.equal(invalidated.authorized, false);
    assert.equal(typeof invalidated.invalidatedAt, 'string');

    const reLogin = await nextSessionManager.login({ adminId: 'admin/persist', skillId: installed.id });
    assert.equal(reLogin.status, 'pending_user_action');
    const loginCountAfterExpiry = await readFile(join(installedRoot, 'admin_persist', '.state', installed.id, 'login-count.txt'), 'utf8');
    assert.equal(loginCountAfterExpiry, '2');
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

function parseLastJson(value: string): any {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    try { return JSON.parse(line); } catch { /* keep scanning */ }
  }
  return undefined;
}
