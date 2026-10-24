import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { build } from 'esbuild';
import { createRecordingStore } from './store.mjs';
import { buildYdisksPlan } from './ydisks-gesture.mjs';
const root = resolve(process.env.XIANYU_COPY_INPUT_DIR);
if (!root.endsWith('20261024-ydisks-local')) throw Error('Dedicated evidence root required');
const store = createRecordingStore(root), label = process.env.XIANYU_COPY_RUN_LABEL ?? 'native-browser-account-check';
if (!/^[a-z0-9-]+$/.test(label)) throw Error('Invalid run label');
const bridge = join(root, 'plan-bridge');
fs.mkdirSync(bridge, { recursive: true });
const claimed = new Set(fs.readdirSync(bridge)), plannerTasks = new Set();
const poll = setInterval(() => {
  for (const name of fs.readdirSync(bridge).filter(n => n.endsWith('.request.json') && !claimed.has(n))) {
    let data;
    try { data = JSON.parse(fs.readFileSync(join(bridge, name), 'utf8')); } catch { continue; }
    claimed.add(name);
    const task = (async () => {
      store.event('planner.bridge.input', data);
      let response;
      try { response = { plan: await buildYdisksPlan(join(root, 'upstream'), data.geometry, data.seed, data.scratch) }; }
      catch (error) { response = { error: String(error) }; }
      const out = join(bridge, name.replace('.request.json', '.response.json'));
      fs.writeFileSync(out + '.tmp', JSON.stringify(response)); fs.renameSync(out + '.tmp', out);
    })();
    plannerTasks.add(task); task.finally(() => plannerTasks.delete(task));
  }
}, 100);
const result = await build({ entryPoints: ['scripts/slider-recording/ydisks-browser-account-check.mjs'], bundle: true, write: false,
  platform: 'node', format: 'esm', target: 'node24', packages: 'external', plugins: [{ name: 'container-dependencies', setup(b) {
    b.onResolve({ filter: /^patchright$/ }, () => ({ path: '/app/node_modules/patchright/index.mjs', external: true }));
    b.onResolve({ filter: /^ws$/ }, () => ({ path: '/app/node_modules/ws/wrapper.mjs', external: true }));
  } }] });
fs.writeFileSync(join(root, 'browser-account-check-bundle.mjs'), result.outputFiles[0].text);
fs.copyFileSync('scripts/slider-recording/ydisks-linux-entry.sh', join(root, 'ydisks-linux-entry.sh'));
async function command(args, name) {
  store.event('command.start', { command: 'docker', args, label: name, env: process.env });
  const child = spawn('docker', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  store.json(`${name}.process.json`, { pid: child.pid, args });
  child.stdout.pipe(fs.createWriteStream(join(root, `${name}.stdout.log`)));
  child.stderr.pipe(fs.createWriteStream(join(root, `${name}.stderr.log`)));
  const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept); });
  store.event('command.exit', { label: name, code });
  console.log(JSON.stringify({ label: name, code }));
  return code;
}
let tunnel;
try {
  const sshArgs = ['-o', 'BatchMode=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ExitOnForwardFailure=yes', '-N', '-D', '127.0.0.1:59439', 'tencent-server'];
  tunnel = spawn('ssh', sshArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  store.json(`${label}-tunnel.process.json`, { pid: tunnel.pid, args: sshArgs });
  tunnel.stdout.pipe(fs.createWriteStream(join(root, `${label}-tunnel.stdout.log`)));
  tunnel.stderr.pipe(fs.createWriteStream(join(root, `${label}-tunnel.stderr.log`)));
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (tunnel.exitCode !== null) throw Error('Task SSH forward exited');
    ready = await new Promise(accept => { const s = connect(59439, '127.0.0.1'); s.once('connect', () => { s.destroy(); accept(true); }); s.once('error', () => accept(false)); });
    if (ready) break;
    await new Promise(accept => setTimeout(accept, 250));
  }
  if (!ready) throw Error('Task SSH forward unavailable');
  const container = `xianyu-ydisks-${label}`;
  const code = await command(['run', '--name', container, '--init', '--cpus=2', '--memory=2g', '--shm-size=1g',
    '--mount', `type=bind,source=${root},target=/copy`, '--mount', `type=volume,source=xianyu-ydisks-${process.env.XIANYU_COPY_PASS_CASE ?? 'linux-scope-retry'}-browser,target=/browser-data`,
    '--mount', `type=volume,source=xianyu-ydisks-${label}-evidence,target=/evidence`,
    '-e', 'XIANYU_COPY_INPUT_DIR=/copy', '-e', `XIANYU_RECORD_DIR=/evidence/${label}`,
    '-e', 'XIANYU_COPY_PROXY=socks5://host.docker.internal:59439', '-e', 'XIANYU_COPY_BROWSER_ENTRY=/copy/browser-account-check-bundle.mjs',
    '-e', `XIANYU_COPY_PASS_CASE=${process.env.XIANYU_COPY_PASS_CASE ?? 'linux-scope-retry'}`, '-e', 'XIANYU_COPY_USE_SHARED_CHECK=true',
    '-e', 'XIANYU_COPY_PLAN_BRIDGE=/copy/plan-bridge', '-e', `XIANYU_COPY_NATIVE_RECOVERY=${process.env.XIANYU_COPY_NATIVE_RECOVERY ?? 'false'}`,
    '-e', `XIANYU_COPY_REUSE_PROFILE_ONLY=${process.env.XIANYU_COPY_REUSE_PROFILE_ONLY ?? 'false'}`,
    '-e', 'XIANYU_BROWSER_USER_AGENT=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
    '--entrypoint', 'bash', 'afab39a59647f7820e949e73879fa72fe6dd30e1bf0450f21f9a5211927fed9f', '/copy/ydisks-linux-entry.sh'], label);
  await command(['cp', `${container}:/evidence/${label}`, join(root, label)], `${label}-export`);
  if (code !== 0) process.exitCode = code;
} finally {
  clearInterval(poll); await Promise.allSettled([...plannerTasks]);
  if (tunnel) { tunnel.kill(); await new Promise(accept => tunnel.exitCode !== null ? accept() : tunnel.once('close', accept));
    store.event('ssh.forward.closed', { pid: tunnel.pid, exitCode: tunnel.exitCode }); }
}
