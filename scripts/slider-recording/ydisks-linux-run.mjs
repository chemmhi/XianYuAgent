import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { build } from 'esbuild';
import { createRecordingStore } from './store.mjs';
import { buildYdisksPlan } from './ydisks-gesture.mjs';

const root = resolve(process.env.XIANYU_COPY_INPUT_DIR);
if (!root.endsWith('20261024-ydisks-local')) throw Error('Dedicated evidence root required');
const store = createRecordingStore(root);
const label = process.env.XIANYU_COPY_RUN_LABEL ?? 'linux-aligned';
if (!/^[a-z0-9-]+$/.test(label)) throw Error('Invalid run label');
const image = 'afab39a59647f7820e949e73879fa72fe6dd30e1bf0450f21f9a5211927fed9f';
const bridge = join(root, 'plan-bridge');
fs.mkdirSync(bridge, { recursive: true });
const claimed = new Set(fs.readdirSync(bridge).filter(n => n.endsWith('.request.json')));
const plannerTasks = new Set();
const poll = setInterval(() => {
  for (const name of fs.readdirSync(bridge).filter(n => n.endsWith('.request.json') && !claimed.has(n))) {
    let request;
    try { request = JSON.parse(fs.readFileSync(join(bridge, name), 'utf8')); }
    catch (error) { store.event('planner.bridge.read.retry', { name, error: String(error) }); continue; }
    claimed.add(name);
    const task = (async () => {
      store.event('planner.bridge.input', request);
      let response;
      try { response = { plan: await buildYdisksPlan(join(root, 'upstream'), request.geometry, request.seed, request.scratch) }; }
      catch (error) { response = { error: String(error) }; }
      const out = join(bridge, name.replace('.request.json', '.response.json'));
      fs.writeFileSync(out + '.tmp', JSON.stringify(response));
      fs.renameSync(out + '.tmp', out);
      store.event('planner.bridge.output', { request: name, output: out });
    })();
    plannerTasks.add(task);
    task.finally(() => plannerTasks.delete(task));
  }
}, 100);
async function command(command, args, name, allowFailure = false) {
  store.event('command.start', { label: name, command, args, env: process.env, cwd: process.cwd() });
  const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  store.json(`${name}.process.json`, { pid: child.pid, command, args, utc: new Date().toISOString() });
  child.stdout.pipe(fs.createWriteStream(join(root, `${name}.stdout.log`)));
  child.stderr.pipe(fs.createWriteStream(join(root, `${name}.stderr.log`)));
  const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept); });
  store.event('command.exit', { label: name, code });
  console.log(JSON.stringify({ label: name, code }));
  if (code !== 0 && !allowFailure) throw Error(`${name} exited ${code}; inspect stderr`);
}
let tunnel;
try {
  const plugin = { name: 'container-dependencies', setup(b) {
    b.onResolve({ filter: /^patchright$/ }, () => ({ path: '/app/node_modules/patchright/index.mjs', external: true }));
    b.onResolve({ filter: /^ws$/ }, () => ({ path: '/app/node_modules/ws/wrapper.mjs', external: true }));
  } };
  for (const [source, destination] of [['ydisks-preflight.mjs', 'preflight-linux-bundle.mjs'], ['ydisks-probe.mjs', 'ydisks-linux-bundle.mjs'],
    ['ydisks-restore-scope.mjs', 'restore-scope-bundle.mjs']]) {
    const result = await build({ entryPoints: [`scripts/slider-recording/${source}`], bundle: true, write: false, platform: 'node',
      format: 'esm', target: 'node24', packages: 'external', plugins: [plugin] });
    fs.writeFileSync(join(root, destination), result.outputFiles[0].text);
  }
  fs.copyFileSync('scripts/slider-recording/ydisks-linux-entry.sh', join(root, 'ydisks-linux-entry.sh'));
  fs.copyFileSync('scripts/slider-recording/ydisks-seed-profile.mjs', join(root, 'ydisks-seed-profile.mjs'));
  const sshArgs = ['-o', 'BatchMode=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30', '-N', '-D', '127.0.0.1:59439', 'tencent-server'];
  tunnel = spawn('ssh', sshArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  store.json(`${label}-tunnel.process.json`, { pid: tunnel.pid, argv: sshArgs });
  tunnel.stdout.pipe(fs.createWriteStream(join(root, `${label}-tunnel.stdout.log`)));
  tunnel.stderr.pipe(fs.createWriteStream(join(root, `${label}-tunnel.stderr.log`)));
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (tunnel.exitCode !== null) throw Error('SSH forward exited');
    ready = await new Promise(accept => { const socket = connect(59439, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); accept(true); }); socket.once('error', () => accept(false)); });
    if (ready) break;
    await new Promise(accept => setTimeout(accept, 250));
  }
  if (!ready) throw Error('SSH forward unavailable');
  const verifyOnly = process.env.XIANYU_COPY_VERIFY_ONLY === 'true';
  const postcheckInput = process.env.XIANYU_COPY_POSTCHECK_INPUT ?? 'restored-after-challenge-input.json';
  if (!/^[a-z0-9-]+\.json$/.test(postcheckInput)) throw Error('Invalid local postcheck input label');
  const old = JSON.parse(fs.readFileSync(join(root, verifyOnly ? postcheckInput : 'original-complete-input.json'), 'utf8'));
  fs.writeFileSync(join(root, 'preflight-input.json'), JSON.stringify({ ...old, label }, null, 2));
  const live = join(root, 'latest-challenge-input.json');
  if (fs.existsSync(live)) fs.renameSync(live, join(root, `${label}-prior-input.json`));
  const common = ['--init', '--cpus=2', '--memory=2g', '--shm-size=1g', '--mount', `type=bind,source=${root},target=/evidence`,
    '-e', 'XIANYU_COPY_INPUT_DIR=/evidence', '-e', 'XIANYU_COPY_PROXY=socks5://host.docker.internal:59439',
    '-e', `XIANYU_BROWSER_USER_AGENT=${process.env.XIANYU_BROWSER_USER_AGENT ?? 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.79 Safari/537.36'}`,
    ...(process.env.XIANYU_COPY_IDENTITY_HEADERS ? ['-e', 'XIANYU_COPY_IDENTITY_HEADERS=/evidence/pass-browser-request-headers.json'] : [])];
  const copied = process.env.XIANYU_COPY_SEED_PROFILE === 'true';
  const volumeMount = `type=volume,source=xianyu-ydisks-${label}-browser,target=/browser-data`;
  if (copied) {
    const profileArchive = resolve('../XianYuAgent/artifacts/slider-recording/20261023-production-copy-local/production-profile-archive.stdout.log');
    await command('docker', ['run', '--name', `xianyu-ydisks-${label}-seed`, '--init',
      '--mount', `type=bind,source=${root},target=/evidence`, '--mount', volumeMount,
      '--mount', `type=bind,source=${profileArchive},target=/source-profile.tar.gz,readonly`,
      '--entrypoint', 'node', image, '/evidence/ydisks-seed-profile.mjs'], `${label}-seed-profile`);
  }
  await command('docker', ['run', '--name', `xianyu-ydisks-${label}-preflight`, ...common, '-e', `XIANYU_RECORD_DIR=/evidence/${label}-preflight`,
    '--entrypoint', 'node', image, '/evidence/preflight-linux-bundle.mjs'], `${label}-preflight`);
  if (verifyOnly) {
    const login = JSON.parse(fs.readFileSync(join(root, `${label}-preflight/verifyLogin.json`), 'utf8'));
    const token = JSON.parse(fs.readFileSync(join(root, `${label}-preflight/fetchImToken.json`), 'utf8'));
    store.json(`${label}-run-result.json`, { reason: 'post_challenge_account_check', loginSuccess: login.success,
      tokenSuccess: token.success, hasToken: Boolean(token.accessToken), errorCode: token.errorCode, manual: false });
  } else if (!fs.existsSync(live)) {
    store.json(`${label}-run-result.json`, { success: false, reason: 'no_challenge_received', manual: false });
  } else {
    if (process.env.XIANYU_COPY_PRESERVE_SCOPE === 'true') await command(process.execPath,
      [join(root, 'restore-scope-bundle.mjs'), `${label}-preflight`], `${label}-restore-scope`);
    // Browser recording is synchronous. Keep its hot path on Docker's ext4
    // volume; Windows bind mounts add tens of milliseconds to every event.
    const browserCommon = common.map(value => value === `type=bind,source=${root},target=/evidence`
      ? `type=bind,source=${root},target=/copy` : value === 'XIANYU_COPY_INPUT_DIR=/evidence' ? 'XIANYU_COPY_INPUT_DIR=/copy' : value);
    const container = `xianyu-ydisks-${label}-challenge`;
    await command('docker', ['run', '--name', container, ...browserCommon,
      '--mount', `type=volume,source=xianyu-ydisks-${label}-evidence,target=/evidence`,
      '--mount', volumeMount,
      '-e', `XIANYU_RECORD_DIR=/evidence/${label}-challenge`, '-e', `XIANYU_COPY_PROFILE=${copied ? '/browser-data/copied/1d274de5-38b8-4c9b-83ed-d8ba803685ac' : '/browser-data/slider_1903703477'}`,
      '-e', 'XIANYU_COPY_PLAN_BRIDGE=/copy/plan-bridge', '-e', `XIANYU_COPY_NATIVE_IDENTITY=${process.env.XIANYU_COPY_NATIVE_IDENTITY ?? 'true'}`,
      '-e', `XIANYU_COPY_RENDERER=${process.env.XIANYU_COPY_RENDERER ?? ''}`,
      '-e', `XIANYU_COPY_MAX_ATTEMPTS=${process.env.XIANYU_COPY_MAX_ATTEMPTS ?? '1'}`,
      '-e', `XIANYU_COPY_CHECK_ACCOUNT=${process.env.XIANYU_COPY_CHECK_ACCOUNT ?? 'false'}`,
      '--entrypoint', 'bash', image, '/copy/ydisks-linux-entry.sh'], `${label}-challenge`, true);
    await command('docker', ['cp', `${container}:/evidence/${label}-challenge`, join(root, `${label}-challenge`)], `${label}-export-recording`);
    const result = JSON.parse(fs.readFileSync(join(root, `${label}-challenge/result.json`), 'utf8'));
    store.json(`${label}-run-result.json`, result);
    if (result.success) {
      fs.copyFileSync(join(root, `${label}-challenge/passed-credential.json`), join(root, 'preflight-input.json'));
      await command('docker', ['run', '--name', `xianyu-ydisks-${label}-postcheck`, ...common,
        '-e', `XIANYU_RECORD_DIR=/evidence/${label}-postcheck`, '--entrypoint', 'node', image,
        '/evidence/preflight-linux-bundle.mjs'], `${label}-postcheck`);
    }
  }
} finally {
  clearInterval(poll);
  await Promise.allSettled([...plannerTasks]);
  if (tunnel) {
    tunnel.kill();
    await new Promise(accept => tunnel.exitCode !== null ? accept() : tunnel.once('close', accept));
    store.event('ssh.forward.closed', { pid: tunnel.pid, exitCode: tunnel.exitCode });
  }
}
