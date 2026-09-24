import assert from 'node:assert/strict';
import test from 'node:test';
import { xianyuChromeVersion, xianyuSecChUa } from '../src/xianyu-browser-identity.js';

test('browser identity derives Client Hints from the configured Chrome UA', () => {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.53 Safari/537.36';
  assert.equal(xianyuChromeVersion(ua), '153.0.8010.53');
  assert.equal(xianyuSecChUa(ua), '"Not(A:Brand";v="99", "Chromium";v="153", "Google Chrome";v="153"');
});
