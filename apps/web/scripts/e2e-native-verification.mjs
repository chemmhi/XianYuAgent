import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { chromium } from 'patchright';
import { createVerificationServiceFixture } from '../../api/scripts/verification-service-fixture.ts';

const databaseUrl = process.env.MANUAL_VERIFICATION_UI_DATABASE_URL;
if (!databaseUrl || !['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)
  || new URL(databaseUrl).pathname !== '/xianyu_manual_verification_ui_test') throw new Error('isolated verification UI DB required');
const fixture = await createVerificationServiceFixture({ databaseUrl, nativeChallenge: true, nativeFrontend: true });
const viteCache = await mkdtemp(join(tmpdir(), 'xianyu-native-vite-'));
const evidence = join(import.meta.dirname, '../../../docs/evidence/manual-verification');
let vite, browser;
try {
  process.env.VITE_API_MODE = 'live'; process.env.VITE_API_PROXY_TARGET = fixture.baseUrl;
  vite = await createServer({ root: join(import.meta.dirname, '..'), cacheDir: viteCache, server: { host: '127.0.0.1', port: 0 } }); await vite.listen();
  const webUrl = `http://127.0.0.1:${vite.httpServer.address().port}`;
  fixture.runtime.config.webSocketAllowedOrigins.push(webUrl);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: 'session_id', value: fixture.session.id, url: webUrl }, { name: 'csrf_token', value: fixture.csrf, url: webUrl }]);
  let nativeLoads = 0, frontendSlides = 0, nativeResults = 0, streamConnections = 0, pointerFrames = 0;
  await context.route('https://h5api.m.goofish.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/_____tmd_____/punish')) { nativeLoads++; await route.fulfill({ contentType: 'text/html', body: fixture.nativeChallengeHtml }); }
    else if (url.pathname === '/slide') { frontendSlides++; await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, success: true }) }); }
    else await route.fulfill({ body: 'controlled native request' });
  });
  const page = await context.newPage(), errors = [], noStore = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().endsWith('/native/result')) nativeResults++; });
  page.on('response', response => { if (/\/native\/(claim|result)$/.test(response.url())) noStore.push(response.headers()['cache-control']); });
  page.on('websocket', socket => { if (socket.url().includes('/stream?')) streamConnections++;
    socket.on('framesent', ({ payload }) => { try { if (JSON.parse(String(payload)).type === 'pointer') pointerFrames++; } catch {} }); });
  const wait = async (read, predicate, label, timeout = 20_000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(`Timed out: ${label}\n${(await page.locator('body').innerText()).slice(-1800)}`);
  };
  await page.goto(`${webUrl}/accounts`); await page.bringToFront();
  await page.getByRole('button', { name: '我来重试', exact: true }).click();
  const panel = page.getByTestId('verification-panel'), claim = panel.getByRole('button', { name: '我来操作', exact: true });
  await wait(() => claim.isEnabled().catch(() => false), Boolean, 'native presentation lease');
  const row = await wait(async () => (await fixture.runtime.verification.coordinator.repository.list()).find(s => s.subject.accountId === fixture.account.id), Boolean, 'persisted verification');
  assert.equal(row.presentationKind, 'native_iframe');
  assert.equal(row.mode, 'manual_only');
  const uiCookies = await context.cookies(webUrl), csrfToken = uiCookies.find(cookie => cookie.name === 'csrf_token').value;
  const authCookie = uiCookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  const post = (body, auth = true, csrf = true) => fetch(`${fixture.baseUrl}/api/v1/verification-sessions/${row.id}/native/claim`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { cookie: authCookie } : {}), ...(csrf ? { 'x-csrf-token': csrfToken } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post({}, false)).status, 401);
  assert.equal((await post({}, true, false)).status, 403);
  assert.equal((await post({ clientInstanceId: 'bad', challengeGeneration: 1 })).status, 422);
  const beforeClaim = Date.now(); await claim.click();
  const frameElement = page.locator('iframe[title="闲鱼原生安全验证"]'); await frameElement.waitFor();
  const controlled = await fixture.runtime.verification.coordinator.repository.get(row.id);
  assert.ok(controlled.humanDeadline >= beforeClaim + 30_000 && controlled.humanDeadline <= Date.now() + 30_000);
  assert.equal(controlled.autoAttempts, 0);
  const iframeIdentity = await frameElement.elementHandle();
  const child = await iframeIdentity.contentFrame();
  await child.waitForURL('**/_____tmd_____/punish?**'); await child.locator('#nc_1_n1z').waitFor();
  assert.ok(child.url().includes('addCookieToHeader=1'));
  assert.equal(fixture.contexts[0].pages()[0].frames().filter(frame => frame.parentFrame()).length, 0, 'human challenge is not rendered in the backend');
  await page.evaluate(() => window.postMessage(JSON.stringify({ type: 'child', content: JSON.stringify({ x5sec: JSON.stringify({ value: 'forged', expire: String(Date.now()+60000), host: 'h5api.m.goofish.com' }) }) }), '*'));
  await child.evaluate(() => parent.postMessage(JSON.stringify({ type: 'child', content: JSON.stringify({ smToken: 'token', queryToken: 'sm', sm: 'sm' }) }), '*'));
  await page.waitForTimeout(150); assert.equal(nativeResults, 0, 'wrong source and placeholder messages cannot hand off');
  await mkdir(evidence, { recursive: true });
  const layouts = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 700 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(120);
    const layout = await page.locator('.verification-modal').evaluate(element => {
      const body = element.querySelector('.verification-modal-body'), frame = element.querySelector('iframe'), surface = element.querySelector('.verification-image');
      const f = frame.getBoundingClientRect(), s = surface.getBoundingClientRect();
      return { height: element.getBoundingClientRect().height, scroll: body.scrollHeight - body.clientHeight,
        frameFits: f.left >= s.left-1 && f.right <= s.right+1 && f.top >= s.top-1 && f.bottom <= s.bottom+1,
        ratio: f.width / f.height, title: element.querySelector('h2').textContent };
    });
    assert.equal(layout.height, 540); assert.ok(layout.scroll <= 1, `unexpected modal scroll ${layout.scroll}`);
    assert.equal(layout.frameFits, true); assert.ok(Math.abs(layout.ratio - 420/320) < .001);
    assert.equal(layout.title, '受控验证账号'); layouts.push({ viewport, ...layout });
    await page.screenshot({ path: join(evidence, `native-human-${viewport.width}.png`) });
  }
  const handle = child.locator('#nc_1_n1z'), start = await handle.boundingBox(); assert.ok(start);
  // Patchright child boundingBox does not include the iframe CSS transform;
  // use the real viewport transform for the driver's physical mouse position.
  const nativeRect = await handle.evaluate(element => element.getBoundingClientRect().toJSON());
  const viewportBox = await frameElement.boundingBox(), viewScale = viewportBox.width / 420;
  const mouseStart = { x: viewportBox.x + (nativeRect.x + nativeRect.width/2)*viewScale,
    y: viewportBox.y + (nativeRect.y + nativeRect.height/2)*viewScale };
  await page.mouse.move(mouseStart.x, mouseStart.y); await page.mouse.down();
  await page.mouse.move(mouseStart.x + 45, mouseStart.y, { steps: 6 });
  await page.waitForTimeout(1_200);
  assert.ok((await handle.boundingBox()).x > start.x + 20, 'the actual native DOM handle moves while held');
  assert.equal(await frameElement.evaluate((node, original) => node === original, iframeIdentity), true, 'lease renewal preserves the same iframe/window');
  assert.equal((await fixture.runtime.verification.coordinator.repository.get(row.id)).humanDeadline, controlled.humanDeadline);
  const frameBox = await frameElement.boundingBox();
  await page.mouse.move(frameBox.x + frameBox.width * 345/420, frameBox.y + frameBox.height * 210/320, { steps: 18 }); await page.mouse.up();
  await wait(() => panel.getAttribute('data-state'), state => state === 'succeeded', 'native candidate → original backend token/identity/CAS/IM', 30_000);
  const final = await fixture.runtime.verification.coordinator.repository.get(row.id), account = await fixture.runtime.store.getAccount(fixture.admin.id, fixture.account.id);
  const credential = await fixture.runtime.store.getCredential(fixture.admin.id, fixture.account.id);
  const risks = await fixture.runtime.store.listAccountVerificationRisks(fixture.admin.id, fixture.account.id);
  assert.equal(final.state, 'succeeded'); assert.equal(final.platformResult, undefined); assert.equal(final.resultCandidateReceived, true);
  assert.equal(final.autoAttempts, 0); assert.equal(account.transportStatus, 'connected'); assert.ok(Date.parse(account.transportSeenAt) > Date.now()-15_000);
  assert.equal(credential.accessToken, 'fixture-access'); assert.match(credential.cookieHeader, /x5sec=native-frontend-passed/); assert.match(credential.cookieHeader, /x5sectag=fixture-context/);
  assert.equal(risks.length, 0); assert.ok(fixture.stats.registrations >= 1 && fixture.stats.heartbeats >= 1);
  assert.equal(nativeLoads, 1); assert.equal(frontendSlides, 1); assert.equal(nativeResults, 1); assert.equal(streamConnections, 0); assert.equal(pointerFrames, 0);
  assert.equal(fixture.stats.pointerDowns, 0); assert.equal(fixture.contexts.length, 1); assert.deepEqual(errors, []);
  assert.ok(noStore.length >= 2 && noStore.every(value => value === 'no-store'));
  const persisted = await fixture.runtime.store.pool.query('select data from accounts.verification_sessions where id=$1', [row.id]);
  assert.doesNotMatch(JSON.stringify(persisted.rows), /native-frontend-passed|x5secdata|addCookieToHeader/);
  await page.screenshot({ path: join(evidence, 'native-success-mobile.png') });
  assert.equal(await panel.getByRole('button', { name: '我来重试', exact: true }).count(), 0, 'success must not offer a new challenge');
  const completedRounds = (await fixture.runtime.verification.coordinator.repository.list()).length;
  await panel.getByRole('button', { name: '完成', exact: true }).click();
  await page.locator('.verification-modal').waitFor({ state: 'detached' });
  assert.equal((await fixture.runtime.verification.coordinator.repository.list()).length, completedRounds, 'completing the dialog creates no verification round');
  assert.equal(nativeResults, 1);
  await writeFile(join(evidence, 'native-result.json'), JSON.stringify({ kind: 'controlled-native-iframe-real-ui-api-pg-original-chrome-im',
    state: final.state, automaticGestures: final.autoAttempts, frontendSlides, nativeResults, nativeLoads, streamConnections, pointerFrames,
    humanWindowMs: 30_000, registrations: fixture.stats.registrations, heartbeatAcks: fixture.stats.heartbeats, remainingRisks: risks.length,
    transportStatus: account.transportStatus, layouts, productionPlatformVerified: false }, null, 2));
  console.log('native iframe real UI → HTTP → PG → original backend Chrome → token/identity/CAS → IM heartbeat PASS');
} catch (error) { console.error('controlled-native diagnostics', JSON.stringify(fixture.stats)); throw error; }
finally {
  await browser?.close(); await vite?.close(); await fixture.close();
  if (dirname(resolve(viteCache)) !== resolve(tmpdir()) || !basename(viteCache).startsWith('xianyu-native-vite-')) throw new Error('unexpected cache path');
  await rm(viteCache, { recursive: true, force: true });
}
