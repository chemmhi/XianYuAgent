import fs from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { chromium } from 'patchright';
import { createRecordingStore } from './store.mjs';
import { installBrowserRecording } from './browser.mjs';
import { createTarProfileSnapshot } from './profile-archive.mjs';
import { readFingerprint } from './fingerprint.mjs';
import { buildYdisksPlan, replayYdisksPlan } from './ydisks-gesture.mjs';
import { recoverYdisksControl } from './ydisks-recovery.mjs';
import { mergeYdisksPass } from './ydisks-credential.mjs';
import { checkAccountInBrowser } from './ydisks-native-account.mjs';

const inputDirectory = resolve(process.env.XIANYU_COPY_INPUT_DIR);
const root = resolve(process.env.XIANYU_RECORD_DIR);
const profile = resolve(process.env.XIANYU_COPY_PROFILE);
if (process.platform === 'win32' ? ![root, profile].every(p => p.startsWith(inputDirectory + sep))
  : !root.startsWith('/evidence/') || !profile.startsWith('/browser-data/')) throw Error('Isolated local paths required');
const recording = createRecordingStore(root);
const input = JSON.parse(fs.readFileSync(join(inputDirectory, 'latest-challenge-input.json'), 'utf8'));
const target = new URL(input.verificationUrl);
if (target.protocol !== 'https:' || !target.hostname.endsWith('.goofish.com') || input.sellerRef !== '1903703477') throw Error('Unexpected challenge target');
const upstream = join(inputDirectory, 'upstream');
const seed = Number(process.env.XIANYU_COPY_SEED ?? 20261024);
const configuration = await buildYdisksPlan(upstream, { button: { x: 0, y: 0, width: 30, height: 30 }, distance: 256, verticalSpan: 17 }, seed);
const nativeIdentity = process.env.XIANYU_COPY_NATIVE_IDENTITY === 'true';
recording.json('input.json', { input, configuration, nativeIdentity, env: process.env, versions: process.versions, argv: process.argv });
recording.json('executed-source.json', { body: recording.blob(fs.readFileSync(new URL(import.meta.url)), 'mjs') });
await installBrowserRecording(recording, { snapshotProfile: createTarProfileSnapshot(recording),
  traceOptions: { screenshots: false, snapshots: false, sources: true } });
async function observed(promise, label, ms = 2000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label} exceeded ${ms}ms`)), ms); })]); }
  catch (error) { recording.event('recording.error', { scope: label, error }); return { unavailable: String(error) }; }
  finally { clearTimeout(timer); }
}
let context;
let result = { success: false, attempts: 0, manual: false, reason: 'not_started' };
const judgments = [], pending = new Set();
try {
  const features = configuration.browserFeatures;
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome', headless: false, viewport: null, locale: features.locale,
    timezoneId: features.timezone_id, colorScheme: 'light', ignoreHTTPSErrors: false,
    args: [...configuration.launchArgs, ...(process.env.XIANYU_COPY_RENDERER === 'swiftshader' ? ['--use-angle=swiftshader'] : [])],
    proxy: { server: process.env.XIANYU_COPY_PROXY },
  });
  const page = context.pages()[0] ?? await context.newPage();
  let fingerprintCdp;
  if (!nativeIdentity) {
    fingerprintCdp = await context.newCDPSession(page);
    for (const { method, params } of configuration.fingerprintCommands) await fingerprintCdp.send(method, params);
  }
  await page.addInitScript(configuration.stealthScript);
  const cookies = input.cookieSnapshot ?? input.credential.cookieHeader.split(';').flatMap(part => {
    const i = part.indexOf('=');
    return i <= 0 ? [] : [{ name: part.slice(0, i).trim(), value: part.slice(i + 1).trim(), domain: '.goofish.com', path: '/' }];
  });
  if (cookies.find(c => c.name === 'unb')?.value !== input.sellerRef || cookies.some(c => c.name === 'x5sec')) throw Error('Unexpected account or existing pass cookie');
  recording.json('cookie-injection.json', cookies);
  await context.addCookies(cookies);
  page.on('response', response => {
    if (!/\/slide(?:\?|$)/.test(response.url())) return;
    const task = (async () => {
      const judgment = { utc: new Date().toISOString(), url: response.url(), status: response.status(), body: await response.json() };
      judgments.push(judgment);
      recording.json(`judgment-${judgments.length}.json`, judgment);
    })();
    pending.add(task);
    task.catch(error => recording.event('judgment.error', { error })).finally(() => pending.delete(task));
  });
  recording.json('initial-cookies.json', await context.cookies());
  await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  recording.json('preparation.json', configuration.preparationEvents);
  await replayYdisksPlan({ events: configuration.preparationEvents }, { page, record: (type, data) => recording.event(type, data) });
  // Wait for a real control, rather than interpreting an empty callback as pass.
  let control;
  const deadline = Date.now() + 20_000;
  while (!control && Date.now() < deadline) {
    for (const frame of page.frames()) {
      const button = frame.locator('#nc_1_n1z, #scratch-captcha-btn').first();
      if (await button.isVisible({ timeout: 250 }).catch(() => false)) { control = { frame, button }; break; }
    }
    if (!control) await page.waitForTimeout(250);
  }
  const beforeCookies = await context.cookies();
  const frames = await Promise.all(page.frames().map(async frame => ({ url: frame.url(), html: await observed(frame.content(), 'before.frame.html'),
    fingerprint: await observed(frame.evaluate(readFingerprint), 'before.fingerprint', 5000) })));
  recording.json('before.json', { url: page.url(), cookies: beforeCookies, frames });
  await observed(page.screenshot({ path: join(root, 'before.png'), fullPage: true, timeout: 5000 }), 'before.screenshot', 6000);
  if (!control) result = { ...result, reason: 'no_live_challenge', finalUrl: page.url() };
  else {
    const maxAttempts = Math.min(3, Math.max(1, Number(process.env.XIANYU_COPY_MAX_ATTEMPTS ?? 1)));
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const judgmentStart = judgments.length;
    const handle = await control.button.elementHandle();
    if (!handle) throw Error('Original control element was detached before dragging');
    const button = await handle.boundingBox();
    const track = await control.frame.locator('#nc_1_n1t, .nc_scale').first().boundingBox();
    if (!button || !track) throw Error('Missing control geometry');
    const distance = track.x + track.width - button.x - button.width;
    if (!(distance > 0 && distance < 2000)) throw Error('Unexpected slider distance');
    const geometry = { button, track, distance, verticalSpan: track.height / 2 };
    const scratch = await control.frame.locator('#scratch-captcha-btn').isVisible().catch(() => false);
    const plan = await buildYdisksPlan(upstream, geometry, seed + attempt - 1, scratch);
    recording.json('gesture.json', plan);
    recording.json(`gesture-${attempt}.json`, plan);
    await control.frame.evaluate(() => {
      window.__ydisksInput = [];
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'click']) document.addEventListener(type, e => {
        const slider = document.querySelector('#nc_1_n1z, #scratch-captcha-btn');
        window.__ydisksInput.push({ type, x: e.clientX, y: e.clientY, buttons: e.buttons, trusted: e.isTrusted, timeStamp: e.timeStamp,
          sliderStyle: slider?.getAttribute('style'), sliderClass: slider?.className });
      }, true);
    });
    result.attempts = attempt;
    await replayYdisksPlan(plan, { page, button: handle, record: (type, data) => recording.event(type, data) });
    await page.waitForTimeout(5000);
    await Promise.allSettled([...pending]);
    const afterCookies = await context.cookies();
    const freshX5sec = afterCookies.some(c => c.name === 'x5sec' && c.value && !beforeCookies.some(b => b.name === c.name && b.value === c.value));
    const codeZero = judgments.slice(judgmentStart).some(j => j.body.code === 0 && j.body.success === true);
    const leftChallenge = !/punish|x5step=2|action=captcha|purecaptcha|\/captcha/i.test(page.url());
    recording.json('after.json', { url: page.url(), cookies: afterCookies,
      domEvents: await observed(control.frame.evaluate(() => window.__ydisksInput ?? []), 'after.domEvents'),
      frames: await Promise.all(page.frames().map(async frame => ({ url: frame.url(), html: await observed(frame.content(), 'after.frame.html') }))) });
    fs.copyFileSync(join(root, 'after.json'), join(root, `after-${attempt}.json`));
    await observed(page.screenshot({ path: join(root, 'after.png'), fullPage: true, timeout: 5000 }), 'after.screenshot', 6000);
    result = { ...result, success: codeZero && freshX5sec && leftChallenge, codeZero, freshX5sec, leftChallenge,
      codes: judgments.map(j => j.body.code), reason: codeZero && freshX5sec && leftChallenge ? 'platform_accepted' : 'platform_not_accepted', finalUrl: page.url() };
    if (result.success) {
      const passed = mergeYdisksPass({ ...input, cookieSnapshot: input.cookieSnapshot ?? cookies }, afterCookies);
      recording.json('passed-credential.json', passed);
      if (process.env.XIANYU_COPY_CHECK_ACCOUNT === 'true') result.accountCheck = await checkAccountInBrowser(context, page, passed, recording);
    }
    if (result.success || attempt === maxAttempts) break;
    const recovered = await recoverYdisksControl(page, { record: (type, data) => recording.event(type, { attempt, ...data }) });
    if (!recovered) { recording.event('retry.stopped', { attempt, reason: 'no_confirmed_origin' }); break; }
    control = recovered;
    await page.waitForTimeout(1500);
    }
  }
} catch (error) {
  result = { ...result, reason: 'probe_error', error: { message: error.message, stack: error.stack } };
  process.exitCode = 1;
} finally {
  recording.json('result.json', { ...result, judgments });
  console.log(JSON.stringify({ success: result.success, reason: result.reason, attempts: result.attempts, codes: result.codes, manual: false }));
  if (context) await context.close();
}
