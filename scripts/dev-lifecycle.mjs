import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const pidFilePath = path.join(projectRoot, '.xianyu-dev.pid');
const repositoryMarker = path.basename(projectRoot).split('-')[0];

function runCommand(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true }, (error, stdout = '', stderr = '') => {
      resolve({
        ok: !error,
        stdout: String(stdout),
        stderr: String(stderr),
        error,
      });
    });
  });
}

export function readPidFile() {
  try {
    const raw = fs.readFileSync(pidFilePath, 'utf8').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function removePidFile() {
  try {
    fs.rmSync(pidFilePath, { force: true });
  } catch {
    // Best effort cleanup only.
  }
}

export function writePidFile() {
  fs.writeFileSync(
    pidFilePath,
    `${JSON.stringify({ pid: process.pid, root: projectRoot, startedAt: new Date().toISOString() })}\n`,
    'utf8',
  );
}

async function getProcessCommandLine(pid) {
  if (process.platform === 'win32') {
    const result = await runCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$p = Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\"; if ($p) { $p.CommandLine }`,
    ]);
    return result.stdout.trim();
  }

  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim();
  } catch {
    return '';
  }
}

async function discoverProjectDevProcesses() {
  if (process.platform !== 'win32') return [];

  const script = `$marker = '${repositoryMarker}'; $pattern = 'dev:api|dev:worker|dev:web|concurrently|vite\\\\bin\\\\vite|tsx\\\\dist\\\\cli\\\\.mjs.*watch|npm-cli\\\\.js.*run dev:(api|worker|web)|npm-cli\\\\.js.*--workspace.*run dev(:worker)?'; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($marker) -and $_.CommandLine -match $pattern } | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress`;
  const result = await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  if (!result.stdout.trim()) return [];
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

export async function stopDiscoveredDevProcesses() {
  const processes = await discoverProjectDevProcesses();
  const currentPid = process.pid;
  const pids = [...new Set(processes.map((entry) => Number(entry.ProcessId)).filter((pid) => pid > 0 && pid !== currentPid))];
  await Promise.all(pids.map((pid) => terminateProcessTree(pid)));
  return pids;
}

export async function isManagedRunner(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  const commandLine = await getProcessCommandLine(pid);
  return commandLine.includes('dev-runner.mjs') && commandLine.includes(projectRoot);
}

export function terminateProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return Promise.resolve();

  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    });
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // The process already exited.
    }
  }
  return Promise.resolve();
}

export async function stopManagedRunner({ quiet = false } = {}) {
  const discoveredPids = await stopDiscoveredDevProcesses();
  const record = readPidFile();
  if (!record) {
    removePidFile();
    if (!quiet) console.log(discoveredPids.length ? `Stopped ${discoveredPids.length} stale local dev process(es).` : 'No active local dev runner found.');
    return { stopped: discoveredPids.length > 0, reason: 'missing-pid-file', discoveredPids };
  }

  if (!(await isManagedRunner(record.pid))) {
    removePidFile();
    if (!quiet) console.log(discoveredPids.length ? `Stopped ${discoveredPids.length} stale local dev process(es).` : 'Removed stale local dev runner state.');
    return { stopped: discoveredPids.length > 0, reason: 'stale-pid-file', discoveredPids };
  }

  await terminateProcessTree(record.pid);
  removePidFile();
  if (!quiet) console.log(`Stopped local dev runner (pid ${record.pid})${discoveredPids.length ? ` and ${discoveredPids.length} stale process(es)` : ''}.`);
  return { stopped: true, pid: record.pid, discoveredPids };
}

export function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) => {
      server.close();
      reject(new Error(`Port ${port} is already in use. Stop the owning process or run npm run dev:stop.`));
    });
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => resolve());
    });
  });
}

export function spawnNpmScript(scriptName) {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = npmExecPath ? [npmExecPath, 'run', scriptName] : ['run', scriptName];
  return spawn(command, args, {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: 'inherit',
    windowsHide: false,
    detached: process.platform !== 'win32',
  });
}
