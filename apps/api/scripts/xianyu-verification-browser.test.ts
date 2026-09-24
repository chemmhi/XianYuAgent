import assert from 'node:assert/strict';
import test from 'node:test';
import { isVerificationPageComplete } from '../src/xianyu-verification-browser.js';
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
