import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..', '..', '..');
const children = [];
const profile = join(tmpdir(), `xianyu-agent-product-automation-${process.pid}`);
const screenshotDir = join(root, 'docs', 'evidence', 'product-automation');
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
let apiRuntime;

async function port() { return await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); const value = typeof address === 'object' && address ? address.port : 0; server.close((error) => error ? reject(error) : resolve(value)); }); }); }
function runProcess(command, args, options = {}) { const child = spawn(command, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: command.endsWith('.cmd'), ...options }); child.stdout.on('data', (chunk) => process.stdout.write(`[automation-e2e:${command}] ${chunk}`)); child.stderr.on('data', (chunk) => process.stderr.write(`[automation-e2e:${command}] ${chunk}`)); children.push(child); return child; }
async function waitFor(check, label, timeoutMs = 20000) { const deadline = Date.now() + timeoutMs; let last; while (Date.now() < deadline) { try { const value = await check(); if (value) return value; } catch (error) { last = error; } await new Promise((resolve) => setTimeout(resolve, 120)); } throw new Error(`${label} did not become ready${last ? `: ${last.message}` : ''}`); }
async function cdpClient(debugPort) { const target = await waitFor(async () => { const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`); if (!response.ok) return false; return (await response.json()).find((item) => item.type === 'page' && item.webSocketDebuggerUrl) ?? false; }, 'Chrome CDP'); const socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); }); let nextId = 0; const pending = new Map(); const events = []; socket.addEventListener('message', (event) => { const message = JSON.parse(event.data); if (!message.id) { if (message.method) events.push(message); return; } if (!pending.has(message.id)) return; const entry = pending.get(message.id); pending.delete(message.id); if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result); }); return { socket, events, send: (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }) }; }
async function evaluate(cdp, expression) { const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'browser script failed'); return result.result?.value; }
async function shot(cdp, width, height, name) { await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); const image = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }); mkdirSync(screenshotDir, { recursive: true }); writeFileSync(join(screenshotDir, name), Buffer.from(image.data, 'base64')); }
function cookiesFrom(response) { return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; '); }

async function run() {
  const apiPort = await port(); const webPort = await port(); const debugPort = await port(); const apiUrl = `http://127.0.0.1:${apiPort}`; const webUrl = `http://127.0.0.1:${webPort}`;
  const automationMode = process.env.VITE_AUTOMATION_MODE ?? 'mock';
  const npm = process.env.npm_execpath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm'); const npmArgs = (args) => process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args;
  const apiBuild = runProcess(npm, npmArgs(['--workspace', 'apps/api', 'run', 'build'])); if (await new Promise((resolve) => apiBuild.once('exit', resolve)) !== 0) throw new Error('API build failed');
  const { createApp } = await import(pathToFileURL(join(root, 'apps', 'api', 'dist', 'app.js')).href);
  apiRuntime = createApp({ host: '127.0.0.1', port: apiPort, cookieSecure: false, allowInMemory: true, sessionIdleMs: 1_800_000, sessionAbsoluteMs: 28_800_000, xianyuQrMode: 'stub' }); await apiRuntime.listen(); await waitFor(async () => (await fetch(`${apiUrl}/healthz`)).ok, 'API');
  const bootstrap = await fetch(`${apiUrl}/api/v1/auth/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': `automation-bootstrap-${process.pid}` }, body: JSON.stringify({ email: '1051585831@qq.com', password: 'password-123', displayName: '管理员' }) }); if (!bootstrap.ok) throw new Error(`bootstrap failed: ${bootstrap.status}`);
  const { profile: adminProfile } = (await bootstrap.json()).data;
  const account = await apiRuntime.store.createAccount({ adminId: adminProfile.id, platform: 'xianyu', sellerRef: `automation-${process.pid}`, displayName: '陈陈cc' });
  const productFixtures = [
    { externalProductRef: '1078553391460', title: 'PPT Master pptmaster', priceMinor: 850, coupon: 'delivery', aiPrompt: '', rank: 1 },
    { externalProductRef: '1083390028492', title: '抖音无水印视频下载源码带时间戳的字幕提取', priceMinor: 250, coupon: 'delivery', aiPrompt: '', rank: 2 },
    { externalProductRef: '1082449333831', title: '视频下载及文案提取源码，包教包会', priceMinor: 22000, coupon: 'fixed', aiPrompt: '', rank: 3 },
    { externalProductRef: '1085778944019', title: '婚礼视频，AI婚礼视频制作', priceMinor: 880, coupon: 'fixed', aiPrompt: '', rank: 4 },
  ];
  const products = [];
  for (const fixture of productFixtures) {
    const result = await apiRuntime.store.upsertExternalProduct({ adminId: adminProfile.id, accountId: account.id, syncedAt: '2026-09-19T18:05:00.000Z', item: { externalProductRef: fixture.externalProductRef, title: fixture.title, description: '商品自动化 E2E', categoryCode: 'digital', priceMinor: fixture.priceMinor, xianyuUpdatedAt: '2026-09-19T18:05:00.000Z', xianyuListRank: fixture.rank, imageUrls: [], attributes: {}, sourcePayloadDigest: `automation-${process.pid}-${fixture.rank}` } });
    products.push(result.product);
    const stored = apiRuntime.store.products?.get?.(result.product.id);
    if (stored) { stored.createdAt = '2026-09-19T18:05:00.000Z'; stored.updatedAt = '2026-09-19T18:05:00.000Z'; }
  }
  const [product, secondProduct, thirdProduct, fourthProduct] = products;
  const deliveryBatch = await apiRuntime.store.createCouponBatch({ adminId: adminProfile.id, accountId: account.id, label: '批量数据2', purpose: 'data', deliveryScope: 'buyer_deliverable', metadata: { specCount: 2, deliveryCount: 1 } });
  await apiRuntime.store.importCouponItems({ adminId: adminProfile.id, batchId: deliveryBatch.id, contents: ['DELIVERY-001', 'DELIVERY-002'] });
  const fixedBatch = await apiRuntime.store.createCouponBatch({ adminId: adminProfile.id, accountId: account.id, label: '固定文字', purpose: 'text', deliveryScope: 'buyer_deliverable', metadata: { specCount: 1, deliveryCount: 1 } });
  await apiRuntime.store.importCouponItems({ adminId: adminProfile.id, batchId: fixedBatch.id, contents: ['FIXED-001', 'FIXED-002'] });
  const giftBatch = await apiRuntime.store.createCouponBatch({ adminId: adminProfile.id, accountId: account.id, label: '评价赠品批次 A', purpose: 'data', deliveryScope: 'buyer_deliverable', metadata: { specCount: 1, deliveryCount: 1 } });
  await apiRuntime.store.importCouponItems({ adminId: adminProfile.id, batchId: giftBatch.id, contents: ['GIFT-001'] });
  await apiRuntime.store.createCouponBatch({ adminId: adminProfile.id, accountId: account.id, label: 'API 卡券 · 会员激活码', purpose: 'api', deliveryScope: 'buyer_deliverable', metadata: { deliveryCount: 1, apiConfig: { url: 'https://api.example.test/member/activate', method: 'POST' } } });
  await apiRuntime.store.bindCouponBatch({ adminId: adminProfile.id, batchId: deliveryBatch.id, productId: product.id });
  await apiRuntime.store.bindCouponBatch({ adminId: adminProfile.id, batchId: deliveryBatch.id, productId: secondProduct.id });
  await apiRuntime.store.bindCouponBatch({ adminId: adminProfile.id, batchId: fixedBatch.id, productId: thirdProduct.id });
  await apiRuntime.store.bindCouponBatch({ adminId: adminProfile.id, batchId: fixedBatch.id, productId: fourthProduct.id });
  const deliveryBatchRef = deliveryBatch.sequenceId ?? deliveryBatch.id;
  const fixedBatchRef = fixedBatch.sequenceId ?? fixedBatch.id;
  const giftBatchRef = giftBatch.sequenceId ?? giftBatch.id;
  await apiRuntime.store.updateProductAutomation({ adminId: adminProfile.id, productId: product.id, expectedConfigVersion: 1, config: { paidAutoDelivery: { enabled: true, couponBatchIds: [deliveryBatchRef], autoConfirm: true, maxAttempts: 3, retryBackoffSeconds: 30 }, unpaidAutoReprice: { enabled: false, mode: 'fixed', targetPriceMinor: 990, message: '已为您调整价格，请及时付款', maxAttempts: 3, retryBackoffSeconds: 30 }, reviewGift: { enabled: false, couponBatchIds: [], maxAttempts: 3, retryBackoffSeconds: 30 }, reviewReminder: { enabled: true, firstDelayHours: 72, repeatIntervalHours: 24, maxReminders: 1, message: '商品已经发出，如果使用满意，麻烦帮忙点个好评～' } }, configDigest: `automation-primary-${process.pid}` });
  await apiRuntime.store.updateProductAutomation({ adminId: adminProfile.id, productId: fourthProduct.id, expectedConfigVersion: 1, config: { paidAutoDelivery: { enabled: true, couponBatchIds: [deliveryBatchRef], autoConfirm: true, maxAttempts: 3, retryBackoffSeconds: 30 }, unpaidAutoReprice: { enabled: true, mode: 'fixed', targetPriceMinor: 990, message: '已为您调整价格，请及时付款', maxAttempts: 3, retryBackoffSeconds: 30 }, reviewGift: { enabled: true, couponBatchIds: [giftBatchRef], maxAttempts: 3, retryBackoffSeconds: 30 }, reviewReminder: { enabled: true, firstDelayHours: 72, repeatIntervalHours: 24, maxReminders: 1, message: '商品已经发出，如果使用满意，麻烦帮忙点个好评～' } }, configDigest: `automation-fourth-${process.pid}` });
  const couponProbe = await fetch(`${apiUrl}/api/v1/coupons/batches?accountId=${encodeURIComponent(account.id)}`, { headers: { cookie: cookiesFrom(bootstrap) } });
  console.log(`coupon list probe: ${couponProbe.status} ${await couponProbe.text()}`);
  runProcess(npm, npmArgs(['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)]), { env: { ...process.env, VITE_API_MODE: 'live', VITE_AUTOMATION_MODE: automationMode, VITE_API_PROXY_TARGET: apiUrl } }); await waitFor(async () => (await fetch(`${webUrl}/products`)).ok, 'Vite');
  mkdirSync(profile, { recursive: true }); runProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank']); await waitFor(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'Chrome'); const cdp = await cdpClient(debugPort); await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__automationFetchLog=[]; const __nativeFetch=window.fetch.bind(window); window.fetch=async (...args) => { const response=await __nativeFetch(...args); response.clone().text().then((body)=>window.__automationFetchLog.push({ url:String(args[0]), status:response.status, body })); return response; };' });
  for (const pair of cookiesFrom(bootstrap).split('; ')) { const [name, ...parts] = pair.split('='); if (name) await cdp.send('Network.setCookie', { name, value: parts.join('='), url: `${webUrl}/` }); }
  await cdp.send('Page.navigate', { url: `${webUrl}/accounts` }); await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('账号列表'), 'accounts'); await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('陈陈cc'), 'account row'); await evaluate(cdp, `(() => { const row = Array.from(document.querySelectorAll('[role="row"]')).find((item) => item.textContent?.includes('陈陈cc')); row?.querySelector('[data-testid="account-switch"]')?.click(); return true; })()`); await waitFor(async () => String(await evaluate(cdp, 'localStorage.getItem("xianyu.activeAccountId") ?? ""')) === account.id, 'account selection');
  await cdp.send('Page.navigate', { url: `${webUrl}/products` }); await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('商品目录'), 'products'); await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('PPT Master pptmaster'), 'product row'); await evaluate(cdp, '(() => { document.querySelector(`[aria-label="选择PPT Master pptmaster"]`)?.click(); document.querySelector(`[aria-label="选择婚礼视频，AI婚礼视频制作"]`)?.click(); return true; })()'); await shot(cdp, 1440, 900, '01-products-list-desktop.png'); await shot(cdp, 390, 844, '01-products-list-mobile.png');
  if (!await evaluate(cdp, '(() => { const button = document.querySelector("[data-testid^=product-automation-]"); if (!button) return false; button.click(); return true; })()')) throw new Error('automation action missing'); await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('自动化配置'), 'automation drawer');
  const autoConfirmAudit = await evaluate(cdp, `(() => { const toggle = document.querySelector('[data-testid=auto-confirm-delivery]'); return toggle ? { present: true, pressed: toggle.getAttribute('aria-pressed'), label: toggle.getAttribute('aria-label') } : { present: false }; })()`);
  if (!autoConfirmAudit?.present || !String(autoConfirmAudit.label).includes('自动确认发货')) throw new Error(`auto-confirm switch missing: ${JSON.stringify(autoConfirmAudit)}`);
  if (autoConfirmAudit.pressed !== 'true') await evaluate(cdp, 'document.querySelector("[data-testid=auto-confirm-delivery]")?.click()');
  const enabledAutoConfirm = await evaluate(cdp, 'document.querySelector("[data-testid=auto-confirm-delivery]")?.getAttribute("aria-pressed") ?? null');
  if (enabledAutoConfirm !== 'true') throw new Error(`auto-confirm switch could not be enabled: ${enabledAutoConfirm}`);
  await evaluate(cdp, 'document.querySelector("[data-testid=save-automation]")?.click()');
  await waitFor(async () => !Boolean(await evaluate(cdp, 'document.querySelector("[data-testid=automation-drawer]")')), 'automation save');
  await evaluate(cdp, 'document.querySelector("[data-testid^=product-automation-]")?.click()');
  await waitFor(async () => Boolean(await evaluate(cdp, 'Boolean(document.querySelector("[data-testid=automation-drawer]"))')), 'automation drawer reopen');
  const persistedAutoConfirm = await evaluate(cdp, `(() => { const toggle = document.querySelector('[data-testid=auto-confirm-delivery]'); return toggle?.getAttribute('aria-pressed') ?? null; })()`);
  if (persistedAutoConfirm !== 'true') throw new Error(`auto-confirm state did not persist after save: ${persistedAutoConfirm}`);
  await shot(cdp, 1440, 900, '02-payment-after-delivery-desktop.png'); await shot(cdp, 390, 844, '02-payment-after-delivery-mobile.png');
  for (const [tab, marker, file] of [['拍下未付款改价', '目标价格', '03-unpaid-reprice'], ['评价后发送赠品', '选择卡券', '04-review-gift'], ['超时未评价求评价', '首次提醒', '05-overdue-review']]) { const clicked = await evaluate(cdp, `(() => { const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(${JSON.stringify(tab)})); button?.click(); return Boolean(button); })()`); if (!clicked) throw new Error(`automation tab missing: ${tab}`); await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes(marker), `${tab} panel`); await shot(cdp, 1440, 900, `${file}-desktop.png`); await shot(cdp, 390, 844, `${file}-mobile.png`); }
  await evaluate(cdp, 'Array.from(document.querySelectorAll(".automation-summary")).find((item) => item.textContent?.includes("付款后自动发货"))?.click()'); await evaluate(cdp, 'document.querySelector("[data-testid=choose-delivery-coupon]")?.click()'); await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('待选卡券'), 'coupon picker'); if (automationMode === 'live') await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('批量数据2'), 'live coupon picker list'); await shot(cdp, 1440, 900, '06-delivery-coupon-picker-desktop.png'); await shot(cdp, 390, 844, '06-delivery-coupon-picker-mobile.png');
  const transferAudit = await evaluate(cdp, `(async () => {
    const panes = document.querySelectorAll('.coupon-transfer-pane');
    const arrows = document.querySelectorAll('.coupon-transfer-arrow');
    const availableInput = panes[0]?.querySelector('input[type="checkbox"]');
    const before = panes[1]?.querySelectorAll('.coupon-item').length ?? 0;
    if (!availableInput || arrows.length < 2 || before < 1) return { ok: false, reason: 'transfer controls missing', before };
    if (!arrows[0].hasAttribute('disabled')) return { ok: false, reason: 'add arrow should start disabled' };
    availableInput.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (arrows[0].hasAttribute('disabled')) return { ok: false, reason: 'add arrow stayed disabled after checking' };
    arrows[0].click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const afterAdd = panes[1]?.querySelectorAll('.coupon-item').length ?? 0;
    const selectedInput = panes[1]?.querySelector('input[type="checkbox"]');
    if (afterAdd !== before + 1 || !selectedInput) return { ok: false, reason: 'checked item did not move right', before, afterAdd };
    selectedInput.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (arrows[1].hasAttribute('disabled')) return { ok: false, reason: 'remove arrow stayed disabled after checking right item' };
    arrows[1].click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const afterRemove = panes[1]?.querySelectorAll('.coupon-item').length ?? 0;
    return { ok: afterRemove === before, before, afterAdd, afterRemove };
  })()`);
  if (!transferAudit?.ok) throw new Error(`coupon transfer semantics failed: ${JSON.stringify(transferAudit)}`);
  await evaluate(cdp, 'document.querySelector("[data-testid=save-coupon-selection]")?.click()'); await waitFor(async () => !Boolean(await evaluate(cdp, 'document.querySelector("[data-testid=coupon-picker-dialog]")')), 'coupon picker save');
  await evaluate(cdp, 'document.querySelector(`[aria-label="关闭自动化配置"]`)?.click()'); await evaluate(cdp, 'document.querySelector(`[data-testid=batch-automation]`)?.click()'); await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('批量配置自动化'), 'batch dialog'); await evaluate(cdp, 'document.querySelector(`[data-testid=save-batch-automation]`)?.click()'); try { await waitFor(async () => !Boolean(await evaluate(cdp, 'document.querySelector(`[data-testid=batch-automation-dialog]`)')), 'batch save'); } catch (error) { console.error(`batch failure body: ${await evaluate(cdp, 'document.body.innerText')}`); console.error(`batch failure fetch log: ${await evaluate(cdp, 'JSON.stringify((window.__automationFetchLog ?? []).filter((entry) => entry.url.includes("automation")))')}`); throw error; }
  console.log('product automation Chrome/CDP E2E passed: list -> four automation panels -> coupon transfer save -> batch dialog save'); cdp.socket.close();
}

try { await run(); } finally { for (const child of children.reverse()) { if (!child.killed && child.exitCode === null) { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else child.kill('SIGTERM'); } child.stdout?.destroy(); child.stderr?.destroy(); } if (apiRuntime) await apiRuntime.close(); try { rmSync(profile, { recursive: true, force: true }); } catch {} }
