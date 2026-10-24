import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { createRecordingStore } from './store.mjs';

const root = resolve(process.env.XIANYU_COPY_INPUT_DIR);
if (!root.endsWith('20261024-ydisks-local')) throw Error('Dedicated evidence directory required');
const store = createRecordingStore(root);
const nativeMode = process.env.XIANYU_COPY_NATIVE_IDENTITY === 'true';
const prefix = process.env.XIANYU_COPY_RUN_LABEL ?? (nativeMode ? 'native-identity' : 'upstream-default');
if (!/^[a-z0-9-]+$/.test(prefix)) throw Error('Invalid run label');
const sourceRoot = resolve('../XianYuAgent/artifacts/slider-recording/20261024-normal-challenge-local');
const sourceInput = process.env.XIANYU_COPY_SOURCE_INPUT ?? join(sourceRoot, 'clean-preflight-input.json');
const oldInput = JSON.parse(fs.readFileSync(sourceInput, 'utf8'));
const production = JSON.parse(fs.readFileSync(join(root, 'production-before.json'), 'utf8'));
store.json(`${prefix}-runtime.json`, { versions: process.versions, execPath: process.execPath, argv: process.argv, env: process.env, cwd: process.cwd(),
  upstreamCommit: '2490eb849738539e5dc1c07444084f4b54b03287',
  sourceInput, previousInputSha256: createHash('sha256').update(fs.readFileSync(sourceInput)).digest('hex') });
fs.copyFileSync(sourceInput, join(root, `${prefix}-source-input.json`));
const bundle = await build({ entryPoints: ['scripts/slider-recording/ydisks-preflight.mjs'], bundle: true, platform: 'node', format: 'esm',
  target: 'node24', packages: 'external', write: false });
fs.writeFileSync(join(root, 'preflight-bundle.mjs'), bundle.outputFiles[0].text);
const env = { ...process.env, XIANYU_COPY_INPUT_DIR: root, XIANYU_COPY_PROXY: 'socks5://127.0.0.1:59439',
  XIANYU_BROWSER_USER_AGENT: process.env.XIANYU_BROWSER_USER_AGENT ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36' };
async function run(label, args, extra = {}) {
  const childEnv = { ...env, XIANYU_RECORD_DIR: join(root, label), ...extra };
  store.event('command.start', { label, command: process.execPath, argv: args, env: childEnv, cwd: process.cwd() });
  const child = spawn(process.execPath, args, { env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  store.json(`${label}.process.json`, { pid: child.pid, argv: args, utc: new Date().toISOString() });
  child.stdout.pipe(fs.createWriteStream(join(root, `${label}.stdout.log`)));
  child.stderr.pipe(fs.createWriteStream(join(root, `${label}.stderr.log`)));
  const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept); });
  store.event('command.exit', { label, code });
  console.log(JSON.stringify({ label, code }));
  if (code !== 0) throw Error(`${label} exited ${code}; inspect the recorded stderr`);
}
function setInput(input) { fs.writeFileSync(join(root, 'preflight-input.json'), JSON.stringify(input, null, 2)); }
let tunnel;
try {
  const sshArgs = ['-o', 'BatchMode=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30', '-N', '-D', '127.0.0.1:59439', 'tencent-server'];
  store.event('ssh.forward.start', { argv: sshArgs, businessWrites: false });
  tunnel = spawn('ssh', sshArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  tunnel.stdout.pipe(fs.createWriteStream(join(root, `${prefix}-tunnel.stdout.log`)));
  tunnel.stderr.pipe(fs.createWriteStream(join(root, `${prefix}-tunnel.stderr.log`)));
  store.json(`${prefix}-tunnel.process.json`, { pid: tunnel.pid, argv: sshArgs });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (tunnel.exitCode !== null) throw Error('SSH forward exited before becoming ready');
    ready = await new Promise(accept => { const socket = connect(59439, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); accept(true); }); socket.once('error', () => accept(false)); });
    if (ready) break;
    await new Promise(accept => setTimeout(accept, 250));
  }
  if (!ready) throw Error('SSH forwarding socket not ready');
  if (prefix === 'upstream-default') {
    const c = production.credential;
    setInput({ ...oldInput, label: 'current-production-copy', credential: { cookieHeader: c.cookie_header, metadata: c.metadata_json }, deviceId: c.device_id ?? oldInput.deviceId });
    await run('current-production-preflight', [join(root, 'preflight-bundle.mjs')]);
  }
  setInput({ ...oldInput, label: 'pre-manual-complete-copy' });
  const livePath = join(root, 'latest-challenge-input.json');
  if (fs.existsSync(livePath)) fs.renameSync(livePath, join(root, `${prefix}-previous-input.json`));
  await run(`${prefix}-preflight`, [join(root, 'preflight-bundle.mjs')]);
  if (!fs.existsSync(join(root, 'latest-challenge-input.json'))) {
    store.json(`${prefix}-run-result.json`, { success: false, reason: 'no_challenge_received', manual: false });
  } else {
    await run(`${prefix}-challenge`, ['scripts/slider-recording/ydisks-probe.mjs'], {
      XIANYU_COPY_PROFILE: join(root, `browser_data/${prefix}/slider_1903703477`), XIANYU_COPY_SEED: nativeMode ? '20261025' : '20261024',
    });
    const result = JSON.parse(fs.readFileSync(join(root, `${prefix}-challenge/result.json`), 'utf8'));
    store.json(`${prefix}-run-result.json`, result);
    if (result.success) {
      setInput(JSON.parse(fs.readFileSync(join(root, `${prefix}-challenge/passed-credential.json`), 'utf8')));
      await run('post-challenge-account-check', [join(root, 'preflight-bundle.mjs')]);
    }
  }
} finally {
  if (tunnel) {
    tunnel.kill();
    await new Promise(accept => tunnel.exitCode !== null ? accept() : tunnel.once('close', accept));
    store.event('ssh.forward.closed', { pid: tunnel.pid, exitCode: tunnel.exitCode });
  }
}
