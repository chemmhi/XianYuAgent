import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

// A single archive avoids tens of thousands of writes across a Docker bind
// mount. tar preserves the copied Linux profile's symlinks and file metadata.
export function createTarProfileSnapshot(store) {
  return async (profile, destination) => {
    const archive = `${destination}.tar.gz`;
    const argv = ['-C', profile, '-czf', archive, '.'];
    store.event('profile.archive.start', { profile, archive, command: 'tar', argv });
    try {
      const result = await run('tar', argv, { windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
      store.event('profile.archive.complete', { profile, archive, bytes: (await stat(archive)).size, ...result });
    } catch (error) {
      store.event('profile.archive.error', { profile, archive, error, stderr: error.stderr });
      throw error;
    }
  };
}
