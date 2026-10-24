// One bounded diagnostic using unmodified, pinned Slidex gesture generation.
// This never writes account credentials or requests a human fallback.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { store as recording } from './preload.mjs';
import { readFingerprint } from './fingerprint.mjs';
import { chromium } from 'patchright';

const [inputPath, plannerPath] = process.argv.slice(2);
const input = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
const snapshot = JSON.parse(input.credential.metadata.cookies_refresh_snapshot);
const cookies = snapshot.filter(cookie => input.verificationUrl ? !/^x5sec$/i.test(cookie.name) : !/^x5(?:sec|secdata|sectag|step)$/i.test(cookie.name));
if (cookies.find(cookie => cookie.name === 'unb')?.value !== input.sellerRef) throw new Error('Account identity mismatch');
recording.json('probe-input.json', { ...input, cookies, source: 'pre-manual original server snapshot', maxAttempts: 1 });
let context;
const judgments = [];
const pending = new Set();
try {
  context = await chromium.launchPersistentContext(join(recording.root, 'profile'), {
    channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  });
  await context.addCookies(cookies);
  const page = context.pages()[0] ?? await context.newPage();
  page.on('response', response => {
    if (!/\/slide(?:\?|$)/.test(response.url())) return;
    const task = (async () => {
      const body = await response.json();
      const judgment = { utc: new Date().toISOString(), url: response.url(), status: response.status(), body };
      judgments.push(judgment);
      recording.json(`slide-judgment-${judgments.length}.json`, judgment);
    })();
    pending.add(task);
    task.catch(error => recording.event('recording.error', { scope: 'slide-judgment', error })).finally(() => pending.delete(task));
  });
  await page.goto('https://www.goofish.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(2500);
  if (input.verificationUrl) {
    const target = new URL(input.verificationUrl);
    if (target.protocol !== 'https:' || !target.hostname.endsWith('.goofish.com')) throw new Error('Unexpected verification origin');
    // Homepage requests may rotate challenge markers; reapply the matched
    // archived snapshot immediately before its exact verification URL.
    await context.addCookies(cookies);
  }
  await page.goto(input.verificationUrl ?? 'https://www.goofish.com/im', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(10_000);
  // Detect the visible control itself; a challenge can be embedded under an
  // ordinary URL, while a URL containing "punish" can just be a denial page.
  let frame;
  for (const candidate of page.frames()) {
    if (await candidate.locator('#nc_1_n1z, #scratch-captcha-btn, .nc_iconfont').first().isVisible({ timeout: 250 }).catch(() => false)) {
      frame = candidate;
      break;
    }
  }
  recording.json('before.json', { url: page.url(), frames: await Promise.all(page.frames().map(async candidate => ({ url: candidate.url(), html: await candidate.content().catch(String) }))),
    fingerprint: await page.evaluate(readFingerprint), cookies: await context.cookies() });
  if (!frame) {
    recording.json('result.json', { success: false, reason: 'no_live_challenge', judgments });
    console.log(JSON.stringify({ success: false, reason: 'no_live_challenge' }));
  } else {
    const button = frame.locator('#nc_1_n1z, #scratch-captcha-btn, .nc_iconfont').first();
    const track = frame.locator('#nc_1_n1t, .nc_scale').first();
    const buttonRect = await button.boundingBox();
    const trackRect = await track.boundingBox();
    if (!buttonRect || !trackRect) throw new Error('Live challenge geometry unavailable');
    const geometry = { seed: 20261023, x: buttonRect.x + buttonRect.width / 2, y: buttonRect.y + buttonRect.height / 2,
      distance: trackRect.x + trackRect.width - buttonRect.x - buttonRect.width };
    const generated = spawnSync('python', [resolve(plannerPath)], { input: JSON.stringify(geometry), encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    recording.json('planner-process.json', { geometry, status: generated.status, stdout: generated.stdout, stderr: generated.stderr, error: generated.error });
    if (generated.status !== 0) throw new Error('Upstream gesture planner failed');
    const plan = JSON.parse(generated.stdout);
    recording.json('gesture-plan.json', { geometry, buttonRect, trackRect, ...plan });
    let pressed = false;
    const started = performance.now();
    try {
      for (const [gapMs, event] of plan.events) {
        if (gapMs > 0) await new Promise(resolveDelay => setTimeout(resolveDelay, gapMs));
        recording.event('gesture.dispatch', { elapsedMs: performance.now() - started, gapMs, event });
        if (event.type === 'mousePressed') { await page.mouse.down({ button: 'left' }); pressed = true; }
        else if (event.type === 'mouseReleased') { await page.mouse.up({ button: 'left' }); pressed = false; }
        else await page.mouse.move(event.x, event.y);
      }
    } finally { if (pressed) await page.mouse.up({ button: 'left' }); }
    await page.waitForTimeout(2000);
    await Promise.allSettled([...pending]);
    const after = await context.cookies();
    const hasFreshX5sec = after.some(cookie => cookie.name === 'x5sec' && cookie.value);
    const codeZero = judgments.some(judgment => judgment.body.code === 0 && judgment.body.success === true);
    const result = { success: codeZero && hasFreshX5sec, hasFreshX5sec, codeZero,
      codes: judgments.map(judgment => judgment.body.code), manual: false, attempts: 1, cookies: after, finalUrl: page.url(), judgments };
    recording.json('result.json', result);
    console.log(JSON.stringify({ success: result.success, codes: result.codes, hasFreshX5sec, manual: false, attempts: 1 }));
  }
} finally {
  if (context) await context.close();
  recording.event('upstream-probe.closed', {});
}
