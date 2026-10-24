import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { createRecordingStore } from './store.mjs';
const root = process.env.XIANYU_COPY_INPUT_DIR;
const store = createRecordingStore(root);
const bundle = await build({ entryPoints: ['scripts/slider-recording/ydisks-performance.mjs'], bundle: true, write: false, platform: 'node',
  format: 'esm', packages: 'external', plugins: [{ name: 'container-dependencies', setup(b) {
    b.onResolve({ filter: /^patchright$/ }, () => ({ path: '/app/node_modules/patchright/index.mjs', external: true }));
  } }] });
fs.writeFileSync(join(root, 'performance-browser-bundle.mjs'), bundle.outputFiles[0].text);
fs.copyFileSync('scripts/slider-recording/ydisks-linux-entry.sh', join(root, 'ydisks-linux-entry.sh'));
const label = process.env.XIANYU_COPY_RUN_LABEL ?? 'recorder-performance';
if (!/^[a-z0-9-]+$/.test(label)) throw Error('Invalid local evidence label');
const name = `xianyu-ydisks-${label}`;
const args = ['run', '--name', name, '--init', '--network', 'none', '--cpus=2', '--memory=2g', '--shm-size=1g',
  '--mount', `type=bind,source=${root},target=/copy,readonly`,
  '--mount', `type=volume,source=xianyu-ydisks-${label}-evidence,target=/evidence`,
  '--mount', `type=volume,source=xianyu-ydisks-${label}-browser,target=/browser-data`,
  '-e', `XIANYU_RECORD_DIR=/evidence/${label}`, '-e', 'XIANYU_COPY_BROWSER_ENTRY=/copy/performance-browser-bundle.mjs',
  '--entrypoint', 'bash', 'afab39a59647f7820e949e73879fa72fe6dd30e1bf0450f21f9a5211927fed9f', '/copy/ydisks-linux-entry.sh'];
store.event('command.start', { command: 'docker', args });
const run = spawnSync('docker', args, { encoding: 'utf8', timeout: 120_000, windowsHide: true });
store.event('command.exit', { code: run.status, error: run.error, stdout: store.blob(run.stdout), stderr: store.blob(run.stderr) });
console.log(run.stdout);
const copy = spawnSync('docker', ['cp', `${name}:/evidence/${label}`, join(root, label)], { encoding: 'utf8', windowsHide: true });
store.event('command.exit', { label: 'performance-export', code: copy.status, stderr: store.blob(copy.stderr) });
if (run.status || copy.status) { console.error(run.stderr); process.exitCode = run.status || copy.status || 1; }
