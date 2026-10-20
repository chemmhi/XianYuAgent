import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pidFilePath,
  projectRoot,
  readPidFile,
  removePidFile,
  writePidFile,
} from './dev-lifecycle.mjs';

test('runner pid state round-trips and cleans up', () => {
  removePidFile();
  writePidFile();
  const record = readPidFile();
  assert.equal(record?.pid, process.pid);
  assert.equal(record?.root, projectRoot);
  removePidFile();
  assert.equal(readPidFile(), null);
});

test.after(() => removePidFile());

assert.ok(pidFilePath.endsWith('.xianyu-dev.pid'));
