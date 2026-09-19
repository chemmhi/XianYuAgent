import { spawn } from 'node:child_process';

const npmCommand = process.env.npm_execpath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const children = [];
const commands = [
  ['api', ['--workspace', 'apps/api', 'run', 'dev']],
  ['worker', ['--workspace', 'apps/api', 'run', 'dev:worker']],
  ['web', ['--workspace', 'apps/web', 'run', 'dev']],
];

let shuttingDown = false;

for (const [name, args] of commands) {
  const child = spawn(npmCommand, process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on('exit', (code, signal) => {
    if (!shuttingDown && code !== 0) {
      shuttingDown = true;
      shutdown(code ?? 1, signal);
    }
  });
  children.push(child);
}

process.on('SIGINT', () => shutdown(130, 'SIGINT'));
process.on('SIGTERM', () => shutdown(143, 'SIGTERM'));

function shutdown(code, signal) {
  if (shuttingDown && code !== 130 && code !== 143 && signal !== 'SIGINT' && signal !== 'SIGTERM') return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 250);
}
