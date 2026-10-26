import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'patchright';
import { createPatchrightVerificationBrowserFactory } from '../src/patchright-verification-browser.js';
import { presentNativeXianyuChallengeFrame } from '../src/xianyu-native-challenge-frame.js';
import { VerificationRemoteBrowser } from '../src/verification-remote-browser.js';

test('native iframe input checks every parent node, URL, scroll, border, geometry and overlay after admission awaits', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'verification-native-input-'));
  const context = await createPatchrightVerificationBrowserFactory().launchPersistentContext({ profileDir: profile, headless: true, hideWindow: false });
  const page = context.pages()[0] as unknown as Page, raw = context as unknown as BrowserContext;
  const challenge = 'https://h5api.m.goofish.com/h5/mtop.taobao.idlemessage.pc.login.token/1.0/_____tmd_____/punish?fixture=1';
  let downs = 0, sequence = 0;
  await raw.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/down') { downs++; return route.fulfill({ body: 'ok' }); }
    return route.fulfill({ contentType: 'text/html;charset=utf-8', body: url.hostname === 'www.goofish.com'
      ? '<body style="margin:0;height:3000px;background:magenta"><p>private background</p>'
      : '<body style="margin:0;width:420px;height:320px;background:white"><h2>安全验证</h2><p>请拖动滑块完成验证</p><div class="nc-container" style="width:300px;height:34px"><button id="nc_1_n1z" style="width:42px;height:30px" onmousedown="fetch(\'/down\')">拖</button></div><button id="nc_1_refresh1">刷新重试</button>' });
  });
  const remote = new VerificationRemoteBrowser(context.pages()[0]);
  try {
    for (const change of ['parent-move', 'parent-overlay', 'parent-scroll', 'parent-border', 'parent-transform', 'parent-replace', 'child-navigation', 'parent-navigation']) {
      await page.goto('https://www.goofish.com/robots.txt');
      await presentNativeXianyuChallengeFrame(context.pages()[0], challenge, 2_000);
      const frame = await remote.capture(); assert.ok(frame, change);
      assert.equal((remote as any).frames.get(frame.frameId).inputSnapshot.parts.length, 2, 'both child and parent contribute an independent fence');
      let calls = 0;
      await assert.rejects(remote.pointer({ ...frame, type: 'down', x: .05, y: .4, sequence: ++sequence }, async () => {
        if (++calls === 2) {
          if (change === 'child-navigation') await page.frames()[1].goto('https://h5api.m.goofish.com/private');
          else if (change === 'parent-navigation') await page.goto('https://www.goofish.com/private');
          else await page.evaluate(change => {
            const iframe = document.getElementById('xianyu-native-challenge-frame') as HTMLIFrameElement;
            if (change === 'parent-move') iframe.style.left = '50px';
            else if (change === 'parent-scroll') scrollTo(0, 100);
            else if (change === 'parent-border') iframe.style.border = '5px solid red';
            else if (change === 'parent-transform') iframe.style.transform = 'rotate(5deg)';
            else if (change === 'parent-replace') iframe.replaceWith(iframe.cloneNode() as HTMLIFrameElement);
            else { const overlay = document.createElement('canvas'); overlay.style.cssText = 'position:fixed;left:20px;top:20px;width:420px;height:320px;pointer-events:none;z-index:2147483647'; document.body.append(overlay); }
          }, change);
        }
        return true;
      }), /STALE|EXPIRED|CLOSED/, change);
      assert.equal(downs, 0, `${change} never reaches an original mouse down`);
    }
  } finally { await remote.close(); await context.close(); await rm(profile, { recursive: true, force: true }); }
});
