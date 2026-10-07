import assert from 'node:assert/strict';
import test from 'node:test';
import { xianyuBrowserIdentity, xianyuChromeVersion, xianyuImUserAgent, xianyuNavigatorPlatform, xianyuSecChUa, xianyuSecChUaPlatform } from '../src/xianyu-browser-identity.js';

test('browser identity derives Client Hints from the configured Chrome UA', () => {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.53 Safari/537.36';
  assert.equal(xianyuChromeVersion(ua), '153.0.8010.53');
  assert.equal(xianyuSecChUa(ua), '"Not(A:Brand";v="99", "Chromium";v="153", "Google Chrome";v="153"');
});

test('browser identity keeps Linux browser, Client Hints, navigator platform, and IM metadata aligned', () => {
  const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.39 Safari/537.36';
  const identity = xianyuBrowserIdentity(ua);
  assert.equal(identity.platform, 'Linux');
  assert.equal(identity.secChUaPlatform, '"Linux"');
  assert.equal(xianyuSecChUaPlatform(ua), '"Linux"');
  assert.equal(xianyuNavigatorPlatform(ua), 'Linux x86_64');
  assert.match(xianyuImUserAgent(ua), /OS\(Linux\) Browser\(Chrome\/155\)/u);
});

test('browser identity preserves Windows values for local Chrome', () => {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8010.54 Safari/537.36';
  const identity = xianyuBrowserIdentity(ua);
  assert.equal(identity.platform, 'Windows');
  assert.equal(identity.secChUaPlatform, '"Windows"');
  assert.equal(xianyuNavigatorPlatform(ua), 'Win32');
  assert.match(xianyuImUserAgent(ua), /OS\(Windows\/10\) Browser\(Chrome\/154\)/u);
});
