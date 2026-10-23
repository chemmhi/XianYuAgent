import { existsSync, readFileSync, writeFileSync, cpSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRecordingStore } from './store.mjs';

const root = resolve(process.argv[2]);
const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = join(root, 'baseline/.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const profileSource = process.env.XIANYU_VERIFICATION_BROWSER_USER_DATA_DIR || join(tmpdir(), 'xianyu-agent/browser_data/xianyu-verification');
const profileRoot = join(root, 'local-profiles');
if (existsSync(profileRoot)) throw new Error('Runtime profiles already exist; do not overwrite a previous run');
mkdirSync(profileRoot, { recursive: true });
if (existsSync(profileSource)) cpSync(profileSource, profileRoot, { recursive: true });
const overrides = {
  NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '8080', VITE_PORT: '5173',
  DATABASE_URL: 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent', REDIS_URL: 'redis://127.0.0.1:6379', ALLOW_IN_MEMORY: 'false', COOKIE_SECURE: 'false',
  XIANYU_QR_MODE: 'real', XIANYU_VERIFICATION_BROWSER_MODE: 'launch', XIANYU_VERIFICATION_SLIDER_MODE: 'auto', XIANYU_VERIFICATION_BROWSER_HEADLESS: 'false',
  XIANYU_VERIFICATION_BROWSER_USER_DATA_DIR: profileRoot, XIANYU_RECORD_DIR: join(root, 'live-local'),
  AUTO_REPLY_SEND_MODE: 'simulate', AUTO_REPLY_MODEL_ENABLED: 'false', AUTO_REPLY_OUTCOME_REVIEW_WORKER_ENABLED: 'false',
  PRODUCT_AUTOMATION_EXECUTION_MODE: 'simulate',
  VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: 'http://127.0.0.1:8080',
};
const env = { ...process.env, ...overrides };
delete env.NODE_OPTIONS;
writeFileSync(join(root, 'runtime-env.json'), JSON.stringify(env, null, 2));
const store = createRecordingStore(root);
store.event('runtime.prepare', { project, profileSource, profileRoot, overrides, priorEnvFile: existsSync(envFile) ? envFile : null, rationale: 'Inspect existing shared local PostgreSQL accounts without automatic messages or fulfillment; worker is not required for slider verification.' });
store.json('local-browser-profile-source.json', { profileSource, copied: existsSync(profileSource), profileRoot });
console.log(JSON.stringify({ prepared: true, profileCopied: existsSync(profileSource), overrides: Object.keys(overrides) }));
