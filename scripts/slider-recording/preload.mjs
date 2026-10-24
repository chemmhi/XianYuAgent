import { channel } from 'node:diagnostics_channel';
import { format } from 'node:util';
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRecordingStore } from './store.mjs';
import { installHttpRecording, installWebSocketRecording } from './http.mjs';
import { installBrowserRecording } from './browser.mjs';

if (!process.env.XIANYU_RECORD_DIR) throw new Error('XIANYU_RECORD_DIR is required for explicit recording');
const store = createRecordingStore(process.env.XIANYU_RECORD_DIR);
// Bundled SSH diagnostics have no file-backed import.meta.url; their complete
// source is already retained as the exact SSH stdin artifact.
if (import.meta.url?.startsWith('file:') && existsSync(fileURLToPath(import.meta.url))) cpSync(dirname(fileURLToPath(import.meta.url)), join(store.root, `recorder-source-${process.pid}`), { recursive: true });
store.json(`process-${process.pid}.json`, { utc: new Date().toISOString(), argv: process.argv, execArgv: process.execArgv, execPath: process.execPath, cwd: process.cwd(), versions: process.versions, env: process.env });
store.event('process.start', { argv: process.argv, cwd: process.cwd() });
for (const name of ['log', 'info', 'warn', 'error', 'debug']) {
  const original = console[name].bind(console);
  console[name] = (...args) => { store.event('console', { level: name, text: format(...args) }); original(...args); };
}
const drain = installHttpRecording(store);
await installWebSocketRecording(store);
await installBrowserRecording(store);
const random = Math.random;
Math.random = () => {
  const value = random();
  const stack = new Error().stack;
  if (/xianyu-slider-(trajectory|solver)/u.test(stack)) store.event('slider.random', { value, stack });
  return value;
};
channel('undici:client:sendHeaders').subscribe(({ request, headers }) => store.event('fetch.wire.headers', { origin: String(request.origin), method: request.method, path: request.path, headers }));
channel('undici:client:connected').subscribe(({ connectParams, socket }) => store.event('fetch.connection', { connectParams, localAddress: socket.localAddress, localPort: socket.localPort, remoteAddress: socket.remoteAddress, remotePort: socket.remotePort, protocol: socket.getProtocol?.(), cipher: socket.getCipher?.(), certificate: socket.getPeerCertificate?.() }));
process.on('uncaughtExceptionMonitor', (error) => store.event('process.uncaughtException', { error }));
process.on('beforeExit', () => void drain());
process.on('exit', (code) => store.event('process.exit', { code }));

export { store };
