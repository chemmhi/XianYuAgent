import fs from 'node:fs';
import { assertPortFree, removePidFile, spawnNpmScript, stopManagedRunner, terminateProcessTree, writePidFile } from './dev-lifecycle.mjs';

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
try {
  await Promise.all([assertPortFree(8080), assertPortFree(5173)]);
} catch (error) {
  console.error(`[dev] ${error.message}`);
  process.exitCode = 1;
  process.exit();
}
writePidFile();

for (const scriptName of childScripts) {
  const child = spawnNpmScript(scriptName);
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
