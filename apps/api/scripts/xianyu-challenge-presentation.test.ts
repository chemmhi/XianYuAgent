import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext } from 'patchright';
import { nativeXianyuChallengePresentationUrl } from '../src/xianyu-challenge-presentation.js';
import { XianyuVerificationBrowser } from '../src/xianyu-verification-browser.js';
import { createPatchrightVerificationBrowserFactory } from '../src/patchright-verification-browser.js';
import { VerificationRemoteBrowser } from '../src/verification-remote-browser.js';
import { presentNativeXianyuChallengeFrame } from '../src/xianyu-native-challenge-frame.js';

const path = '//h5/mtop.taobao.idlemessage.pc.login.token/1.0/_____tmd_____/punish';
test('native presentation appends only the empty pureCaptcha flag without rewriting signed query bytes', () => {
  const raw = `https://h5api.m.goofish.com${path}?x5secdata=a%2Fb%2B+%20%7e&x5step=2&action=before#fixture`;
  assert.equal(nativeXianyuChallengePresentationUrl(raw), raw.replace('#fixture', '&pureCaptcha=#fixture'));
  for (const query of ['pureCaptcha', 'pureCaptcha=', 'pureCaptcha=already-issued']) {
    const native = `https://h5api.m.goofish.com${path}?x5secdata=a%2F%2B+%20&${query}`;
    assert.equal(nativeXianyuChallengePresentationUrl(native), native);
  }
  assert.equal(nativeXianyuChallengePresentationUrl(`https://h5api.m.goofish.com${path}`), `https://h5api.m.goofish.com${path}?pureCaptcha=`);
  for (const unsupported of [`https://untrusted.example${path}?action=fixture`, 'https://www.goofish.com/im?punish=1', 'https://www.goofish.com/punish?fixture=1', `http://h5api.m.goofish.com${path}`, `https://h5api.m.goofish.com:444${path}`]) assert.equal(nativeXianyuChallengePresentationUrl(unsupported), unsupported);
});

test('original browser hook requests native compact presentation and safe ROI keeps its instructions/refresh', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'native-challenge-presentation-'));
  const factory = createPatchrightVerificationBrowserFactory(); let captures = 0, checked = 0;
  const runtime = { config: { xianyuVerificationNativeEnabled: false }, eligible: () => true, coordinator: { rechecking: async () => { checked++; } },
    runChallenge: async ({ page }: any) => {
      assert.equal(page.url(), 'https://www.goofish.com/robots.txt');
      const child = page.frames().find((frame: any) => frame.parentFrame()); assert.ok(child);
      const url = new URL(child.url()); assert.equal(url.searchParams.has('pureCaptcha'), true); assert.equal(url.searchParams.get('pureCaptcha'), '');
      assert.equal(url.searchParams.get('x5secdata'), 'fixture/signed+ value'); assert.equal(url.searchParams.get('x5step'), '2'); assert.equal(url.searchParams.get('action'), 'before');
      const remote = new VerificationRemoteBrowser(page);
      try { const frame = await remote.capture(); assert.ok(frame); assert.equal(frame.width, 420); assert.equal(frame.height, 320); assert.equal(frame.regionKind, 'challenge_document'); captures++; }
      finally { await remote.close(); }
      return 'controlled-native-session';
    } };
  const browser = new XianyuVerificationBrowser({ mode: 'launch', sliderMode: 'disabled', headless: true, userDataDir: profile, maxWaitMs: 8_000, verificationRuntime: runtime as never,
    browserFactory: { launchPersistentContext: async options => {
      const context = await factory.launchPersistentContext(options);
      await (context as unknown as BrowserContext).route('**/*', route => {
        const native = new URL(route.request().url()).searchParams.has('pureCaptcha') && !!route.request().frame().parentFrame();
        return route.fulfill({ contentType: 'text/html;charset=utf-8', body: native
          ? '<body style="margin:0;width:420px;height:320px"><h2 style="margin:0;height:60px">安全验证</h2><p>请拖动滑块完成安全验证</p><div class="nc-container" style="margin:20px;width:300px;height:34px"><button id="nc_1_n1z" style="width:42px;height:30px">拖</button></div><button id="nc_1_refresh1">刷新重试</button>'
          : '<body style="width:1440px;height:900px"><header><a>logo</a></header><p>请完成安全验证</p><div class="nc-container" style="width:300px;height:34px"><button id="nc_1_n1z">拖</button></div><footer>unknown copyright business text remains forbidden</footer>' });
      });
      return context;
    } },
  });
  try {
    const result = await browser.waitForCompletion({ verificationUrl: `https://h5api.m.goofish.com${path}?x5secdata=fixture%2Fsigned%2B%20value&x5step=2&action=before`, verificationSubject: { adminId: 'controlled', accountId: 'controlled' } });
    assert.equal(result.verificationSessionId, 'controlled-native-session'); assert.equal(captures, 1); assert.equal(checked, 1);
  } finally { await rm(profile, { recursive: true, force: true }); }
});

test('native iframe rejects same-origin sandbox escape and leaves unsupported URLs unopened', async () => {
  const page = { url: () => 'https://www.goofish.com/robots.txt', goto: async () => { throw new Error('unexpected navigation'); }, evaluate: async () => { throw new Error('unexpected DOM injection'); } };
  assert.equal(await presentNativeXianyuChallengeFrame(page as never, 'https://untrusted.example/punish', 100), false);
  await assert.rejects(presentNativeXianyuChallengeFrame(page as never, `https://www.goofish.com${path}?fixture=1`, 100), /ORIGIN_UNSAFE/);
});

test('native iframe redirect cannot acquire parent origin and remove its sandbox', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'native-frame-redirect-'));
  const context = await createPatchrightVerificationBrowserFactory().launchPersistentContext({ profileDir: profile, headless: true, hideWindow: false });
  const page = context.pages()[0], raw = context as unknown as BrowserContext; let escapeRequests = 0;
  await raw.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'h5api.m.goofish.com') return route.fulfill({ status: 302, headers: { location: 'https://www.goofish.com/escape' } });
    if (url.pathname === '/escape') { escapeRequests++; return route.fulfill({ contentType: 'text/html;charset=utf-8', body: '<script>frameElement.removeAttribute("sandbox");parent.document.body.dataset.escaped="true";</script>' }); }
    return route.fulfill({ contentType: 'text/html;charset=utf-8', body: '<body>controlled safe bootstrap</body>' });
  });
  try {
    await page.goto('https://www.goofish.com/robots.txt');
    await presentNativeXianyuChallengeFrame(page, `https://h5api.m.goofish.com${path}?fixture=1`, 2_000);
    assert.equal(escapeRequests, 0, 'frame-src blocks parent-origin redirect before requesting/executing that document');
    assert.equal(await page.evaluate(() => document.body.dataset.escaped), undefined);
    const remote = new VerificationRemoteBrowser(page); try { assert.equal(await remote.capture(), undefined); } finally { await remote.close(); }
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
