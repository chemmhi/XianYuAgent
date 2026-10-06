import { createApp } from './app.js';

const runtime = createApp();
await runtime.listen();
console.log(`xianyu-agent-server listening on ${runtime.config.host}:${runtime.config.port} repairMode=${runtime.autoReplyRepair.currentMode} primaryRoute=${runtime.autoReplyRepair.currentMode === 'enforce' ? 'repair' : 'compatibility'} verificationBrowser=${runtime.config.xianyuVerificationBrowserMode} verificationSlider=${runtime.config.xianyuVerificationSliderMode} verificationHeadless=${runtime.config.xianyuVerificationBrowserHeadless}`);

const shutdown = async (signal: string) => { console.log(`received ${signal}, shutting down`); await runtime.close(); process.exit(0); };
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
