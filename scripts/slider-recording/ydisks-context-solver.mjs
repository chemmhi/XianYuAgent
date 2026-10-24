import { buildYdisksPlan, replayYdisksPlan } from './ydisks-gesture.mjs';
import { recoverYdisksControl } from './ydisks-recovery.mjs';
import { readFingerprint } from './fingerprint.mjs';

export async function solveNativeChallenge(context, page, url, source, store) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !target.hostname.endsWith('.goofish.com')) throw Error('Unexpected native challenge origin');
  const verdicts = [], pending = new Set();
  const listener = response => {
    if (!/\/slide(?:\?|$)/.test(response.url())) return;
    const task = (async () => {
      const verdict = { utc: new Date().toISOString(), url: response.url(), body: await response.json() };
      verdicts.push(verdict);
      store.json(`native-judgment-${verdicts.length}.json`, verdict);
    })();
    pending.add(task);
    task.catch(error => store.event('native.judgment.error', { error })).finally(() => pending.delete(task));
  };
  page.on('response', listener);
  let result = { success: false, attempts: 0, manual: false };
  try {
    const priorValues = new Set((await context.cookies()).filter(c => c.name === 'x5sec').map(c => c.value));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const configuration = await buildYdisksPlan(source, { button: { x: 0, y: 0, width: 42, height: 30 }, distance: 258, verticalSpan: 17 }, 20261024);
    await replayYdisksPlan({ events: configuration.preparationEvents }, { page, record: (type, data) => store.event(type, { native: true, ...data }) });
    let control;
    const deadline = Date.now() + 15_000;
    while (!control && Date.now() < deadline) {
      for (const frame of page.frames()) {
        const button = frame.locator('#nc_1_n1z, #scratch-captcha-btn').first();
        if (await button.isVisible().catch(() => false)) { control = { frame, button }; break; }
      }
      if (!control) await page.waitForTimeout(150);
    }
    if (!control) return { ...result, reason: 'no_live_native_challenge' };
    store.json('native-before.json', { url: page.url(), cookies: await context.cookies(), fingerprint: await page.evaluate(readFingerprint) });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const handle = await control.button.elementHandle();
      const button = await handle?.boundingBox();
      const track = await control.frame.locator('#nc_1_n1t, .nc_scale').first().boundingBox();
      if (!handle || !button || !track) throw Error('Native challenge control lost');
      const plan = await buildYdisksPlan(source, { button, track, distance: track.width - button.width, verticalSpan: track.height / 2 }, 20261023 + attempt);
      store.json(`native-gesture-${attempt}.json`, plan);
      result.attempts = attempt;
      const verdictStart = verdicts.length;
      await replayYdisksPlan(plan, { page, button: handle,
        stopWhen: () => verdicts.slice(verdictStart).some(v => v.body.code === 0 && v.body.success === true),
        record: (type, data) => store.event(type, { native: true, attempt, ...data }) });
      await page.waitForTimeout(1500);
      await Promise.allSettled([...pending]);
      const cookies = await context.cookies();
      const fresh = cookies.some(c => c.name === 'x5sec' && c.value && !priorValues.has(c.value));
      const zero = verdicts.slice(verdictStart).some(v => v.body.code === 0 && v.body.success === true);
      const left = !/punish|x5step=2|action=captcha|purecaptcha|\/captcha/i.test(page.url());
      store.json(`native-after-${attempt}.json`, { url: page.url(), cookies, freshX5sec: fresh, codeZero: zero, leftChallenge: left });
      if (zero && fresh && left) return { success: true, attempts: attempt, manual: false, codes: verdicts.map(v => v.body.code) };
      if (attempt < 3) {
        const recovered = await recoverYdisksControl(page, { record: (type, data) => store.event(type, { native: true, ...data }) });
        if (!recovered) break;
        control = recovered;
        await page.waitForTimeout(1500);
      }
    }
    return { ...result, codes: verdicts.map(v => v.body.code), reason: 'native_challenge_not_accepted' };
  } finally { page.off('response', listener); }
}
