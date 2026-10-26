import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, type Browser, type Page } from 'patchright';
import { basename, dirname, resolve, join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// Browser integration of the actual React Provider and command handlers. The transport
// and event socket are controlled; this is not a backend or platform acceptance test.
const entry = `
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VerificationProvider, VerificationQrPanel, useVerification, useVerificationQrHost } from '/src/features/verification/VerificationProvider.tsx';
import { useVerificationClose } from '/src/features/verification/VerificationClose.tsx';
import { session } from '/src/features/verification/test-fixtures.ts';
import { ApiError } from '/src/api/http.ts';
import { AccountContextProvider } from '/src/app/account-context.tsx';
import { AccountVerificationProvider } from '/src/app/VerificationBridge.tsx';
const scenario = new URLSearchParams(location.search).get('scenario');
const claimScenario=scenario?.startsWith('claim-version-');
const layout = ['layout','stream-clear','stream-clear-race','title-known','title-unknown'].includes(scenario)||claimScenario||scenario?.startsWith('stream-phase-'), disabled = scenario !== 'selection' && !layout, qr = scenario === 'disabled-qr';
if (layout) await import('/src/styles.css');
const events = new Set(), streams = new Set(); let notifyRelease = () => {};
let streamCreated=0,streamClosed=0,resumeCommands=0,presentationAcks=0,frameSequence=0,claimCommands=0,notifyDiagnostics=()=>{};
let holdAck=false,holdReserve=false;const pendingAcks=[],pendingReserves=[],closedStreams=[];
const diagnostics=()=>JSON.stringify({streamCreated,streamClosed,resumeCommands,presentationAcks,claimCommands,pendingReserves:pendingReserves.length});
class TestSocket {
 static OPEN = 1;
 readyState = 1;
 constructor(url) {
  this.url = url; if (url.includes('verification-events')) events.add(this); else { streams.add(this);streamCreated++;notifyDiagnostics(diagnostics()); }
  setTimeout(() => { this.onopen?.({}); if (url.includes('/stream?')) this.onmessage?.({ data: JSON.stringify({type:'hello',connectionId:'test-stream'}) }); }, 0);
 }
 send() {}
 close() { if(this.readyState===3)return;this.readyState = 3; events.delete(this); if(streams.delete(this)){closedStreams.push(this);streamClosed++;notifyDiagnostics(diagnostics());} this.onclose?.({ code: 1000 }); }
}
window.WebSocket = TestSocket;
let b = session({id:'b',subject:qr ? {loginSessionId:'login-b'} : {accountId:'account-b'},autoAllowed:!disabled,serverTime:Date.now()});
const a = session({id:'a',subject:{accountId:'account-a'},state:'failed',createdAt:200});
const transport = {
 get: async path => path.includes('?active=') ? {sessions:[b]} : {session:b},
 post: async (path, body) => {
  if(path.endsWith('/presentation')&&body.action==='reserve'&&holdReserve){
   holdReserve=false;
   await new Promise((_,reject)=>{pendingReserves.push(reject);notifyDiagnostics(diagnostics());});
  }
  if (path.endsWith('/retry')) return {session:a};
  if (claimScenario && path.endsWith('/claim') && body.action==='claim') {
   claimCommands++;notifyDiagnostics(diagnostics());
   if(claimCommands===1||scenario==='claim-version-repeat') {
    b={...b,version:b.version+1,eventSequence:b.eventSequence+1,serverTime:Date.now(),
     state:scenario==='claim-version-state'?'auto_active':'priority_wait',
     priorityDeadline:scenario==='claim-version-expired'?Date.now()-1:b.priorityDeadline,
     presentation:{clientId:scenario==='claim-version-owner'?'another-client':body.clientInstanceId,until:Date.now()+5000}};
    throw new ApiError('version changed',409,{error:{code:'VERIFICATION_VERSION_CHANGED'}});
   }
   if(body.expectedVersion!==b.version)throw new Error('claim must use refreshed version');
   b={...b,state:'human_active',controller:{clientId:body.clientInstanceId},humanDeadline:Date.now()+30000,serverTime:Date.now(),version:b.version+1,eventSequence:b.eventSequence+1};
  }
  if (path.endsWith('/claim') && body.action==='resume') {resumeCommands++;notifyDiagnostics(diagnostics());}
  if (path.endsWith('/presentation') && body.action==='ack') {
   const response=b;presentationAcks++;notifyDiagnostics(diagnostics());
   if(holdAck)await new Promise(resolve=>pendingAcks.push(resolve));return {session:response};
  }
  if (path.endsWith('/release')) { notifyRelease(body); b = {...b,state:'settling',version:b.version+1,eventSequence:b.eventSequence+1}; }
  return {session:b};
 }
};
function Probe() {
 const ctx = useVerification(), initialized = useRef(false);
 const [released,setReleased] = useState(), [qrClosed,setQrClosed] = useState(false), [revision,setRevision] = useState(0);
 const [streamDiagnostics,setStreamDiagnostics]=useState(diagnostics);
 useVerificationQrHost(qr ? 'login-b' : undefined);
 const close = useVerificationClose(qr ? 'login-b' : undefined, () => setQrClosed(true));
 useEffect(() => { notifyRelease = setReleased; }, []);
 useEffect(() => {notifyDiagnostics=setStreamDiagnostics;setStreamDiagnostics(diagnostics());},[]);
 useEffect(() => {
  if (!disabled || !ctx?.enabled || !ctx.clientId || initialized.current) return;
  initialized.current = true;
  b = {...b,state:'human_active',controller:{clientId:ctx.clientId},humanDeadline:Date.now()+30000,serverTime:Date.now(),mode:'manual_only'};
  ctx.update(b);
 }, [ctx?.enabled,ctx?.clientId]);
 return React.createElement(React.Fragment, null,
  React.createElement('output', {'data-testid':'ready'}, String(Boolean(ctx?.enabled && ctx.clientId))),
  React.createElement('button', {onClick:()=>ctx.retry(a.subject)}, 'Retry A'),
  React.createElement('button', {onClick:()=>{ctx.update({...a,eventSequence:2});setRevision(x=>x+1);}}, 'Unrelated update'),
  React.createElement('button', {onClick:()=>{events.forEach(socket=>socket.onmessage?.({data:JSON.stringify({sessions:[b]})}));setRevision(x=>x+1);}}, 'Snapshot'),
  React.createElement('output', {'data-testid':'revision'}, revision),
  React.createElement('output', {'data-testid':'release'}, JSON.stringify(released)),
  React.createElement('output', {'data-testid':'stream-diagnostics',style:{display:'block',overflowWrap:'anywhere'}}, streamDiagnostics),
  layout && React.createElement('button', {onClick:async()=>{
   b = {...b,state:b.state==='human_active'?'human_active':'priority_wait',priorityDeadline:Date.now()+5000,serverTime:Date.now(),version:b.version+1,eventSequence:b.eventSequence+1}; ctx.update(b);
   const canvas = document.createElement('canvas'); canvas.width=420; canvas.height=320;
   const paint = canvas.getContext('2d'); paint.fillStyle='#f6f7f9'; paint.fillRect(0,0,420,320); paint.fillStyle='#475569'; paint.font='16px sans-serif'; paint.fillText('Local layout fixture 420 x 320',70,160);
   const blob = await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));
   streams.forEach(socket=>{socket.onmessage?.({data:JSON.stringify({type:'frame',frameId:'layout-frame-'+(++frameSequence),streamEpoch:1,geometryRevision:1,capturedAt:Date.now(),width:420,height:320,byteLength:blob.size})});socket.onmessage?.({data:blob});});
  }}, 'Layout ready'),
  layout && React.createElement('button',{onClick:()=>{b={...b,state:'human_active',controller:{clientId:ctx.clientId},humanDeadline:Date.now()+30000,reconnectDeadline:undefined,serverTime:Date.now(),version:b.version+1,eventSequence:b.eventSequence+1};ctx.update(b);}},'Stream grant'),
  layout && React.createElement('button',{onClick:()=>{streams.forEach(socket=>socket.onmessage?.({data:JSON.stringify({type:'clear',streamEpoch:2})}));}},'Stream clear'),
  layout && React.createElement('button',{onClick:()=>{holdAck=true;}},'Hold ACK'),
  layout && React.createElement('button',{onClick:()=>{holdAck=false;pendingAcks.splice(0).forEach(resolve=>resolve());}},'Release ACK'),
  layout && React.createElement('button',{onClick:()=>{holdReserve=true;}},'Hold reserve'),
  layout && React.createElement('button',{onClick:()=>{pendingReserves.splice(0).forEach(reject=>reject(new Error('obsolete reserve')));closedStreams.forEach(socket=>socket.onerror?.({}));notifyDiagnostics(diagnostics());}},'Reject old connection'),
  layout && React.createElement('button',{onClick:()=>{b={...b,state:scenario.slice('stream-phase-'.length),version:b.version+1,eventSequence:b.eventSequence+1};ctx.update(b);}},'Result phase'),
  layout && React.createElement('button', {onClick:()=>{streams.forEach(socket=>socket.close());}}, 'Layout reconnect'),
  layout && React.createElement('button', {onClick:()=>{
   b={...b,state:'failed',version:b.version+1,eventSequence:b.eventSequence+1,sourceResults:[]};ctx.update(b);
  }}, 'Layout fail'),
  layout && React.createElement('button', {onClick:()=>{
   b={...b,state:'failed',version:b.version+1,eventSequence:b.eventSequence+1,sourceResults:Array.from({length:12},(_,i)=>({source:'unknown.write.'+i,status:'probe_only',nextAction:'Please check the original business result before retrying.'}))};ctx.update(b);
  }}, 'Layout long result'),
  qr && !qrClosed && React.createElement('section', {'data-testid':'qr-host'},
   React.createElement('button', {onClick:close.requestClose}, 'Close QR'), close.confirmation, React.createElement(VerificationQrPanel,{loginSessionId:'login-b'})));
}
const accountApi={list:async()=>({items:[{id:'account-b',displayName:'Account B',sellerRef:'seller-private-123',status:'verification_required',enabled:true}]}),listRiskNotifications:async()=>[]};
createRoot(document.getElementById('root')).render(scenario==='title-known'
 ? React.createElement(AccountContextProvider,{api:accountApi},React.createElement(AccountVerificationProvider,{transport,baseUrl:''},React.createElement(Probe)))
 : React.createElement(VerificationProvider,{transport,accountLabels:scenario==='title-unknown'?{}:{'account-a':'Account A','account-b':'Account B'}},React.createElement(Probe)));
`;

let vite: ViteDevServer | undefined, browser: Browser | undefined, baseUrl: string, cacheDir: string | undefined;
const layoutEvidence: unknown[] = [];
beforeAll(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'xianyu-verification-provider-test-'));
  vite = await createServer({
    configFile: false, root: resolve(import.meta.dirname, '../../..'), cacheDir,
    plugins: [react(), {
      name: 'verification-provider-test-page',
      resolveId(id) { if (id === '/__verification-provider-entry.js') return id; },
      load(id) { if (id === '/__verification-provider-entry.js') return entry; },
      configureServer(server) {
        server.middlewares.use('/__verification-provider-test.html', async (request, response, next) => {
          try {
            const html = await server.transformIndexHtml(request.url ?? '/', '<div id="root"></div><script type="module" src="/__verification-provider-entry.js"></script>');
            response.setHeader('Content-Type', 'text/html'); response.end(html);
          } catch (error) { next(error); }
        });
      },
    }],
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await vite.listen(); baseUrl = vite.resolvedUrls!.local[0];
  browser = await chromium.launch({ channel: 'chrome', headless: true });
}, 30_000);
afterAll(async () => {
  await Promise.allSettled([browser?.close(), vite?.close()]);
  if (layoutEvidence.length) await writeFile(join(tmpdir(), 'xianyu-verification-fixed-height.json'), JSON.stringify(layoutEvidence, null, 2));
  if (cacheDir) {
    const target = resolve(cacheDir);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('xianyu-verification-provider-test-')) throw new Error('Unsafe verification test cache cleanup');
    await rm(target, { recursive: true, force: true });
  }
});

async function pageFor(scenario: string): Promise<Page> {
  const page = await browser!.newPage();
  await page.goto(`${baseUrl}__verification-provider-test.html?scenario=${scenario}`);
  await page.locator('[data-testid="ready"]').filter({ hasText: 'true' }).waitFor();
  return page;
}

it('keeps an explicit queue switch after a retry result through actual Provider update and event snapshot handlers', async () => {
  const page = await pageFor('selection');
  try {
    await page.getByRole('button', { name: 'Retry A', exact: true }).click();
    await page.locator('.verification-modal h2').filter({ hasText: 'Account A' }).waitFor();
    await page.getByRole('navigation', { name: '待验证账号' }).getByRole('button', { name: 'Account B', exact: true }).click();
    await page.getByRole('button', { name: 'Unrelated update', exact: true }).click();
    await page.locator('[data-testid="revision"]').filter({ hasText: '1' }).waitFor();
    expect(await page.locator('.verification-modal h2').textContent()).toBe('Account B');
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await page.locator('[data-testid="revision"]').filter({ hasText: '2' }).waitFor();
    expect(await page.locator('.verification-modal h2').textContent()).toBe('Account B');
  } finally { await page.close(); }
}, 30_000);

it.each(['disabled-global', 'disabled-qr'])('closes %s human control through the registered release with toAuto:false', async scenario => {
  const page = await pageFor(scenario);
  try {
    await page.getByRole('button', { name: '结束人工', exact: true }).waitFor();
    expect(await page.getByRole('button', { name: '交给系统', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: scenario === 'disabled-qr' ? 'Close QR' : '收起验证弹窗', exact: true }).click();
    await page.getByRole('button', { name: '结束人工并关闭', exact: true }).click();
    await page.locator('[data-testid="release"]').filter({ hasText: 'toAuto' }).waitFor();
    expect(JSON.parse((await page.locator('[data-testid="release"]').textContent())!)).toMatchObject({toAuto:false,connectionId:'test-stream'});
    await page.locator(scenario === 'disabled-qr' ? '[data-testid="qr-host"]' : '.verification-modal').waitFor({state:'detached'});
  } finally { await page.close(); }
}, 30_000);

it('ends disabled human control with toAuto:false and displays the server settling result', async () => {
  const page = await pageFor('disabled-global');
  try {
    await page.getByRole('button', { name: '结束人工', exact: true }).click();
    await page.locator('[data-testid="release"]').filter({ hasText: 'toAuto' }).waitFor();
    expect(JSON.parse((await page.locator('[data-testid="release"]').textContent())!)).toMatchObject({toAuto:false});
    await page.locator('[data-testid="verification-panel"][data-state="settling"]').waitFor();
    expect(await page.getByRole('button', { name: '交给系统', exact: true }).count()).toBe(0);
  } finally { await page.close(); }
}, 30_000);

it('keeps a visible cleared stream through renewal and acknowledges a new frame without live resume', async () => {
  const page = await pageFor('stream-clear');
  const step = async (name: string) => page.getByRole('button', { name, exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  const diagnostics = async () => JSON.parse((await page.getByTestId('stream-diagnostics').textContent())!);
  try {
    await step('Layout ready'); await page.locator('.verification-image img').waitFor();
    await expect.poll(async () => (await diagnostics()).presentationAcks).toBe(1);
    await step('Stream grant'); await page.locator('[data-state="human_active"]').waitFor();
    await step('Stream clear'); await page.locator('.verification-image img').waitFor({state:'detached'});
    // Cross the production two-second renewal tick with no decoded frame.
    await page.waitForTimeout(2300);
    expect(await diagnostics()).toMatchObject({streamCreated:1,streamClosed:0,resumeCommands:0});
    await step('Layout ready'); await page.locator('.verification-image img').waitFor();
    await expect.poll(async () => (await diagnostics()).presentationAcks).toBe(2);
    expect(await diagnostics()).toMatchObject({streamCreated:1,streamClosed:0,resumeCommands:0});
    // Real focus loss must still close the stream and release its controller.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(async () => (await diagnostics()).streamClosed).toBe(1);
  } finally { await page.close(); }
}, 30_000);

it('ignores an obsolete HTTP frame ACK and acknowledges the replacement image loaded while it was pending', async () => {
  const page = await pageFor('stream-clear-race');
  const step = async (name: string) => page.getByRole('button', { name, exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  const diagnostics = async () => JSON.parse((await page.getByTestId('stream-diagnostics').textContent())!);
  try {
    await step('Hold ACK'); await step('Layout ready');
    await expect.poll(async () => (await diagnostics()).presentationAcks).toBe(1);
    await step('Stream clear'); await page.locator('.verification-image img').waitFor({state:'detached'});
    await step('Layout ready'); await page.locator('.verification-image img').waitFor();
    expect(await page.getByRole('button', {name:'我来操作',exact:true}).isEnabled()).toBe(false);
    await step('Release ACK');
    await expect.poll(async () => (await diagnostics()).presentationAcks).toBe(2);
    await expect.poll(() => page.getByRole('button', {name:'我来操作',exact:true}).isEnabled()).toBe(true);
    expect(await diagnostics()).toMatchObject({streamCreated:1,streamClosed:0,resumeCommands:0});
  } finally { await page.close(); }
}, 30_000);

it.each([
  'settling','handoff','rechecking',
])('stops the image stream without reconnecting during %s and resumes only in an interactive phase',async phase=>{
  const page=await pageFor(`stream-phase-${phase}`);
  const step=async(name:string)=>page.getByRole('button',{name,exact:true}).evaluate(button=>(button as HTMLButtonElement).click());
  const diagnostics=async()=>JSON.parse((await page.getByTestId('stream-diagnostics').textContent())!);
  try{
    await step('Layout ready'); await expect.poll(async()=>(await diagnostics()).presentationAcks).toBe(1);
    await step('Result phase'); await page.locator(`[data-state="${phase}"]`).waitFor();
    await expect.poll(async()=>(await diagnostics()).streamClosed).toBe(1);
    await page.waitForTimeout(2300);
    expect(await diagnostics()).toMatchObject({streamCreated:1,streamClosed:1});
    expect(await page.getByText('验证画面连接中断，正在尝试重新连接。',{exact:true}).count()).toBe(0);
    await step('Layout ready'); await expect.poll(async()=>(await diagnostics()).presentationAcks).toBe(2);
    expect(await diagnostics()).toMatchObject({streamCreated:2,streamClosed:1});
  }finally{await page.close();}
},30_000);

it('ignores an old renewal rejection and socket error after the result phase has opened a new stream',async()=>{
  const page=await pageFor('stream-phase-settling');
  const step=async(name:string)=>page.getByRole('button',{name,exact:true}).evaluate(button=>(button as HTMLButtonElement).click());
  const diagnostics=async()=>JSON.parse((await page.getByTestId('stream-diagnostics').textContent())!);
  try{
    await step('Layout ready');await expect.poll(async()=>(await diagnostics()).presentationAcks).toBe(1);
    await step('Hold reserve');await expect.poll(async()=>(await diagnostics()).pendingReserves,{timeout:5000}).toBe(1);
    await step('Result phase');await page.locator('[data-state="settling"]').waitFor();
    await expect.poll(async()=>(await diagnostics()).streamClosed).toBe(1);
    await step('Layout ready');await expect.poll(async()=>(await diagnostics()).presentationAcks).toBe(2);
    const claim=page.getByRole('button',{name:'我来操作',exact:true});await expect.poll(()=>claim.isEnabled()).toBe(true);
    await step('Reject old connection');await page.waitForTimeout(100);
    expect(await claim.isEnabled()).toBe(true);
    expect(await page.getByText('验证画面连接中断，正在尝试重新连接。',{exact:true}).count()).toBe(0);
    expect(await diagnostics()).toMatchObject({streamCreated:2,streamClosed:1,pendingReserves:0});
  }finally{await page.close();}
},30_000);

it.each([
  {suffix:'race',expectedClaims:2,granted:true},
  {suffix:'expired',expectedClaims:1,granted:false},
  {suffix:'owner',expectedClaims:1,granted:false},
  {suffix:'state',expectedClaims:1,granted:false},
  {suffix:'repeat',expectedClaims:2,granted:false},
])('bounds an explicit claim version refresh: $suffix', async scenario => {
  const page = await pageFor(`claim-version-${scenario.suffix}`);
  try {
    await page.getByRole('button',{name:'Layout ready',exact:true}).evaluate(button=>(button as HTMLButtonElement).click());
    const claim=page.getByRole('button',{name:'我来操作',exact:true});
    await expect.poll(()=>claim.isEnabled()).toBe(true);
    await claim.click();
    if(scenario.granted)await page.locator('[data-state="human_active"]').waitFor();
    else await page.getByRole('alert').filter({hasText:'状态已变化'}).waitFor();
    const diagnostics=JSON.parse((await page.getByTestId('stream-diagnostics').textContent())!);
    expect(diagnostics.claimCommands).toBe(scenario.expectedClaims);
    expect(await page.locator('[data-state="human_active"]').count()).toBe(scenario.granted?1:0);
  } finally {await page.close();}
},30_000);

it.each([
  {scenario:'title-known',expected:'Account B'},
  {scenario:'title-unknown',expected:'闲鱼账号'},
])('shows only the account display name or a plain fallback: $scenario',async({scenario,expected})=>{
  const page=await pageFor(scenario);
  try{
    await expect.poll(()=>page.locator('.verification-modal h2').textContent()).toBe(expected);
    expect(await page.locator('.verification-modal h2').textContent()).not.toContain('seller-private-123');
    expect(await page.locator('.verification-modal h2').textContent()).not.toContain('account-b');
  }finally{await page.close();}
},30_000);

it.each([
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'low-screen', width: 390, height: 360 },
])('keeps the $name outer dialog fixed and scrolls only overflowing content', async viewport => {
  const page = await pageFor('layout'); await page.setViewportSize(viewport);
  const dimensions = async () => page.evaluate(() => {
    const modal = document.querySelector('.verification-modal')!, body = document.querySelector('.verification-modal-body');
    const slot = document.querySelector('.verification-image'), image = slot?.querySelector('img');
    const box = modal.getBoundingClientRect(), picture = slot?.getBoundingClientRect(), pixels = image?.getBoundingClientRect();
    return { top: box.top, height: box.height, bottom: box.bottom, width: box.width, slotTop: picture?.top, slotHeight: picture?.height,
      imageWidth: pixels?.width, imageHeight: pixels?.height, bodyHeight: body?.clientHeight, bodyScrollHeight: body?.scrollHeight,
      bodyOverflow: body ? getComputedStyle(body).overflowY : undefined, documentWidth: document.documentElement.scrollWidth };
  });
  const step = async (name: string) => page.getByRole('button', { name, exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  try {
    const preparing = await dimensions();
    expect(preparing.height).toBe(Math.min(540, viewport.height - 56));
    await step('Layout ready'); await page.locator('.verification-image img').waitFor();
    const ready = await dimensions();
    expect(ready.imageWidth).toBeLessThanOrEqual(420); expect(ready.imageHeight).toBeLessThanOrEqual(320);
    expect(ready.imageWidth! / ready.imageHeight!).toBeCloseTo(420 / 320, 2);
    await page.locator('.verification-image img').scrollIntoViewIfNeeded();
    expect(await page.locator('.verification-image img').evaluate(image => {
      const pixels = image.getBoundingClientRect(), viewport = document.querySelector('.verification-modal-body')!.getBoundingClientRect();
      return pixels.top >= viewport.top - 1 && pixels.bottom <= viewport.bottom + 1;
    })).toBe(true);
    await page.locator('.verification-modal-body').evaluate(body => { body.scrollTop = 0; });
    await page.screenshot({path:join(tmpdir(), `xianyu-verification-fixed-height-${viewport.name}.png`)});
    await step('Layout reconnect'); await page.locator('.verification-image img').waitFor({state:'detached'});
    const reconnecting = await dimensions();
    await step('Layout fail'); await page.locator('[data-state="failed"]').waitFor();
    const failed = await dimensions();
    await page.screenshot({path:join(tmpdir(), `xianyu-verification-fixed-height-${viewport.name}-failed.png`)});
    for (const state of [ready, reconnecting, failed]) {
      expect(state.height).toBe(preparing.height); expect(state.top).toBeCloseTo(preparing.top, 1);
      expect(state.bottom).toBeLessThanOrEqual(viewport.height); expect(state.documentWidth).toBeLessThanOrEqual(viewport.width);
    }
    // The result now fills the available area with a centered outcome, while
    // keeping the footer at the bottom of the same fixed-height dialog.
    expect(await page.locator('.verification-outcome-copy').evaluate(element => {
      const copy = element.getBoundingClientRect(), slot = element.parentElement!.getBoundingClientRect();
      return Math.abs((copy.top + copy.bottom - slot.top - slot.bottom) / 2);
    })).toBeLessThan(2);
    if(viewport.name!=='low-screen')for(const state of [preparing,ready,reconnecting,failed]){
      expect(state.bodyScrollHeight!,JSON.stringify(state)).toBeLessThanOrEqual(state.bodyHeight!);
    }
    await page.getByRole('button', {name:'我来重试',exact:true}).scrollIntoViewIfNeeded();
    expect((await dimensions()).height).toBe(preparing.height);
    await step('Layout long result');
    await expect.poll(()=>page.locator('.verification-results li').count()).toBe(12);
    const longResult=await dimensions();
    expect(longResult.bodyOverflow).toBe('auto'); expect(longResult.bodyScrollHeight!).toBeGreaterThan(longResult.bodyHeight!);
    await page.locator('.verification-results li').last().scrollIntoViewIfNeeded();
    expect(await page.locator('.verification-modal-body').evaluate(body => body.scrollTop)).toBeGreaterThan(0);
    expect((await dimensions()).height).toBe(preparing.height);
    layoutEvidence.push({viewport, preparing, ready, reconnecting, failed,longResult});
  } finally { await page.close(); }
}, 30_000);
