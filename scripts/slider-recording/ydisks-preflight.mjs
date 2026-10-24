import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { createRecordingStore } from './store.mjs';
import { installHttpRecording } from './http.mjs';
import { XianyuMtopClient } from '../../apps/api/src/xianyu-mtop.ts';

const root = resolve(process.env.XIANYU_COPY_INPUT_DIR);
const recording = createRecordingStore(process.env.XIANYU_RECORD_DIR);
const identityHeaders = process.env.XIANYU_COPY_IDENTITY_HEADERS
  ? JSON.parse(fs.readFileSync(process.env.XIANYU_COPY_IDENTITY_HEADERS, 'utf8')) : {};
const { request } = await import('patchright');
const context = await request.newContext({ proxy: { server: process.env.XIANYU_COPY_PROXY }, timeout: 20_000,
  userAgent: process.env.XIANYU_BROWSER_USER_AGENT });
globalThis.fetch = async (url, init = {}) => {
  const headersToSend = { ...Object.fromEntries(new Headers(init.headers).entries()), ...identityHeaders };
  recording.event('transport.request', { url: String(url), method: init.method ?? 'GET', headers: headersToSend,
    body: recording.blob(init.body ?? '') });
  const response = await context.fetch(String(url), { method: init.method ?? 'GET', headers: headersToSend,
    data: init.body, timeout: 20_000, failOnStatusCode: false });
  const headers = new Headers();
  for (const h of response.headersArray()) headers.append(h.name, h.value);
  const output = new Response(await response.body(), { status: response.status(), statusText: response.statusText(), headers });
  await response.dispose();
  return output;
};
const drain = installHttpRecording(recording);
const input = JSON.parse(fs.readFileSync(join(root, process.env.XIANYU_COPY_PREFLIGHT_INPUT ?? 'preflight-input.json'), 'utf8'));
recording.json('input.json', { input, env: process.env, versions: process.versions });
let current = input.credential;
try {
  const client = new XianyuMtopClient({ timeoutMs: 20_000, loadCredential: async () => current,
    saveCookie: async (_admin, _account, cookieHeader, metadata) => {
      current = { ...current, cookieHeader, metadata };
      recording.json('memory-update.json', current);
    } });
  const steps = process.env.XIANYU_COPY_TOKEN_ONLY === 'true' ? ['fetchImToken'] : ['verifyLogin', 'fetchImToken'];
  for (const step of steps) {
    const result = step === 'verifyLogin' ? await client.verifyLogin(input.adminId, input.accountId)
      : await client.fetchImToken(input.adminId, input.accountId, input.deviceId);
    recording.json(`${step}.json`, result);
    if (result.verificationUrl) {
      const live = { ...input, verificationUrl: result.response?.data?.url ?? result.verificationUrl, credential: current,
        source: 'fresh platform response; browser must make first GET', preflightDirectory: recording.root };
      fs.writeFileSync(join(root, 'latest-challenge-input.json'), JSON.stringify(live, null, 2));
    }
    console.log(JSON.stringify({ label: input.label, step, success: result.success, errorCode: result.errorCode,
      hasToken: Boolean(result.accessToken), hasChallenge: Boolean(result.verificationUrl) }));
  }
  recording.json('memory-final.json', current);
} finally { await drain(); await context.dispose(); }
