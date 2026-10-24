import { readFileSync, createWriteStream } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRecordingStore } from './store.mjs';

const [rootArg, label, scriptArg] = process.argv.slice(2);
if (!rootArg || !label || !scriptArg) throw new Error('Usage: remote.mjs runDir label localScript.sh');
const root = resolve(rootArg);
const store = createRecordingStore(root);
// Parse the complete compound command before any docker exec can inherit stdin.
const script = Buffer.from(`{\n${readFileSync(resolve(scriptArg), 'utf8')}\n}\n`);
const args = ['-o', 'BatchMode=yes', '-o', 'PreferredAuthentications=publickey', '-o', 'StrictHostKeyChecking=yes', 'tencent-server', 'bash -s'];
store.event('ssh.start', { label, host: 'tencent-server', args, script: store.blob(script, 'sh') });
const child = spawn('ssh', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
child.stdout.pipe(createWriteStream(join(root, `${label}.stdout.log`)));
child.stderr.pipe(createWriteStream(join(root, `${label}.stderr.log`)));
child.stdin.end(script);
child.once('error', (error) => { store.event('ssh.error', { label, error }); process.exitCode = 1; });
child.once('exit', (code, signal) => { store.event('ssh.exit', { label, code, signal }); process.exitCode = code ?? 1; console.log(JSON.stringify({ label, code, signal })); });
