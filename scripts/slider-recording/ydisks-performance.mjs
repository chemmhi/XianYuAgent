import assert from 'node:assert/strict';
import { chromium } from 'patchright';
import { createRecordingStore } from './store.mjs';
import { installBrowserRecording } from './browser.mjs';
import { createTarProfileSnapshot } from './profile-archive.mjs';
const store = createRecordingStore(process.env.XIANYU_RECORD_DIR);
await installBrowserRecording(store, { snapshotProfile: createTarProfileSnapshot(store),
  traceOptions: { screenshots: false, snapshots: false, sources: true } });
const context = await chromium.launchPersistentContext('/browser-data/performance-only', { channel: 'chrome', headless: false,
  viewport: { width: 1440, height: 900 }, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.setContent('<div style="margin:100px;width:300px;height:34px;background:#ddd">Recorder timing fixture</div>');
  await page.evaluate(() => { window.__inputs = []; document.addEventListener('pointermove', e => window.__inputs.push({ x: e.clientX, y: e.clientY, time: e.timeStamp, trusted: e.isTrusted })); });
  await page.waitForTimeout(500);
  await page.mouse.move(100, 100);
  const started = performance.now();
  await page.mouse.down();
  for (let i = 1; i <= 90; i++) await page.mouse.move(100 + i * 256 / 90, 100);
  await page.mouse.up();
  const elapsedMs = performance.now() - started;
  const inputs = await page.evaluate(() => window.__inputs);
  store.json('performance.json', { elapsedMs, inputs, steps: 90, platformAcceptanceTest: false });
  assert.equal(inputs.filter(e => e.x > 100).length, 90);
  assert.ok(elapsedMs < 3000, `Recording distorted 90 mouse moves: ${elapsedMs}ms`);
  await context.route('https://www.goofish.com/partition-fixture', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Local cookie partition contract fixture</p>' }));
  const cookieBase = { value: 'synthetic', domain: '.goofish.com', path: '/', secure: true, sameSite: 'None', partitionKey: 'https://goofish.com' };
  await context.addCookies([{ ...cookieBase, name: 'default_partition_test' },
    { ...cookieBase, name: 'same_site_partition_test', _crHasCrossSiteAncestor: false }]);
  await page.goto('https://www.goofish.com/partition-fixture');
  const documentCookies = await page.evaluate(() => document.cookie);
  const snapshot = await context.cookies();
  store.json('partition-contract.json', { syntheticData: true, documentCookies, snapshot });
  assert.match(documentCookies, /same_site_partition_test=synthetic/);
  assert.doesNotMatch(documentCookies, /default_partition_test=/);
  console.log(JSON.stringify({ passed: true, elapsedMs, steps: 90, cookiePartitionContract: true, platformAcceptanceTest: false }));
} finally { await context.close(); }
