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
