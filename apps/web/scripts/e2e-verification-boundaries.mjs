import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { chromium } from 'patchright';
import { createVerificationServiceFixture } from '../../api/scripts/verification-service-fixture.ts';

const databaseUrl = process.env.MANUAL_VERIFICATION_UI_DATABASE_URL;
if (!databaseUrl || !['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname)
  || new URL(databaseUrl).pathname !== '/xianyu_manual_verification_ui_test') throw new Error('isolated verification UI DB required');
const evidence = join(import.meta.dirname, '../../../docs/evidence/manual-verification');
const results = [];
async function scenario(name, run, options = {}) {
  const f = await createVerificationServiceFixture({ databaseUrl, ...options }); let vite, browser, page;
  const viteCache = await mkdtemp(join(tmpdir(), 'xianyu-verification-vite-'));
  const errors = [];
  try {
    process.env.VITE_API_MODE = 'live';
    vite = await createServer({ root: join(import.meta.dirname, '..'), cacheDir: viteCache, server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: f.baseUrl, changeOrigin: false, ws: true } } } }); await vite.listen();
    const webUrl = `http://127.0.0.1:${vite.httpServer.address().port}`; f.runtime.config.webSocketAllowedOrigins.push(webUrl);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([{ name: 'session_id', value: f.session.id, url: webUrl }, { name: 'csrf_token', value: f.csrf, url: webUrl }]);
    page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const wait = async (read, match, label, timeout = 15_000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) { const value = await read(); if (match(value)) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
      throw new Error(`${name}: ${label}\n${(await page.locator('body').innerText()).slice(-1500)}`);
    };
    await page.goto(`${webUrl}/accounts`); await page.bringToFront();
    const panel = page.getByTestId('verification-panel');
    const row = async () => (await f.runtime.verification.coordinator.repository.list()).filter(s => s.subject.accountId === f.account.id).sort((a, b) => b.createdAt - a.createdAt)[0];
    const start = async () => {
      await page.getByRole('button', { name: '我来重试', exact: true }).click();
      await wait(() => panel.getByRole('button', { name: '我来操作', exact: true }).isEnabled().catch(() => false), Boolean, 'claim readiness');
    };
    const claim = async () => { await panel.getByRole('button', { name: '我来操作', exact: true }).click(); await wait(() => panel.getAttribute('data-state'), v => v === 'human_active', 'human active'); };
    const image = panel.getByRole('img', { name: '闲鱼原会话验证画面' });
    await run({ f, page, context, webUrl, panel, image, row, wait, start, claim });
    assert.deepEqual(errors, []); results.push({ name, status: 'PASS', pageErrors: 0 }); console.log(`${name} PASS`);
  } catch (error) {
    if (errors.length) console.error('page errors', JSON.stringify(errors));
    await mkdir(evidence, { recursive: true }); await page?.screenshot({ path: join(evidence, `failure-${name}.png`) }).catch(() => undefined); throw error;
  } finally {
    await browser?.close(); await vite?.close(); await f.close();
    if (dirname(resolve(viteCache)) !== resolve(tmpdir()) || !basename(viteCache).startsWith('xianyu-verification-vite-')) throw new Error('unexpected Vite cache path');
    await rm(viteCache, { recursive: true, force: true });
  }
}

await scenario('late-claim-after-pointer-up', async ({ f, page, panel, image, start, wait, row }) => {
  await start();
  await page.route('**/api/v1/verification-sessions/*/claim', async route => { const response = await route.fetch(); await new Promise(resolve => setTimeout(resolve, 400)); await route.fulfill({ response }); });
  const box = await image.boundingBox(); assert.ok(box);
  await page.mouse.move(box.x + box.width * 0.06, box.y + box.height / 2); await page.mouse.down(); await page.mouse.up();
  await wait(() => panel.innerText(), text => text.includes('接管成功，请松开后重新拖动'), 'safe late ACK guidance');
  assert.equal((await row()).state, 'human_active');
  assert.equal(f.stats.pointerDowns, 0, 'a released candidate down must never be replayed'); assert.equal(f.stats.slideAnswers, 0);
});

await scenario('direct-pointer-claims-before-injection', async ({ f, page, panel, image, start, wait }) => {
  await start(); const box = await image.boundingBox(); assert.ok(box);
  await page.mouse.move(box.x + box.width * 0.06, box.y + box.height / 2); await page.mouse.down();
  await wait(async () => f.stats.pointerDowns, n => n === 1, 'ACK-admitted candidate down');
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 12 }); await page.mouse.up();
  await wait(() => panel.getAttribute('data-state'), v => v === 'succeeded', 'direct gesture business recovery');
});

await scenario('native-mouse-down-keeps-stream-and-control', async ({ f, page, panel, image, start, claim, row, wait }) => {
  const streams = [], acknowledgements = [];
  page.on('websocket', ws => {
    if (!ws.url().includes('/stream?')) return;
    const record = { closed: false }; streams.push(record);
    ws.on('close', () => { record.closed = true; });
    ws.on('framereceived', ({ payload }) => {
      try { const value = JSON.parse(String(payload)); if (value.type === 'input-ack') acknowledgements.push(value); } catch {}
    });
  });
  await start(); await claim();
  const deadline = (await row()).humanDeadline, box = await image.boundingBox(); assert.ok(box);
  const { start: from, end: to } = f.pointer;
  await page.mouse.move(box.x + box.width * from.x, box.y + box.height * from.y);
  await page.mouse.down();
  await wait(() => Promise.resolve(acknowledgements.some(a => a.accepted)), Boolean, 'mouse-down admitted');
  await page.waitForTimeout(600);
  assert.equal(streams.length, 1, 'pressing the native slider must keep its stream');
  assert.equal(streams[0].closed, false); assert.equal((await row()).reconnectDeadline, undefined);
  assert.equal((await row()).humanDeadline, deadline);
  assert.equal(await panel.getAttribute('data-state'), 'human_active');
  for (let step = 1; step <= 12; step++) {
    await page.mouse.move(box.x + box.width * (from.x + (to.x - from.x) * step / 12), box.y + box.height * (from.y + (to.y - from.y) * step / 12));
    await page.waitForTimeout(35);
  }
  await page.mouse.up();
  await wait(() => panel.getAttribute('data-state'), v => v === 'succeeded', 'mouse gesture business recovery');
  assert.ok(acknowledgements.length >= 3);
  assert.deepEqual(acknowledgements.filter(a => !a.accepted).map(a => a.reason), []);
  assert.equal(f.stats.slideAnswers, 1); assert.equal((await row()).autoAttempts, 0);
}, { nativeChallenge: true });

await scenario('platform-300-keeps-human-window-for-native-refresh', async ({ f, page, panel, image, start, claim, row, wait }) => {
  await start(); await claim();
  const initial = await row(), original = f.contexts[0].pages()[0];
  const challengeFrame = original.frames().find(frame => frame.parentFrame()); assert.ok(challengeFrame);
  const drag = async () => {
    const box = await image.boundingBox(); assert.ok(box);
    const {start: from,end: to}=f.pointer;
    await page.mouse.move(box.x+box.width*from.x,box.y+box.height*from.y); await page.mouse.down();
    for(let step=1;step<=12;step++) {
      await page.mouse.move(box.x+box.width*(from.x+(to.x-from.x)*step/12),box.y+box.height*(from.y+(to.y-from.y)*step/12));
      await page.waitForTimeout(35);
    }
    await page.mouse.up();
  };
  await drag();
  await wait(row,value=>value.platformResult?.status==='rejected'&&value.platformResult.code===300,'persisted platform rejection');
  await wait(()=>panel.innerText(),text=>text.includes('平台未通过（300）'),'real UI distinguishes platform rejection');
  assert.equal((await row()).state,'human_active'); assert.equal((await row()).humanDeadline,initial.humanDeadline);
  assert.equal((await row()).challengeGeneration,initial.challengeGeneration);
  const risks=await f.runtime.store.listAccountVerificationRisks(f.admin.id,f.account.id); assert.ok(risks.length>0);
  assert.equal((await f.runtime.store.getCredential(f.admin.id,f.account.id)).accessToken,'old-access');
  await wait(()=>challengeFrame.locator('#nc_1_refresh1').isVisible(),Boolean,'native error refresh is visible');
  const oldImage=await image.getAttribute('src').catch(()=>undefined);
  await wait(()=>image.getAttribute('src').catch(()=>undefined),src=>Boolean(src&&src!==oldImage),'safe native error frame displayed');
  await page.waitForTimeout(250); assert.equal(f.stats.refreshes,0,'the system never clicks native refresh');
  const errorImage=await image.getAttribute('src');
  const box=await image.boundingBox(); assert.ok(box); assert.ok(f.refreshPointer);
  await page.mouse.click(box.x+box.width*f.refreshPointer.x,box.y+box.height*f.refreshPointer.y);
  await wait(()=>Promise.resolve(f.stats.refreshes),n=>n===1,'explicit native refresh reaches original context');
  await wait(()=>challengeFrame.locator('#nc_1_n1z').isVisible(),Boolean,'new native handle exists');
  await wait(()=>image.getAttribute('src').catch(()=>undefined),src=>Boolean(src&&src!==errorImage),'native reset has delivered a replacement safe frame');
  await wait(()=>panel.locator('.verification-image.is-controlling img').isVisible().catch(()=>false),Boolean,'new safe frame becomes controllable');
  assert.equal((await row()).humanDeadline,initial.humanDeadline); assert.equal((await row()).challengeGeneration,initial.challengeGeneration);
  await drag(); await wait(()=>panel.getAttribute('data-state'),state=>state==='succeeded','new manual gesture restores business connection');
  assert.equal((await row()).autoAttempts,0); assert.equal(f.stats.slideAnswers,2); assert.equal(f.stats.refreshes,1);
  assert.equal(f.contexts.length,1); assert.equal((await f.runtime.store.listAccountVerificationRisks(f.admin.id,f.account.id)).length,0);
  assert.equal((await f.runtime.store.getAccount(f.admin.id,f.account.id)).transportStatus,'connected');
}, { nativeChallenge:true,rejectFirstSlide:true });

await scenario('blur-releases-and-resume-keeps-deadline', async ({ f, page, context, panel, image, start, claim, row, wait }) => {
  await start(); await claim(); const deadline = (await row()).humanDeadline;
  const box = await image.boundingBox(); await page.mouse.move(box.x + box.width * 0.06, box.y + box.height / 2); await page.mouse.down();
  await wait(async () => f.stats.pointerDowns, n => n === 1, 'original down');
  // Patchright headless reports hasFocus=true for every tab. Exercise the
  // actual blur/focus handlers deterministically, without claiming OS focus QA.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await wait(row, s => Boolean(s.reconnectDeadline), 'window blur enters reconnect grace');
  assert.equal((await row()).state, 'human_active');
  const originalPage = f.contexts[0].pages()[0];
  await wait(() => originalPage.locator('#fixture-pointer-pressed').inputValue(), value => value === 'false', 'original remote mouse released');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await wait(row, s => s.state === 'human_active' && !s.reconnectDeadline, 'resume within original grace');
  assert.equal((await row()).humanDeadline, deadline); assert.equal((await row()).autoAttempts, 0);
  await page.mouse.up();
});

await scenario('duplicate-tab-has-distinct-owner', async ({ f, page, context, webUrl, start, claim, row, wait }) => {
  let eventCloses = 0;
  page.on('websocket', ws => { if (ws.url().includes('/verification-events')) ws.on('close', () => eventCloses++); });
  // Reconnect once under observation so an accidental replacement is visible.
  await page.reload(); await page.bringToFront(); await start(); await claim(); eventCloses = 0;
  const before = await page.evaluate(() => sessionStorage.getItem('xianyu-verification-client'));
  const popup = context.waitForEvent('page'); await page.evaluate(url => { window.open(url, '_blank'); }, `${webUrl}/accounts`);
  const duplicate = await popup; await duplicate.waitForLoadState(); await duplicate.bringToFront();
  const after = await wait(() => duplicate.evaluate(() => sessionStorage.getItem('xianyu-verification-client')), value => Boolean(value && value !== before), 'duplicated storage receives a distinct client');
  assert.notEqual(after, before);
  await page.bringToFront(); await wait(row, s => s.state === 'human_active' && !s.reconnectDeadline, 'original owner resumes');
  assert.equal(eventCloses, 0, 'the duplicate must not replace the existing event connection'); assert.equal((await row()).autoAttempts, 0);
  await duplicate.close();
});

await scenario('visibility-gates-first-frame', async ({ f, page, panel, image, row, wait }) => {
  const opacity = await page.addStyleTag({ content: '.verification-image img{opacity:0!important}' });
  await page.getByRole('button', { name: '我来重试', exact: true }).click(); await image.waitFor();
  await page.waitForTimeout(500); assert.equal((await row()).state, 'preparing'); assert.equal((await row()).priorityDeadline, undefined);
  const box = await image.boundingBox();
  await page.evaluate(rect => { const mask = document.createElement('div'); mask.id = 'verification-fixture-mask'; Object.assign(mask.style, { position: 'fixed', zIndex: '999', left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width * 0.16}px`, height: `${rect.height * 0.3}px`, background: 'white' }); document.body.append(mask); }, box);
  await opacity.evaluate(node => node.remove());
  await page.waitForTimeout(600); assert.equal((await row()).state, 'preparing', 'a partly covered frame cannot consume the priority window');
  await page.locator('#verification-fixture-mask').evaluate(node => node.remove());
  await wait(() => panel.getAttribute('data-state'), v => v === 'priority_wait', 'genuine visible frame acknowledgement');
  assert.equal(f.stats.pointerDowns, 0);
});

await scenario('new-session-reopens-collapsed-dialog', async ({ f, page, panel, row, start, wait }) => {
  await start(); const previous = await row(); await page.getByRole('button', { name: '收起验证弹窗' }).click();
  assert.equal(await panel.count(), 0);
  await f.runtime.verification.cancel(f.account.id);
  await wait(() => page.getByRole('button', { name: '我来重试', exact: true }).count(), n => n === 1, 'cancelled session projected');
  await wait(async () => f.contexts.every(context => context.pages().length === 0), Boolean, 'old original context has closed');
  await page.getByRole('button', { name: '我来重试', exact: true }).click();
  const next = await wait(row, value => value && value.id !== previous.id, 'new persisted session after pending retry');
  await wait(() => panel.getAttribute('data-state'), state => state === 'priority_wait', 'pending manual retry automatically opens the ready next session');
  assert.notEqual(next.id, previous.id);
});

await scenario('human-close-requires-explicit-handoff', async ({ f, page, panel, start, claim, row, wait }) => {
  await start(); await claim();
  await page.getByRole('button', { name: '收起验证弹窗' }).click();
  assert.equal((await row()).state, 'human_active');
  await page.getByRole('button', { name: '继续人工操作', exact: true }).click();
  assert.equal((await row()).state, 'human_active'); assert.equal(await panel.count(), 1);
  await page.getByRole('button', { name: '收起验证弹窗' }).click();
  await page.getByRole('button', { name: '交给系统并关闭', exact: true }).click();
  await wait(() => panel.count(), n => n === 0, 'dialog hides after server releases control');
  assert.notEqual((await row()).state, 'human_active');
  assert.equal(f.stats.pointerDowns, 0);
});

await scenario('masked-pointer-up-still-releases-original', async ({ f, page, image, start, claim, wait }) => {
  await start(); await claim(); const box = await image.boundingBox(); assert.ok(box);
  await page.mouse.move(box.x + box.width * 0.06, box.y + box.height / 2); await page.mouse.down();
  await wait(async () => f.stats.pointerDowns, n => n === 1, 'original mouse down');
  await page.evaluate(rect => { const mask = document.createElement('div'); mask.id = 'verification-fixture-mask'; Object.assign(mask.style, { position:'fixed', zIndex:'999', left:`${rect.x}px`, top:`${rect.y}px`, width:`${rect.width}px`, height:`${rect.height}px`, background:'white' }); document.body.append(mask); }, box);
  await page.mouse.up();
  const originalPage = f.contexts[0].pages()[0];
  await wait(() => originalPage.locator('#fixture-pointer-pressed').inputValue(), value => value === 'false', 'masked up safely releases original button');
  await page.locator('#verification-fixture-mask').evaluate(node => node.remove());
  assert.equal(f.stats.slideAnswers, 0);
});

await mkdir(evidence, { recursive: true }); await writeFile(join(evidence, 'boundaries.json'), JSON.stringify({ dependency: 'real React/API/isolated PG/original Chrome', productionPlatformVerified: false, results }, null, 2));
