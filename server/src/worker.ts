import { loadConfig } from './config.js';

const config = loadConfig();
console.log(`xianyu-agent-worker started; redis=${config.redisUrl ?? 'not_configured'}`);
const timer = setInterval(() => console.log(JSON.stringify({ component: 'worker', status: 'idle', observedAt: new Date().toISOString() })), 30_000);
const shutdown = (signal: string) => { clearInterval(timer); console.log(`worker received ${signal}, exiting`); process.exit(0); };
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
