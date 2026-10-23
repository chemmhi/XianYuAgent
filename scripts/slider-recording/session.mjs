import { mkdirSync, existsSync, cpSync, writeFileSync, readFileSync, createWriteStream, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { platform, release, arch, cpus, totalmem, networkInterfaces, hostname } from 'node:os';
import { createRecordingStore, writeIntegrity } from './store.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [action, rootArg, label, ...args] = process.argv.slice(2);
const root = resolve(rootArg ?? join(project, 'artifacts/slider-recording', new Date().toISOString().replaceAll(':', '-')));
const store = createRecordingStore(root);
if (action === 'prepare') {
  mkdirSync(join(root, 'baseline'), { recursive: true });
  const run = (command, argv) => {
    const result = spawnSync(command, argv, { cwd: project, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    store.event('preflight.command', { command, argv, code: result.status, error: result.error, stdout: store.blob(result.stdout ?? '', 'txt'), stderr: store.blob(result.stderr ?? '', 'txt') });
    return result.stdout?.trim();
  };
  const sha = run('git', ['rev-parse', 'HEAD']);
  store.json('manifest.json', { schemaVersion: 1, preparedAt: new Date().toISOString(), project, root, sha, raw: true, system: { platform: platform(), release: release(), arch: arch(), cpus: cpus(), totalmem: totalmem(), networkInterfaces: networkInterfaces(), hostname: hostname() }, node: process.versions, execPath: process.execPath, env: process.env });
  for (const path of ['apps/api/src', 'apps/api/scripts', 'apps/api/migrations', 'apps/web/src', 'scripts', 'package.json', 'package-lock.json', 'README.md', 'docs/17-xianyu-slider-solver.md', 'docker-compose.yml', 'compose.prod.yml', 'apps/api/package.json', 'apps/api/tsconfig.json', 'apps/web/package.json', 'apps/web/vite.config.ts']) {
    const source = join(project, path); if (existsSync(source)) cpSync(source, join(root, 'baseline', path), { recursive: true });
  }
  // .env is deliberately copied only into the local ignored evidence package.
  const mainProject = process.env.XIANYU_SOURCE_PROJECT ?? project;
  for (const path of ['.env', 'apps/api/.env']) if (existsSync(join(mainProject, path))) cpSync(join(mainProject, path), join(root, 'baseline', path));
  run('git', ['status', '--porcelain=v1']);
  run('git', ['diff', '--binary', 'HEAD']);
  run('git', ['bundle', 'create', join(root, 'baseline/repository.bundle'), 'HEAD']);
  run('powershell.exe', ['-NoProfile', '-Command', 'npm ls --all --json']);
  if (platform() === 'win32') {
    run('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,VideoProcessor | ConvertTo-Json; Get-TimeZone | ConvertTo-Json; Get-DnsClientServerAddress | ConvertTo-Json; netsh winhttp show proxy']);
    const chromeCandidates = [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application'), process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application'), process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application')].filter(Boolean);
    const installed = chromeCandidates.find((path) => existsSync(join(path, 'chrome.exe')));
    if (!installed) throw new Error('System Chrome installation was not found');
    store.json('chrome-installation.json', { path: installed, entries: readdirSync(installed) });
    cpSync(installed, join(root, 'baseline/chrome'), { recursive: true });
  }
  cpSync(process.execPath, join(root, 'baseline', platform() === 'win32' ? 'node.exe' : 'node'));
  store.event('preflight.ready', { root });
  console.log(JSON.stringify({ root, sha, prepared: true }));
} else if (action === 'command') {
  const recordDirFlag = args.find((arg) => arg.startsWith('--record-dir='));
  const filteredArgs = args.filter((arg) => arg !== recordDirFlag);
  const commandArgs = filteredArgs[0] === '--' ? filteredArgs.slice(1) : filteredArgs;
  const [command, ...argv] = commandArgs;
  if (!command || !label) throw new Error('command requires label and executable');
  const env = { ...process.env };
  if (existsSync(join(root, 'runtime-env.json'))) Object.assign(env, JSON.parse(readFileSync(join(root, 'runtime-env.json'), 'utf8')));
  if (recordDirFlag) env.XIANYU_RECORD_DIR = recordDirFlag.slice('--record-dir='.length);
  store.event('command.start', { label, command, argv, cwd: process.cwd(), env });
  const output = createWriteStream(join(root, `${label}.stdout.log`));
  const errorOutput = createWriteStream(join(root, `${label}.stderr.log`));
  const child = spawn(command, argv, { cwd: process.cwd(), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(output); child.stderr.pipe(errorOutput);
  store.json(`${label}.process.json`, { pid: child.pid, parentPid: process.pid, command, argv, cwd: process.cwd(), utc: new Date().toISOString() });
  child.once('error', (error) => { store.event('command.error', { label, error }); process.exitCode = 1; });
  child.once('exit', (code, signal) => { store.event('command.exit', { label, code, signal }); process.exitCode = code ?? 1; console.log(JSON.stringify({ label, code, signal, stdout: `${label}.stdout.log`, stderr: `${label}.stderr.log` })); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
} else if (action === 'seal') {
  store.event('session.seal', {});
  console.log(JSON.stringify({ root, files: await writeIntegrity(root) }));
} else throw new Error('Use prepare, command, or seal');
