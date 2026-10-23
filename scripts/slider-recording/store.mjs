import { appendFileSync, mkdirSync, writeFileSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export function createRecordingStore(root) {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'blobs'), { recursive: true });
  const started = performance.now();
  let sequence = 0;
  const file = join(root, `events-${process.pid}.ndjson`);
  function event(type, data = {}) {
    const value = { utc: new Date().toISOString(), elapsedMs: performance.now() - started, pid: process.pid, sequence: ++sequence, type, data };
    appendFileSync(file, `${JSON.stringify(value, (_key, item) => item instanceof Error ? { name: item.name, message: item.message, stack: item.stack } : typeof item === 'bigint' ? item.toString() : item)}\n`);
    return value;
  }
  function blob(value, extension = 'bin') {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value ?? '');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const path = `blobs/${sha256}.${extension}`;
    writeFileSync(join(root, path), bytes);
    return { path, bytes: bytes.length, sha256 };
  }
  function json(name, value) {
    const content = `${JSON.stringify(value, null, 2)}\n`;
    const original = blob(content, 'json');
    event('artifact.json', { name, body: original });
    writeFileSync(join(root, name), content);
    return name;
  }
  return { root, event, blob, json, id: () => `${process.pid}-${randomUUID()}` };
}

export async function writeIntegrity(root) {
  const entries = [];
  async function walk(dir) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) await walk(path);
      else if (relative(root, path) !== 'integrity.json') {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(path)) hash.update(chunk);
        entries.push({ path: relative(root, path).replaceAll('\\', '/'), bytes: statSync(path).size, sha256: hash.digest('hex') });
      }
    }
  }
  await walk(root);
  writeFileSync(join(root, 'integrity.json'), JSON.stringify({ createdAt: new Date().toISOString(), files: entries }, null, 2));
  return entries.length;
}
