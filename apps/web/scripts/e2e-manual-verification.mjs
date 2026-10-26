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
const fixture = await createVerificationServiceFixture({ databaseUrl, nativeChallenge: true });
const viteCache = await mkdtemp(join(tmpdir(), 'xianyu-verification-vite-'));
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
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const pointerTrace = [];
  page.on('websocket', socket => {
    socket.on('framesent', ({ payload }) => { try { const value = JSON.parse(String(payload)); if (value.type === 'pointer') pointerTrace.push({ direction:'sent', action:value.action, x:value.x, y:value.y }); } catch {} });
    socket.on('framereceived', ({ payload }) => { try { const value = JSON.parse(String(payload)); if (value.type === 'input-ack') pointerTrace.push({ direction:'ack', accepted:value.accepted, reason:value.reason }); } catch {} });
  });
  const wait = async (read, predicate, label, timeout = 20_000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(`Timed out: ${label}\n${(await page.locator('body').innerText()).slice(-1800)}`);
  };
  await page.goto(`${webUrl}/accounts`); await page.bringToFront();
  await page.getByRole('button', { name: '重试', exact: true }).click();
  const panel = page.getByTestId('verification-panel');
  const claim = panel.getByRole('button', { name: '我来操作', exact: true });
  await wait(() => claim.isEnabled().catch(() => false), Boolean, 'decoded visible fresh frame and stream');
  assert.match(await page.locator('.verification-modal h2').innerText(), /受控验证账号/);
  const row = await wait(async () => (await fixture.runtime.verification.coordinator.repository.list()).find(s => s.subject.accountId === fixture.account.id), Boolean, 'persisted verification session');
  assert.equal(row.mode, 'manual_only'); assert.equal(row.state, 'priority_wait');
  const claimSentAt = Date.now();
  await claim.click();
  await wait(() => panel.getAttribute('data-state'), state => state === 'human_active', 'human controller granted');
  const controlled = await fixture.runtime.verification.coordinator.repository.get(row.id);
  const claimObservedAt = Date.now();
  assert.ok(controlled.humanDeadline >= claimSentAt + 30_000 && controlled.humanDeadline <= claimObservedAt + 30_000,
    'the 30-second deadline is established during claim, independently of later row updates');
  assert.equal(controlled.autoAttempts, 0);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, 'human-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(evidence, 'human-mobile.png') });
  const image = panel.getByRole('img', { name: '闲鱼原会话验证画面' });
  const box = await image.boundingBox(); assert.ok(box && box.width > 100);
  const original = fixture.contexts[0].pages()[0];
  assert.equal(fixture.contexts[0].pages().length, 1, 'native iframe stays inside the original page');
  assert.equal(original.frames().filter(frame => frame.parentFrame()).length, 1, 'the platform challenge is actually embedded');
  const { start, end } = fixture.pointer;
  const touch = await context.newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * start.x, y: box.y + box.height * start.y }] });
  for (let step = 1; step <= 12; step++) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * (start.x + (end.x - start.x) * step / 12), y: box.y + box.height * (start.y + (end.y - start.y) * step / 12) }] });
    await page.waitForTimeout(35);
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
  try { await wait(() => panel.getAttribute('data-state'), state => state === 'succeeded', 'platform result through persisted credentials and actual heartbeat', 30_000); }
  catch (error) { console.error('completed pointer trace', JSON.stringify(pointerTrace)); throw error; }
  const final = await fixture.runtime.verification.coordinator.repository.get(row.id);
  const account = await fixture.runtime.store.getAccount(fixture.admin.id, fixture.account.id);
  const credential = await fixture.runtime.store.getCredential(fixture.admin.id, fixture.account.id);
  const risks = await fixture.runtime.store.listAccountVerificationRisks(fixture.admin.id, fixture.account.id);
  assert.equal(final.state, 'succeeded'); assert.equal(final.autoAttempts, 0);
  assert.equal(account.transportStatus, 'connected'); assert.ok(Date.parse(account.transportSeenAt) > Date.now() - 15_000);
  assert.equal(risks.length, 0); assert.equal(credential.accessToken, 'fixture-access');
  assert.ok(fixture.stats.slideAnswers >= 1); assert.ok(fixture.stats.registrations >= 1); assert.ok(fixture.stats.heartbeats >= 1);
  assert.equal(fixture.contexts.length, 1, 'the original server browser is reused throughout');
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.screenshot({ path: join(evidence, 'success-mobile.png') });
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ kind: 'controlled-platform-real-ui-api-pg-chrome-ws', state: final.state,
    nativeIframe: true, inputType: 'touch',
    configuredHumanWindowMs: 30_000, humanDeadlineOffsetBoundsMs: [controlled.humanDeadline - claimObservedAt, controlled.humanDeadline - claimSentAt], automaticGestures: final.autoAttempts, platformAnswers: fixture.stats.slideAnswers,
    registrations: fixture.stats.registrations, heartbeatAcks: fixture.stats.heartbeats, remainingRisks: risks.length,
    transportStatus: account.transportStatus, pageErrors: errors, productionPlatformVerified: false }, null, 2));
  console.log('manual verification real UI → API → PG → original Chrome → token CAS → matched IM heartbeat PASS');
} catch (error) {
  console.error('verification E2E diagnostics', JSON.stringify(fixture.stats));
  throw error;
} finally {
  await browser?.close(); await vite?.close(); await fixture.close();
  if (dirname(resolve(viteCache)) !== resolve(tmpdir()) || !basename(viteCache).startsWith('xianyu-verification-vite-')) throw new Error('unexpected Vite cache path');
  await rm(viteCache, { recursive: true, force: true });
}
