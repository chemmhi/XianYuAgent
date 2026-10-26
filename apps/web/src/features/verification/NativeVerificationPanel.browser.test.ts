import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, type Browser, type Page } from 'patchright';
import { basename, dirname, join, resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// Real React/Provider/iframe DOM; only HTTP transport, event socket and the
// platform page are controlled. This is not a backend/platform acceptance test.
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {VerificationProvider} from '/src/features/verification/VerificationProvider.tsx';
import {session} from '/src/features/verification/test-fixtures.ts';
import '/src/styles.css';
const actualNow=Date.now.bind(Date);let offset=0;Date.now=()=>actualNow()+offset;
const sockets=new Set();let row=session({id:'native-review',subject:{accountId:'account'},presentationKind:'native_iframe',state:'priority_wait',
 serverTime:Date.now(),createdAt:Date.now(),expiresAt:Date.now()+300000,setupDeadline:Date.now()+8000,priorityDeadline:Date.now()+60000});
let renewals=0,claims=0,cancels=0,results=0,streams=0,heldClaim,renewMode='normal',holdClaim=false;
const leaseId='native-review-lease',origin='https://h5api.m.goofish.com';
const url=origin+'/h5/mtop.review.read/1.0/_____tmd_____/punish?synthetic-only=1&addCookieToHeader=1';
const copy=()=>structuredClone(row);
const emit=()=>{for(const socket of sockets)socket.onmessage?.({data:JSON.stringify({session:copy()})});};
const publish=patch=>{row={...row,...patch,version:row.version+1,eventSequence:row.eventSequence+1,serverTime:Date.now()};emit();};
class Socket{static OPEN=1;readyState=1;constructor(value){this.url=String(value);if(this.url.includes('/stream'))streams++;sockets.add(this);
 setTimeout(()=>{this.onopen?.();this.onmessage?.({data:JSON.stringify({sessions:[copy()]})});},0);}
 send(){}close(){this.readyState=3;sockets.delete(this);}}
window.WebSocket=Socket;
const native=async(action,body)=>{
 if(action==='presentation'){
  renewals++;if(renewMode==='hold')return new Promise(()=>{});if(renewMode==='reject')throw Error('controlled network interruption');
  row={...row,presentation:{clientId:body.clientInstanceId,until:Date.now()+4000},version:row.version+1,eventSequence:row.eventSequence+1,serverTime:Date.now()};
  return{session:copy(),leaseId};
 }
 if(action==='claim'){
  claims++;row={...row,state:'human_active',controller:{clientId:body.clientInstanceId},controlEpoch:row.controlEpoch+1,
   humanDeadline:Date.now()+30000,presentation:{clientId:body.clientInstanceId,until:Date.now()+4000},
   version:row.version+1,eventSequence:row.eventSequence+1,serverTime:Date.now()};
  const result={session:copy(),leaseId,url,origin};
  if(holdClaim)return new Promise(resolve=>{heldClaim=()=>resolve(result);});return result;
 }
 if(action==='cancel'){
  cancels++;if(body.challengeGeneration!==row.challengeGeneration||body.controlEpoch!==row.controlEpoch)throw Error('obsolete cancellation');
  publish({state:'cancelled',controller:undefined,presentation:undefined});return{session:copy()};
 }
 if(action==='result'){results++;publish({state:'handoff',resultCandidateReceived:true,controller:undefined,presentation:undefined});return{session:copy()};}
 throw Error('unknown native action');
};
const transport={get:async path=>path.includes('?active')?{sessions:[copy()],serverTime:Date.now()}:{session:copy()},post:async(path,body)=>{
 const match=/\\/native\\/(presentation|claim|result|cancel)$/.exec(path);if(!match)throw Error('no screenshot command is allowed');return native(match[1],body);
}};
// DOM is shared across Patchright's isolated evaluation world and the page's
// main world. Commands and observations deliberately use this shared channel.
document.addEventListener('native-review-command',()=>{
 const command=JSON.parse(document.documentElement.getAttribute('data-native-review-command'));
 if(command.type==='renewMode')renewMode=command.value;
 else if(command.type==='holdClaim')holdClaim=true;
 else if(command.type==='finishClaim')heldClaim?.();
 else if(command.type==='advance')offset+=command.ms;
 else if(command.type==='advanceAndRenew'){offset+=command.ms;publish({presentation:{...row.presentation,until:Date.now()+4000}});}
 document.documentElement.setAttribute('data-native-review-stats',JSON.stringify({renewals,claims,cancels,results,streams,state:row.state}));
});
createRoot(document.getElementById('root')).render(React.createElement(VerificationProvider,{transport,accountLabels:{account:'原生测试账号'}},null));
`;

const platformHtml = `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:420px;height:320px;overflow:hidden}#track{position:absolute;left:60px;top:195px;width:300px;height:34px;background:#ddd}#end{position:absolute;left:355px;top:195px;width:5px;height:34px;background:green}</style><div id="track">受控原生平台页面</div><div id="end"></div><button id="candidate">发送受控候选</button><script>document.getElementById('candidate').onclick=()=>parent.postMessage(JSON.stringify({type:'child',content:JSON.stringify({x5sec:JSON.stringify({value:'synthetic-only',expire:Date.now()+60000,host:location.host})})}),'*');</script>`;

let vite: ViteDevServer | undefined, browser: Browser | undefined, baseUrl = '', cacheDir: string | undefined;
beforeAll(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'xianyu-native-panel-review-'));
  vite = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../../..'), cacheDir,
    plugins: [react(), { name: 'native-panel-review-page',
      resolveId(id) { if (id === '/__native-panel-review-entry.js') return id; },
      load(id) { if (id === '/__native-panel-review-entry.js') return entry; },
      configureServer(server) { server.middlewares.use('/__native-panel-review.html', async (request, response, next) => {
        try { const html = await server.transformIndexHtml(request.url ?? '/', '<div id="root"></div><script type="module" src="/__native-panel-review-entry.js"></script>');
          response.setHeader('Content-Type', 'text/html'); response.end(html);
        } catch (error) { next(error); }
      }); },
    }], server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await vite.listen(); baseUrl = vite.resolvedUrls!.local[0];
  browser = await chromium.launch({ channel: 'chrome', headless: true });
}, 30_000);
afterAll(async () => {
  await Promise.allSettled([browser?.close(), vite?.close()]);
  if (cacheDir) { const target = resolve(cacheDir);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('xianyu-native-panel-review-')) throw Error('Unsafe native panel test cleanup');
    await rm(target, { recursive: true, force: true });
  }
});

async function pageFor(viewport = { width: 1440, height: 900 }): Promise<Page> {
  const page = await browser!.newPage({ viewport });
  await page.route('https://h5api.m.goofish.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: platformHtml }));
  await page.goto(`${baseUrl}__native-panel-review.html`); await page.bringToFront();
  await expect.poll(() => page.getByRole('button', { name: '我来操作', exact: true }).isEnabled()).toBe(true);
  return page;
}
async function control(page: Page, command: Record<string, unknown>) {
  return page.evaluate(value => {
    document.documentElement.setAttribute('data-native-review-command', JSON.stringify(value));
    document.dispatchEvent(new Event('native-review-command'));
    return JSON.parse(document.documentElement.getAttribute('data-native-review-stats')!);
  }, command);
}
async function stats(page: Page) { return control(page, { type: 'stats' }); }
async function claim(page: Page) {
  await page.getByRole('button', { name: '我来操作', exact: true }).click();
  await page.locator('iframe[title="闲鱼原生安全验证"]').waitFor();
  await page.frameLocator('iframe').locator('#end').waitFor();
}

it('removes the native iframe at the local human deadline even when its presentation lease remains valid and events stop', async () => {
  const page = await pageFor();
  try {
    await claim(page);
    // At 29 seconds the last legitimate renewal may outlive the human cutoff.
    await control(page, { type: 'renewMode', value: 'hold' });
    await control(page, { type: 'advanceAndRenew', ms: 29_000 });
    await expect.poll(() => page.locator('.verification-countdown').textContent()).toBe('1s');
    expect(await page.locator('iframe').count()).toBe(1);
    await control(page, { type: 'advance', ms: 1_100 });
    await page.locator('iframe').waitFor({ state: 'detached' });
    expect((await stats(page)).results).toBe(0);
    expect((await stats(page)).streams).toBe(0);
  } finally { await page.close(); }
}, 30_000);

it('removes the native iframe when presentation renewal fails and the four-second lease expires without a server event', async () => {
  const page = await pageFor();
  try {
    await claim(page);
    await control(page, { type: 'renewMode', value: 'reject' });
    await control(page, { type: 'advance', ms: 4_100 });
    await page.locator('iframe').waitFor({ state: 'detached' });
    expect((await stats(page)).results).toBe(0);
  } finally { await page.close(); }
}, 30_000);

it('cancels a claim granted after its panel was closed and never resurrects the old iframe or hidden controller', async () => {
  const page = await pageFor();
  try {
    await control(page, { type: 'holdClaim' });
    await page.getByRole('button', { name: '我来操作', exact: true }).click();
    await expect.poll(async () => (await stats(page)).claims).toBe(1);
    await page.getByRole('button', { name: '收起验证弹窗', exact: true }).click();
    await page.locator('.verification-modal').waitFor({ state: 'detached' });
    await control(page, { type: 'finishClaim' });
    await expect.poll(async () => (await stats(page)).cancels).toBe(1);
    expect((await stats(page)).state).toBe('cancelled');
    expect(await page.locator('iframe').count()).toBe(0);
    expect(await page.locator('.verification-modal').count()).toBe(0);
  } finally { await page.close(); }
}, 30_000);

it('renews native presence without replacing or navigating the active iframe and opens no screenshot stream', async () => {
  const page = await pageFor();
  try {
    await claim(page);
    const frame = page.frames().find(value => value.url().startsWith('https://h5api.m.goofish.com/'))!;
    await frame.evaluate(() => document.documentElement.setAttribute('data-native-sentinel', 'same-document'));
    await page.locator('iframe').evaluate(element => element.setAttribute('data-native-element', 'same-element'));
    const before = (await stats(page)).renewals;
    await expect.poll(async () => (await stats(page)).renewals, { timeout: 4_000 }).toBeGreaterThanOrEqual(before + 2);
    expect(await page.locator('iframe').getAttribute('data-native-element')).toBe('same-element');
    expect(await frame.evaluate(() => document.documentElement.getAttribute('data-native-sentinel'))).toBe('same-document');
    expect((await stats(page)).streams).toBe(0);
  } finally { await page.close(); }
}, 30_000);

it('describes native close as ending this human round and cancels it instead of promising automatic handover', async () => {
  const page = await pageFor();
  try {
    await claim(page);
    await page.getByRole('button', { name: '收起验证弹窗', exact: true }).click();
    expect(await page.getByRole('button', { name: '交给系统并关闭', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: '结束人工并关闭', exact: true }).click();
    await expect.poll(async () => (await stats(page)).cancels).toBe(1);
    expect((await stats(page)).state).toBe('cancelled');
    await page.locator('.verification-modal').waitFor({ state: 'detached' });
    expect(await page.locator('iframe').count()).toBe(0);
  } finally { await page.close(); }
}, 30_000);

it('accepts a candidate only from the real native iframe source and keeps candidate handoff wording separate from platform success', async () => {
  const page = await pageFor();
  try {
    await claim(page);
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: 'https://h5api.m.goofish.com',
      data: JSON.stringify({ type: 'child', content: JSON.stringify({ x5sec: JSON.stringify({ value: 'synthetic-only', expire: Date.now() + 60_000, host: 'h5api.m.goofish.com' }) }) }) })));
    expect((await stats(page)).results).toBe(0);
    const frame = page.frames().find(value => value.url().startsWith('https://h5api.m.goofish.com/'))!;
    await frame.locator('#candidate').click();
    await expect.poll(async () => (await stats(page)).results).toBe(1);
    await page.locator('[data-state="handoff"]').waitFor();
    expect(await page.getByText('正在复验账号连接', { exact: true }).count()).toBe(1);
    expect(await page.getByText('验证码已通过，正在交接', { exact: true }).count()).toBe(0);
    expect(await page.locator('iframe').count()).toBe(0);
  } finally { await page.close(); }
}, 30_000);

it.each([{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }])(
  'fits the entire 420 by 320 native viewport in the fixed $name modal without cropping or body scrolling', async viewport => {
    const page = await pageFor(viewport);
    try {
      await claim(page);
      await expect.poll(() => page.locator('iframe').evaluate(element => {
        const frame = element.getBoundingClientRect(), surface = element.parentElement!.getBoundingClientRect();
        return frame.width > 100 && frame.left >= surface.left - 1 && frame.right <= surface.right + 1 && frame.top >= surface.top - 1 && frame.bottom <= surface.bottom + 1;
      })).toBe(true);
      const dimensions = await page.locator('iframe').evaluate(element => {
        const frame = element as HTMLIFrameElement, box = frame.getBoundingClientRect(), body = document.querySelector('.verification-modal-body')!;
        return { intrinsicWidth: frame.clientWidth, intrinsicHeight: frame.clientHeight, ratio: box.width / box.height,
          bodyHeight: body.clientHeight, bodyScroll: body.scrollHeight, modalHeight: document.querySelector('.verification-modal')!.getBoundingClientRect().height };
      });
      expect(dimensions.intrinsicWidth).toBe(420); expect(dimensions.intrinsicHeight).toBe(320);
      expect(dimensions.ratio).toBeCloseTo(420 / 320, 2);
      expect(dimensions.bodyScroll).toBe(dimensions.bodyHeight); expect(dimensions.modalHeight).toBe(540);
      const frame = page.frames().find(value => value.url().startsWith('https://h5api.m.goofish.com/'))!;
      expect(await frame.evaluate(() => ({ width: innerWidth, height: innerHeight, right: document.getElementById('end')!.getBoundingClientRect().right })))
        .toEqual({ width: 420, height: 320, right: 360 });
    } finally { await page.close(); }
  }, 30_000);
