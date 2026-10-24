// Bounded local diagnostic: normal UI input and the platform's own verdict.
// No database access, response rewriting, manual fallback or success injection.
import fs from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRecordingStore } from './store.mjs';
import { installHttpRecording } from './http.mjs';
import { installBrowserRecording } from './browser.mjs';
import { createTarProfileSnapshot } from './profile-archive.mjs';
import { readFingerprint } from './fingerprint.mjs';
import { useNativeChromeLaunch } from './native-browser.mjs';

const root = process.env.XIANYU_RECORD_DIR;
const profile = process.env.XIANYU_COPY_PROFILE;
const inputDirectory = process.env.XIANYU_COPY_INPUT_DIR ?? '/copy';
const windows = process.platform === 'win32';
if (windows
  ? !root || !profile || !resolve(root).startsWith(resolve(inputDirectory) + sep) || !resolve(profile).startsWith(resolve(inputDirectory) + sep)
  : !root?.startsWith('/evidence/') || !profile?.startsWith('/browser-data/')) throw Error('Isolated local paths required');
const recording = createRecordingStore(root);
recording.json('executed-source.json', { body: recording.blob(fs.readFileSync(new URL(import.meta.url)), 'mjs') });
const input = JSON.parse(fs.readFileSync(join(inputDirectory, 'latest-challenge-input.json'), 'utf8'));
const planPath = resolve(inputDirectory, input.planFile ?? 'upstream-normalized-plan.stdout.log');
if (!planPath.startsWith(resolve(inputDirectory) + sep)) throw Error('Gesture plan must be inside the evidence input directory');
const normalizedPlan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const target = new URL(input.verificationUrl);
if (target.protocol !== 'https:' || !target.hostname.endsWith('.goofish.com')) throw Error('Unexpected challenge origin');
recording.json('input.json', { input, normalizedPlan, env: process.env, versions: process.versions, argv: process.argv });
const drain = installHttpRecording(recording);
const { chromium } = await import(windows ? 'patchright' : '/app/node_modules/patchright/index.mjs');
if (windows && process.env.XIANYU_COPY_NATIVE === 'true') useNativeChromeLaunch(chromium, recording);
await installBrowserRecording(recording, { snapshotProfile: createTarProfileSnapshot(recording) });
const launch = chromium.launchPersistentContext.bind(chromium);
chromium.launchPersistentContext = (directory, options) => launch(directory, {
  ...options,
  ...(process.env.XIANYU_COPY_PROXY ? { proxy: { server: process.env.XIANYU_COPY_PROXY } } : {}),
  args: [...(options.args ?? []), ...(process.env.XIANYU_COPY_RENDERER === 'swiftshader' ? ['--use-angle=swiftshader'] : [])],
});
const moduleUrl = name => windows ? pathToFileURL(join(process.env.XIANYU_COPY_APP_DIR, name)).href : `/app/dist/${name}`;
const { createPatchrightVerificationBrowserFactory } = await import(moduleUrl('patchright-verification-browser.js'));
const { XIANYU_USER_AGENT } = await import(moduleUrl('xianyu-browser-identity.js'));
let context;
const judgments = [];
const pending = new Set();
let result = { success: false, reason: 'not_started', attempts: 0, manual: false };
try {
  context = await createPatchrightVerificationBrowserFactory().launchPersistentContext({
    profileDir: profile, headless: false, hideWindow: !windows, userAgent: XIANYU_USER_AGENT,
  });
  const page = context.pages()[0] ?? await context.newPage();
  if (input.cookieSnapshot || input.credential?.cookieHeader) {
    // Match xianyu-im-service.ts cookieSnapshotFromHeader: the fresh challenge
    // markers and stable account cookies must accompany the returned URL.
    const cookies = input.cookieSnapshot ?? input.credential.cookieHeader.split(';').flatMap(part => {
      const separator = part.indexOf('=');
      if (separator <= 0) return [];
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      return name && value ? [{ name, value, domain: '.goofish.com', path: '/' }] : [];
    });
    if (cookies.find(cookie => cookie.name === 'unb')?.value !== input.sellerRef) throw Error('Account identity mismatch');
    if (cookies.some(cookie => cookie.name === 'x5sec')) throw Error('Existing challenge success cookie excluded from this diagnostic');
    recording.json('cookie-injection.json', { source: 'local memory credential after fresh platform validation response', cookies });
    await context.addCookies(cookies);
  }
  page.on('response', response => {
    if (!/\/slide(?:\?|$)/.test(response.url())) return;
    const task = (async () => {
      const body = await response.json();
      const judgment = { utc: new Date().toISOString(), url: response.url(), status: response.status(), body };
      judgments.push(judgment);
      recording.json(`judgment-${judgments.length}.json`, judgment);
    })();
    pending.add(task);
    task.catch(error => recording.event('judgment.error', { error })).finally(() => pending.delete(task));
  });
  const initialCookies = await context.cookies();
  recording.json('initial-cookies.json', initialCookies);
  // The exact copied History address is the input; no synthetic challenge URL.
  await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(8000);
  const beforeCookies = await context.cookies();
  const frames = [];
  let control;
  for (const frame of page.frames()) {
    const selector = '#nc_1_n1z, #scratch-captcha-btn, .nc_iconfont';
    const button = frame.locator(selector).first();
    const visible = await button.isVisible({ timeout: 500 }).catch(() => false);
    frames.push({ url: frame.url(), html: await frame.content().catch(String), visible,
      fingerprint: await frame.evaluate(readFingerprint).catch(error => ({ error: String(error) })) });
    if (visible && !control) control = { frame, button };
  }
  recording.json('before.json', { url: page.url(), frames, cookies: beforeCookies });
  await page.screenshot({ path: join(root, 'before.png'), fullPage: true, timeout: 10_000 });
  if (!control) {
    result = { ...result, reason: 'no_live_challenge', finalUrl: page.url(), judgments };
  } else {
    const button = await control.button.boundingBox();
    const track = await control.frame.locator('#nc_1_n1t, .nc_scale').first().boundingBox();
    if (!button || !track) throw Error('Live challenge geometry unavailable');
    const geometry = { x: button.x + button.width / 2, y: button.y + button.height / 2,
      distance: track.x + track.width - button.x - button.width };
    if (!(geometry.distance > 0 && geometry.distance < 2000)) throw Error('Unexpected slider distance');
    const events = normalizedPlan.events.map(([gap, event]) => [gap, { ...event,
      x: geometry.x + (event.buttons === 1 || event.type === 'mouseReleased' || event.type === 'domClick' ? event.x * geometry.distance : event.x),
      y: geometry.y + event.y,
    }]);
    recording.json('gesture.json', { geometry, button, track, normalizedPlan, events });
    await control.frame.evaluate(() => {
      window.__normalChallengeInput = [];
      for (const type of ['pointerdown', 'pointermove', 'pointerup']) document.addEventListener(type, event => {
        window.__normalChallengeInput.push({ type, x: event.clientX, y: event.clientY, buttons: event.buttons,
          trusted: event.isTrusted, timeStamp: event.timeStamp });
      }, true);
    });
    let pressed = false;
    result = { ...result, attempts: 1 };
    const started = performance.now();
    try {
      for (const [gapMs, event] of events) {
        if (gapMs > 0) await new Promise(resolve => setTimeout(resolve, gapMs));
        recording.event('gesture.dispatch', { elapsedMs: performance.now() - started, gapMs, event });
        if (event.type === 'hover') await control.button.hover({ timeout: 2000 });
        else if (event.type === 'wait') { /* The recorded gap is the wait. */ }
        else if (event.type === 'domClick') await control.button.evaluate((slider, point) => slider.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true, view: window, clientX: point.x, clientY: point.y, button: 0,
        })), { x: event.x, y: event.y });
        else if (event.type === 'mousePressed') { await page.mouse.down({ button: 'left' }); pressed = true; }
        else if (event.type === 'mouseReleased') { await page.mouse.up({ button: 'left' }); pressed = false; }
        else await page.mouse.move(event.x, event.y, event.steps ? { steps: event.steps } : {});
      }
    } finally { if (pressed) await page.mouse.up({ button: 'left' }); }
    await page.waitForTimeout(3000);
    await Promise.allSettled([...pending]);
    const afterCookies = await context.cookies();
    const freshX5sec = afterCookies.some(cookie => cookie.name === 'x5sec' && cookie.value &&
      !beforeCookies.some(prior => prior.name === cookie.name && prior.domain === cookie.domain && prior.path === cookie.path && prior.value === cookie.value));
    const codeZero = judgments.some(judgment => judgment.body.code === 0 && judgment.body.success === true);
    const domEvents = await control.frame.evaluate(() => window.__normalChallengeInput ?? []).catch(String);
    recording.json('after.json', { url: page.url(), cookies: afterCookies, domEvents,
      frames: await Promise.all(page.frames().map(async frame => ({ url: frame.url(), html: await frame.content().catch(String) }))) });
    await page.screenshot({ path: join(root, 'after.png'), fullPage: true, timeout: 10_000 });
    result = { success: codeZero && freshX5sec, reason: codeZero && freshX5sec ? 'platform_accepted' : 'platform_not_accepted',
      attempts: 1, manual: false, codeZero, freshX5sec, codes: judgments.map(judgment => judgment.body.code), judgments, finalUrl: page.url() };
  }
} catch (error) {
  result = { ...result, reason: 'probe_error', error: { message: error.message, stack: error.stack }, judgments };
  process.exitCode = 1;
} finally {
  recording.json('result.json', result);
  console.log(JSON.stringify({ success: result.success, reason: result.reason, attempts: result.attempts, codes: result.codes, manual: false }));
  if (context) await context.close();
  await drain();
}
