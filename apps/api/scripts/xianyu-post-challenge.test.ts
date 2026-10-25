import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { BrowserContext } from 'patchright';
import { createBrowserMtopTransport } from '../src/xianyu-browser-mtop.js';
import { createPatchrightVerificationBrowserFactory } from '../src/patchright-verification-browser.js';
import { browserStageError, completeBrowserChallenge } from '../src/xianyu-browser-challenge-handoff.js';
import type { XianyuVerificationPage, XianyuVerificationPageEvents } from '../src/xianyu-browser-port.js';

for (const callback of ['fetch', 'navigation']) test(`accepted challenge waits for asynchronous ${callback} to commit the session`, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'xianyu-post-challenge-'));
  const context = await createPatchrightVerificationBrowserFactory().launchPersistentContext({ profileDir: profile, headless: true, hideWindow: false });
  let calls = 0;
  let finishes = 0;
  let robots = 0;
  await (context as unknown as BrowserContext).route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname.startsWith('/h5/')) {
      calls++;
      const cookie = (await request.allHeaders()).cookie ?? '';
      const payload = cookie.includes('session_finished=ready') ? { ret: ['SUCCESS::ok'], data: { restored: true } }
        : calls === 1 ? { ret: ['FAIL_SYS_USER_VALIDATE::verify'], data: { url: 'https://www.goofish.com/punish' } }
          : { ret: ['FAIL_SYS_SESSION_EXPIRED::callback not finished'], data: {} };
      await route.fulfill({ status: 200, headers: { 'content-type': 'application/json',
        'access-control-allow-origin': 'https://www.goofish.com', 'access-control-allow-credentials': 'true' }, body: JSON.stringify(payload) });
      return;
    }
    if (url.pathname === '/slide') { await route.fulfill({ status: 200, contentType: 'application/json', body: '{"code":0,"success":true}' }); return; }
    if (url.pathname === '/finish') {
      // This callback is the only place that actually establishes the session.
      // Finishing after the minimum grace also verifies the in-flight fence.
      await new Promise(resolve => setTimeout(resolve, 1_200));
      finishes++;
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/html',
        'set-cookie': 'session_finished=ready; Domain=.goofish.com; Path=/; Secure; SameSite=None' }, body: '<!doctype html><p>completed</p>' });
      return;
    }
    if (url.pathname === '/robots.txt' && ++robots > 1) await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>ready</p>' });
  });
  const page = context.pages()[0];
  await context.addCookies([{ name: '_m_h5_tk', value: 'initial_suffix', domain: '.goofish.com', path: '/' }]);
  const call = createBrowserMtopTransport(context, page, async url => {
    await page.goto(url);
    await page.evaluate(async mode => {
      const verdict = await (await fetch('/slide')).json();
      if (verdict.code === 0) setTimeout(() => {
        if (mode === 'navigation') location.href = '/finish';
        else void fetch('/finish');
      }, 50);
    }, callback);
  });
  try {
    assert.deepEqual(await call({ api: 'mtop.taobao.idle.pc.detail', version: '1.0', data: { itemId: 'fixture' }, referer: 'https://www.goofish.com/item' }), { restored: true });
    assert.equal(finishes, 1);
    assert.equal(calls, 2);
    assert.equal(robots, 1, 'same-origin recovery must not navigate away from a completed callback');
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('unfinished session exchange times out and detaches all scoped observers', async () => {
  const listeners = new Map<keyof XianyuVerificationPageEvents, Function>();
  const page = {
    url: () => 'https://www.goofish.com/punish', evaluate: async () => true,
    on: (event: keyof XianyuVerificationPageEvents, listener: Function) => listeners.set(event, listener),
    off: (event: keyof XianyuVerificationPageEvents) => listeners.delete(event),
  } as unknown as XianyuVerificationPage;
  await assert.rejects(completeBrowserChallenge(page, async () => {
    listeners.get('request')!({ resourceType: () => 'fetch' });
  }, 'XIANYU_BROWSER_MTOP'), /XIANYU_BROWSER_MTOP_CHALLENGE_HANDOFF_TIMEOUT/);
  assert.equal(listeners.size, 0);
});

test('browser stage diagnostics preserve the failure reason without signed URLs', () => {
  const secret = 'https://www.goofish.com/punish?token=private&sign=private';
  assert.equal(browserStageError('XIANYU_BROWSER_MTOP', 'PREPARE_NAVIGATION', new Error(`page.goto: net::ERR_ABORTED at ${secret}`)).message,
    'XIANYU_BROWSER_MTOP_PREPARE_NAVIGATION_NAVIGATION_ABORTED');
  assert.equal(browserStageError('XIANYU_BROWSER_MTOP', 'PREPARE_COOKIES', new Error(`invalid cookie private ${secret}`)).message,
    'XIANYU_BROWSER_MTOP_PREPARE_COOKIES_FAILED');
});

test('failed solver detaches observers and does not wait for a nonexistent completion', async () => {
  const listeners = new Set<string>();
  const page = { on: (event: string) => listeners.add(event), off: (event: string) => listeners.delete(event) } as unknown as XianyuVerificationPage;
  await assert.rejects(completeBrowserChallenge(page, async () => { throw new Error('XIANYU_VERIFICATION_AUTO_SOLVE_FAILED'); }, 'XIANYU_BROWSER_MTOP'), /AUTO_SOLVE_FAILED/);
  assert.equal(listeners.size, 0);
});
