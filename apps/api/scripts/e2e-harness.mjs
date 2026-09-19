import { createApp } from '../dist/app.js';

const port = Number(process.env.PORT ?? 18080);
const runtime = createApp({ host: process.env.HOST ?? '127.0.0.1', port, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' });
runtime.xianyu.verifyLogin = async () => ({ success: true, accountInvalid: false, cookieHeader: 'unb=real-seller; _m_h5_tk=token_1' });
runtime.xianyu.fetchProfile = async () => ({ success: true, accountInvalid: false, cookieHeader: 'unb=real-seller; _m_h5_tk=token_1', response: { data: { userNick: '真实闲鱼昵称', userId: 'real-seller', avatarUrl: 'https://img.example/avatar.png', shopName: '真实店铺备注' } } });
await runtime.listen();
console.log(`e2e harness listening on ${runtime.config.host}:${runtime.config.port}`);
const shutdown = async () => { await runtime.close(); process.exit(0); };
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
