import assert from 'node:assert/strict';
import test from 'node:test';
import { isVerificationPageComplete, resolveVerificationCookieUrl, shouldHideVerificationWindow, shouldUseHeadlessVerificationBrowser } from '../src/xianyu-verification-browser.js';
import { loadConfig } from '../src/config.js';

test('verification completion requires an x5sec cookie or the post-verification IM target', () => {
  assert.equal(isVerificationPageComplete('https://www.goofish.com/punish?x=1', []), false);
  assert.equal(isVerificationPageComplete('https://www.goofish.com/punish?x=1', [{ name: 'x5sec', value: 'redacted', domain: '.goofish.com', path: '/' }]), true);
  assert.equal(isVerificationPageComplete('https://www.goofish.com/im', []), true);
  assert.equal(isVerificationPageComplete('https://example.com/im', []), false);
});

test('verification browser configuration is explicit and disabled by default', () => {
  const config = loadConfig({ ALLOW_IN_MEMORY: 'true', XIANYU_QR_MODE: 'stub' });
  assert.equal(config.xianyuVerificationBrowserMode, 'disabled');
  assert.equal(config.xianyuVerificationBrowserHeadless, false);
  assert.equal(loadConfig({ ALLOW_IN_MEMORY: 'true', XIANYU_VERIFICATION_BROWSER_MODE: 'launch', XIANYU_VERIFICATION_BROWSER_HEADLESS: 'true' }).xianyuVerificationBrowserMode, 'launch');
  assert.equal(loadConfig({ ALLOW_IN_MEMORY: 'true', XIANYU_VERIFICATION_BROWSER_MODE: 'connect', XIANYU_VERIFICATION_BROWSER_DEBUG_PORT: '9222' }).xianyuVerificationBrowserDebugPort, 9222);
});

test('automatic verification honors explicit headless configuration and avoids a visible blank window', () => {
  const previous = process.env.XIANYU_VERIFICATION_AUTO_HEADLESS;
  delete process.env.XIANYU_VERIFICATION_AUTO_HEADLESS;
  try {
    assert.equal(shouldUseHeadlessVerificationBrowser('auto', true), true);
    assert.equal(shouldUseHeadlessVerificationBrowser('auto', false), false);
    assert.equal(shouldUseHeadlessVerificationBrowser('disabled', true), true);
    assert.equal(shouldHideVerificationWindow('auto', false), true);
    assert.equal(shouldHideVerificationWindow('auto', true), false);
    assert.equal(shouldHideVerificationWindow('disabled', false), false);
    assert.equal(resolveVerificationCookieUrl('https://punish.goofish.com/verify?token=redacted#challenge'), 'https://punish.goofish.com/verify');
  } finally {
    if (previous === undefined) delete process.env.XIANYU_VERIFICATION_AUTO_HEADLESS;
    else process.env.XIANYU_VERIFICATION_AUTO_HEADLESS = previous;
  }
});

test('verification browser rejects blank or unrelated targets before opening Chrome', async () => {
  const { XianyuVerificationBrowser } = await import('../src/xianyu-verification-browser.js');
  const browser = new XianyuVerificationBrowser({ mode: 'launch', sliderMode: 'auto' });
  await assert.rejects(
    () => browser.waitForCompletion({ verificationUrl: 'about:blank', maxWaitMs: 500 }),
    (error: unknown) => error instanceof Error && error.message === 'XIANYU_VERIFICATION_URL_INVALID',
  );
  await assert.rejects(
    () => browser.waitForCompletion({ verificationUrl: 'https://example.com/punish', maxWaitMs: 500 }),
    (error: unknown) => error instanceof Error && error.message === 'XIANYU_VERIFICATION_URL_INVALID',
  );
});
