import { mkdir, readdir, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const LOCK_STALE_MS = 30_000;

/**
 * Keep the shared god-view flag enabled until the last monitor releases it.
 * Each monitor owns one marker in a sidecar directory; the marker is removed
 * independently so a one-shot monitor cannot disable a long-running monitor.
 */
export async function acquireMonitorFlag(flagPath, options = {}) {
  const resolvedFlagPath = resolve(flagPath);
  const ownerDir = `${resolvedFlagPath}.owners`;
  const ownerToken = options.ownerToken ?? `${process.pid}-${randomUUID()}`;
  const ownerPath = resolve(ownerDir, ownerToken);
  await mkdir(dirname(resolvedFlagPath), { recursive: true });
  await mkdir(ownerDir, { recursive: true });
  await withLeaseLock(ownerDir, async () => {
    await writeFile(ownerPath, `${process.pid}\n`, { encoding: 'utf8', flag: 'wx' });
    await writeFile(resolvedFlagPath, '', 'utf8');
  });

  let released = false;
  return {
    flagPath: resolvedFlagPath,
    ownerPath,
    async release() {
      if (released) return;
      released = true;
      await withLeaseLock(ownerDir, async () => {
        await unlink(ownerPath).catch(() => {});
        if (options.keepFlag) return;
        const owners = await readdir(ownerDir).catch(() => []);
        if (owners.length > 0) return;
        await unlink(resolvedFlagPath).catch(() => {});
        await rmdir(ownerDir).catch(() => {});
      });
    },
  };
}

async function withLeaseLock(ownerDir, callback) {
  const lockPath = `${ownerDir}.lock`;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const lock = await stat(lockPath);
        if (Date.now() - lock.mtimeMs > LOCK_STALE_MS) {
          await rmdir(lockPath).catch(() => {});
          continue;
        }
      } catch {
        continue;
      }
      await delay(10);
    }
    if (attempt === 599) throw new Error('AUTO_REPLY_MONITOR_FLAG_LOCK_TIMEOUT');
  }
  try {
    return await callback();
  } finally {
    await rmdir(lockPath).catch(() => {});
  }
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
