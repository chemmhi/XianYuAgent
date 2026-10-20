import fs from 'node:fs';
import { removePidFile, spawnNpmScript, stopManagedRunner, terminateProcessTree, writePidFile } from './dev-lifecycle.mjs';
import { createDevEnvironment, resolveDevPorts } from './dev-ports.mjs';

const childScripts = ['dev:api', 'dev:worker', 'dev:web'];
const children = [];
let stopping = false;

async function stopChildren() {
  await Promise.allSettled(
    children
      .filter((child) => child.pid)
      .map((child) => terminateProcessTree(child.pid)),
  );
}

async function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;
  await stopChildren();
  removePidFile();
  process.exitCode = exitCode;
}

process.on('SIGINT', () => void shutdown(130));
process.on('SIGTERM', () => void shutdown(143));
process.on('SIGHUP', () => void shutdown(129));
process.on('exit', () => {
  try {
    fs.rmSync(new URL('../.xianyu-dev.pid', import.meta.url), { force: true });
  } catch {
    // Best effort cleanup only.
  }
});

await stopManagedRunner({ quiet: true });
let ports;
try {
  const envFile = new URL('../.env', import.meta.url);
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  ports = await resolveDevPorts();
} catch (error) {
  console.error(`[dev] ${error.message}`);
  process.exitCode = 1;
  process.exit();
}
writePidFile();
const env = createDevEnvironment(ports);
console.log(`[dev] API: http://127.0.0.1:${ports.apiPort}`);
console.log(`[dev] Web: http://127.0.0.1:${ports.webPort}`);

for (const scriptName of childScripts) {
  const child = spawnNpmScript(scriptName, { env });
  children.push(child);
  child.once('error', () => {
    void shutdown(1);
  });
  child.once('exit', (code, signal) => {
    if (!stopping) {
      const failureCode = typeof code === 'number' && code !== 0 ? code : 1;
      console.error(`[dev] ${scriptName} exited (${signal ?? `code ${code}`}); stopping remaining processes.`);
      void shutdown(failureCode);
    }
  });
}

await new Promise(() => {});
