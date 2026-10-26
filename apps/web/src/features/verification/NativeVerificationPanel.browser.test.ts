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
import {VerificationProvider,VerificationQrPanel} from '/src/features/verification/VerificationProvider.tsx';
import {session} from '/src/features/verification/test-fixtures.ts';
import '/src/styles.css';
const actualNow=Date.now.bind(Date);let offset=0;Date.now=()=>actualNow()+offset;
const embedded=new URLSearchParams(location.search).has('qr');
const sockets=new Set();let row=session({id:'native-review',subject:embedded?{loginSessionId:'qr-review'}:{accountId:'account'},presentationKind:'native_iframe',state:'priority_wait',
 serverTime:Date.now(),createdAt:Date.now(),expiresAt:Date.now()+300000,setupDeadline:Date.now()+8000,priorityDeadline:Date.now()+60000});
let renewals=0,claims=0,cancels=0,results=0,streams=0,retries=0,heldClaim,renewMode='normal',holdClaim=!new URLSearchParams(location.search).has('lost'),rejectRetry=false;
let loseReply=new URLSearchParams(location.search).has('lost'),claimVersion;const claimVersions=[];
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
  claims++;claimVersions.push(body.expectedVersion);
  if(row.state==='human_active'&&claimVersion!==body.expectedVersion)throw Error('claim replay version changed');
  if(row.state!=='human_active'){claimVersion=body.expectedVersion;row={...row,state:'human_active',controller:{clientId:body.clientInstanceId},controlEpoch:row.controlEpoch+1,
   humanDeadline:Date.now()+30000,presentation:{clientId:body.clientInstanceId,until:Date.now()+4000},
   version:row.version+1,eventSequence:row.eventSequence+1,serverTime:Date.now()};}
  const result={session:copy(),leaseId,url,origin};
  if(loseReply){loseReply=false;throw Error('controlled lost claim response');}
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
 if(path.endsWith('/retry')){retries++;if(rejectRetry)throw Error('controlled retry failure');publish({id:'native-retry',state:'priority_wait',priorityDeadline:Date.now()+60000,controller:undefined,presentation:undefined});return{session:copy()};}
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
 else if(command.type==='state')publish({state:command.value,failureCode:command.failureCode,controller:undefined,presentation:undefined});
 else if(command.type==='rejectRetry')rejectRetry=true;
 else if(command.type==='otherHuman')publish({state:'human_active',controller:{clientId:'another-client'},humanDeadline:Date.now()+30000,presentation:undefined});
 document.documentElement.setAttribute('data-native-review-stats',JSON.stringify({renewals,claims,cancels,results,streams,retries,claimVersions,humanDeadline:row.humanDeadline,state:row.state}));
});
createRoot(document.getElementById('root')).render(React.createElement(VerificationProvider,{transport,accountLabels:{account:'原生测试账号'}},embedded?React.createElement('section',{'data-testid':'qr-host'},React.createElement(VerificationQrPanel,{loginSessionId:'qr-review'})):null));
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

async function pageFor(viewport = { width: 1440, height: 900 }, query = '', platform = platformHtml): Promise<Page> {
  const page = await browser!.newPage({ viewport });
  await page.route('https://h5api.m.goofish.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: platform }));
  await page.goto(`${baseUrl}__native-panel-review.html${query}`); await page.bringToFront();
  await expect.poll(async () => (await stats(page)).claims).toBe(1);
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
  await control(page, { type: 'finishClaim' });
  await page.locator('iframe[title="闲鱼原生安全验证"]').waitFor();
  await page.frameLocator('iframe').locator('#end').waitFor();
}

it('opens native verification automatically once and cancels a grant returned after the panel became hidden', async () => {
  const page = await pageFor();
  try {
    expect(await page.getByRole('button', { name: '我来操作', exact: true }).count()).toBe(0);
    expect((await stats(page)).claims).toBe(1);
    await page.locator('.verification-modal').evaluate(element => { (element as HTMLElement).style.visibility = 'hidden'; });
    await control(page, { type: 'finishClaim' });
    await expect.poll(async () => (await stats(page)).cancels).toBe(1);
    expect(await page.locator('iframe').count()).toBe(0);
  } finally { await page.close(); }
}, 30_000);

it('reloads a lost automatic claim response with the original version and deadline', async () => {
  const page = await pageFor(undefined, '?lost=1');
  try {
    await page.getByRole('button', { name: '重新加载验证', exact: true }).waitFor();
    const before = await stats(page);
    await page.getByRole('button', { name: '重新加载验证', exact: true }).click();
    await page.locator('iframe').waitFor();
    const after = await stats(page);
    expect(after.claims).toBe(2); expect(after.claimVersions[1]).toBe(after.claimVersions[0]);
    expect(after.humanDeadline).toBe(before.humanDeadline);
  } finally { await page.close(); }
}, 30_000);

it.each([{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }])(
  'centers all native intermediate states in the fixed $name dialog and keeps the action at the bottom', async viewport => {
    const page = await pageFor(viewport);
    try {
      for (const state of ['priority_wait', 'preparing', 'auto_active', 'settling', 'handoff', 'rechecking', 'human_active']) {
        if (state === 'human_active') await control(page, { type: 'otherHuman' });
        else await control(page, { type: 'state', value: state });
        await page.locator(`[data-state="${state}"]`).waitFor();
        const view = await page.locator('.verification-modal').evaluate(element => {
          const body = element.querySelector('.verification-modal-body')!, area = element.querySelector('.verification-image')!;
          const copy = area.querySelector('.verification-progress-copy'), footer = element.querySelector('.verification-footer')!;
          const a = area.getBoundingClientRect(), c = copy?.getBoundingClientRect(), f = footer.getBoundingClientRect();
          return { height: element.getBoundingClientRect().height, overflow: body.scrollHeight-body.clientHeight,
            title: copy?.querySelector('h3')?.textContent, centered: c ? Math.abs((c.top+c.bottom-a.top-a.bottom)/2) : null,
            footerGap: body.getBoundingClientRect().bottom-f.bottom, text: body.textContent };
        });
        expect(view.title).toBeTruthy(); expect(view.height).toBe(540); expect(view.overflow).toBe(0);
        expect(view.centered).not.toBeNull(); expect(view.centered!).toBeLessThan(2); expect(view.footerGap).toBeLessThan(2);
        if (state === 'priority_wait') expect(await page.getByRole('button', { name: '我来操作', exact: true }).count()).toBe(0);
        if (state === 'human_active') { expect(view.text).toContain('请等待其他页面完成验证，结果会自动同步。'); expect(view.text).not.toContain('由你操作验证'); }
        await page.screenshot({ path: join(tmpdir(), `xianyu-verification-progress-${viewport.name}-${state}.png`) });
      }
      expect((await stats(page)).claims).toBe(1); expect((await stats(page)).results).toBe(0);
    } finally { await page.close(); }
  }, 30_000);

it.each([{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }])(
  'balances terminal results and closes success without retrying on $name', async viewport => {
    const page = await pageFor(viewport);
    try {
      const initial = await page.locator('.verification-modal').boundingBox();
      for (const state of ['succeeded', 'failed', 'expired', 'cancelled', 'completed_partial', 'succeeded']) {
        await control(page, { type: 'state', value: state, failureCode: 'VERIFICATION_PLATFORM_REJECTED' });
        await page.locator(`[data-state="${state}"]`).waitFor();
        const retryable = ['failed','expired','cancelled'].includes(state);
        expect(await page.getByRole('button', { name: '我来重试', exact: true }).count()).toBe(retryable ? 1 : 0);
        const geometry = await page.locator('.verification-modal').evaluate(element => {
          const body = element.querySelector('.verification-modal-body')!, area = element.querySelector('.verification-image')!;
          const content = element.querySelector('.verification-outcome-copy')!, footer = element.querySelector('.verification-footer')!;
          const a = area.getBoundingClientRect(), c = content.getBoundingClientRect(), f = footer.getBoundingClientRect();
          return { height: element.getBoundingClientRect().height, overflow: body.scrollHeight - body.clientHeight,
            centered: Math.abs((c.top+c.bottom-a.top-a.bottom)/2), footerGap: body.getBoundingClientRect().bottom-f.bottom };
        });
        expect(geometry.height).toBe(initial!.height); expect(geometry.overflow).toBe(0);
        expect(geometry.centered).toBeLessThan(2); expect(geometry.footerGap).toBeLessThan(2);
        await page.screenshot({ path: join(tmpdir(), `xianyu-verification-outcome-${viewport.name}-${state}.png`) });
      }
      await page.getByRole('button', { name: '完成', exact: true }).click();
      await page.locator('.verification-modal').waitFor({ state: 'detached' });
      expect((await stats(page)).retries).toBe(0);
    } finally { await page.close(); }
  }, 30_000);

it('retries a failed outcome through the existing manual-only retry and opens the new round', async () => {
  const page = await pageFor();
  try {
    await control(page, { type: 'state', value: 'failed', failureCode: 'VERIFICATION_PLATFORM_REJECTED' });
    await page.getByRole('button', { name: '我来重试', exact: true }).click();
    await page.locator('[data-state="priority_wait"]').waitFor();
    expect((await stats(page)).retries).toBe(1);
    await expect.poll(async () => (await stats(page)).claims).toBe(2);
    expect(await page.getByRole('button', { name: '我来操作', exact: true }).count()).toBe(0);
  } finally { await page.close(); }
}, 30_000);

it('keeps a failed outcome open with an error and restores its buttons if retry is rejected', async () => {
  const page = await pageFor();
  try {
    await control(page, { type: 'state', value: 'failed' }); await control(page, { type: 'rejectRetry' });
    await page.getByRole('button', { name: '我来重试', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '无法发起人工重试' }).waitFor();
    expect(await page.getByRole('button', { name: '我来重试', exact: true }).isEnabled()).toBe(true);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.locator('.verification-modal').waitFor({ state: 'detached' });
    expect((await stats(page)).retries).toBe(1);
  } finally { await page.close(); }
}, 30_000);

it('keeps native QR success and cancellation inside the login host without a second dialog or retrying cancelled login', async () => {
  const page = await pageFor(undefined, '?qr=1');
  try {
    for (const state of ['succeeded', 'cancelled']) {
      await control(page, { type: 'state', value: state });
      await page.locator(`[data-state="${state}"]`).waitFor();
      expect(await page.getByTestId('qr-host').isVisible()).toBe(true);
      expect(await page.locator('.verification-modal').count()).toBe(0);
      expect(await page.getByRole('button', { name: /^(完成|关闭|我来重试)$/ }).count()).toBe(0);
    }
    expect((await stats(page)).retries).toBe(0);
  } finally { await page.close(); }
}, 30_000);

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
    expect((await stats(page)).claims).toBe(1);
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

it.each([{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }])(
  'keeps native control and the same iframe while the mouse crosses the track and iframe edge on $name', async viewport => {
    // A controlled platform owns its input and clamps its handle. The project
    // must not intercept overshoot, judge an answer, or tear down that document.
    const platform = platformHtml + `<style>#handle{position:absolute;left:0;top:0;width:42px;height:30px;background:#48c;user-select:none}</style>
      <script>const track=document.getElementById('track'),handle=document.createElement('span');handle.id='handle';track.append(handle);
      let pressed=false,start=0;
      handle.addEventListener('mousedown',e=>{pressed=true;start=e.clientX-(parseFloat(handle.style.left)||0);});
      document.addEventListener('mousemove',e=>{if(pressed)handle.style.left=Math.min(258,Math.max(-2,e.clientX-start))+'px';});
      document.addEventListener('mouseup',()=>{pressed=false;});</script>`;
    const page = await pageFor(viewport, '', platform);
    try {
      await claim(page);
      const frame = page.frames().find(value => value.url().startsWith('https://h5api.m.goofish.com/'))!;
      await frame.locator('#handle').waitFor();
      await frame.evaluate(() => document.documentElement.setAttribute('data-native-sentinel', 'held-document'));
      await page.locator('iframe').evaluate(element => element.setAttribute('data-native-element', 'held-element'));
      const box = (await page.locator('iframe').boundingBox())!, scale = box.width / 420;
      const before = await stats(page), y = box.y + 210 * scale;
      await page.mouse.move(box.x + 81 * scale, y); await page.mouse.down();
      await page.mouse.move(box.x + 380 * scale, y, { steps: 12 });
      expect(await frame.locator('#handle').evaluate(element => (element as HTMLElement).style.left)).toBe('258px');
      await page.mouse.move(box.x + 460 * scale, y, { steps: 6 });
      await expect.poll(async () => (await stats(page)).renewals, { timeout: 4_000 }).toBeGreaterThanOrEqual(before.renewals + 2);
      await page.mouse.up();
      const after = await stats(page);
      expect(after.state).toBe('human_active'); expect(after.humanDeadline).toBe(before.humanDeadline);
      expect(after.claims).toBe(1); expect(after.cancels).toBe(0); expect(after.results).toBe(0); expect(after.streams).toBe(0);
      expect(await page.locator('iframe').getAttribute('data-native-element')).toBe('held-element');
      expect(await frame.evaluate(() => document.documentElement.getAttribute('data-native-sentinel'))).toBe('held-document');
      expect(await frame.locator('#handle').evaluate(element => (element as HTMLElement).style.left)).toBe('258px');
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
