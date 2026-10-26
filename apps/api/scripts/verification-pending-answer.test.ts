import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { observeXianyuSliderVerdicts } from '../src/xianyu-slider-verdict.js';

test('answer barrier starts at network request and remains through response JSON parsing', async () => {
  const page = new EventEmitter(); const observer = observeXianyuSliderVerdicts(page as never);
  const request = { url: () => 'https://captcha.goofish.com/slide', resourceType: () => 'fetch' };
  let finish!: (value: unknown) => void; const body = new Promise(resolve => { finish = resolve; });
  try {
    page.emit('request', request); assert.equal(observer.pendingAnswers(), 1, 'no response is needed to reserve the barrier');
    page.emit('response', { url: request.url, request: () => request, json: () => body }); page.emit('requestfinished', request);
    assert.equal(observer.pendingAnswers(), 1, 'network finish cannot release a body still being parsed');
    finish({ code: 0, success: true }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(observer.pendingAnswers(), 0); assert.deepEqual(observer.read(), { sequence: 1, code: 0, success: true });
  } finally { finish({ code: 0, success: true }); await observer.close(); }
});

test('failed or malformed answer remains unknown instead of authorizing a second executor', async () => {
  for (const kind of ['failed', 'malformed']) {
    const page = new EventEmitter(); const observer = observeXianyuSliderVerdicts(page as never);
    const request = { url: () => 'https://captcha.goofish.com/slide', resourceType: () => 'fetch' };
    page.emit('request', request);
    if (kind === 'failed') page.emit('requestfailed', request);
    else { page.emit('response', { url: request.url, request: () => request, json: async () => { throw new Error('connection interrupted'); } }); page.emit('requestfinished', request); }
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(observer.pendingAnswers() > 0, kind); assert.equal(observer.read(), undefined);
    await observer.close(); assert.equal(page.listenerCount('request'), 0);
  }
});

test('request-start order fences deferred JSON: an older rejection or success never replaces the later submission', async () => {
  for (const [oldCode, newCode] of [[300, 0], [0, 300]]) {
    const page = new EventEmitter(), observer = observeXianyuSliderVerdicts(page as never);
    const requests = [0, 1].map(() => ({ url: () => 'https://captcha.goofish.com/slide', resourceType: () => 'fetch' }));
    const release: Array<(value: unknown) => void> = [], bodies = requests.map(() => new Promise(resolve => release.push(resolve)));
    try {
      requests.forEach((request, index) => { page.emit('request', request); page.emit('response', { url: request.url, request: () => request, json: () => bodies[index] }); page.emit('requestfinished', request); });
      assert.equal(observer.watermark(), 2); assert.equal(observer.pendingAnswers(), 2);
      release[1]({ code: newCode, success: true }); await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(observer.read(), { sequence: 2, code: newCode, success: true });
      release[0]({ code: oldCode, success: true }); await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(observer.read(), { sequence: 2, code: newCode, success: true }); assert.equal(observer.pendingAnswers(), 0);
    } finally { release.forEach(done => done({ code: 300, success: true })); await observer.close(); }
  }
});

test('code300 raw success is logged as a response flag with passed=false, never as accepted', async () => {
  const page = new EventEmitter(), observer = observeXianyuSliderVerdicts(page as never), logs: any[] = [];
  const original = console.info; console.info = message => { logs.push(JSON.parse(message)); };
  try {
    const request = { url: () => 'https://captcha.goofish.com/slide', resourceType: () => 'fetch' };
    page.emit('request', request); page.emit('response', { url: request.url, request: () => request, json: async () => ({ code: 300, success: true, private: 'not-public' }) }); page.emit('requestfinished', request);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(logs[0].code, 300); assert.equal(logs[0].platformResponseSuccess, true); assert.equal(logs[0].passed, false);
    assert.equal('success' in logs[0], false); assert.equal(JSON.stringify(logs).includes('not-public'), false);
  } finally { console.info = original; await observer.close(); }
});
