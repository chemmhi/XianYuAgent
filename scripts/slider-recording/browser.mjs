import { join } from 'node:path';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { readFingerprint } from './fingerprint.mjs';

export async function installBrowserRecording(store, { snapshotProfile = (profile, destination) => cpSync(profile, destination, { recursive: true }),
  traceOptions = { screenshots: true, snapshots: true, sources: true } } = {}) {
  const { chromium } = await import('patchright');
  const launch = chromium.launchPersistentContext.bind(chromium);
  chromium.launchPersistentContext = async (profile, options = {}) => {
    const id = store.id();
    const dir = join(store.root, `browser-${id}`);
    mkdirSync(dir, { recursive: true });
    if (existsSync(profile)) await snapshotProfile(profile, join(dir, 'profile-before'));
    store.event('browser.launch.input', { id, profile, options });
    const context = await launch(profile, { ...options, recordHar: { path: join(dir, 'network.har'), content: 'embed', mode: 'full' } });
    await context.tracing.start(traceOptions);
    store.event('browser.trace.start', { id, options: traceOptions });
    store.event('browser.launch.output', { id, version: context.browser()?.version(), options: { ...options, recordHar: { mode: 'full', content: 'embed' } } });
    const tasks = new Map();
    const track = (promise, scope = 'snapshot') => { tasks.set(promise, scope); promise.catch((error) => store.event('recording.error', { id, scope, error })).finally(() => tasks.delete(promise)); };
    async function drainTasks() {
      let timeout;
      await Promise.race([Promise.allSettled([...tasks.keys()]), new Promise((resolve) => { timeout = setTimeout(() => { store.event('recording.incomplete', { id, scope: 'browser-pending', pending: [...tasks.values()] }); resolve(); }, 8000); })]);
      clearTimeout(timeout);
    }
    const seenPages = new WeakSet();
    const seenFrames = new WeakSet();
    const seenLocators = new WeakSet();
    const seenRequests = new WeakMap();
    let snapshotNumber = 0;
    function wrapMethod(target, name, label, transform) {
      if (typeof target[name] !== 'function') return;
      const original = target[name].bind(target);
      target[name] = function (...args) {
        const callId = store.id();
        store.event('browser.call.input', { id, callId, target: label, method: name, args: args.map((value) => typeof value === 'function' ? { function: value.toString() } : value) });
        let result;
        try { result = original(...args); } catch (error) { store.event('browser.call.error', { id, callId, error }); throw error; }
        if (result?.then) return result.then((value) => { store.event('browser.call.output', { id, callId, value: ['goto', 'reload', 'hover', 'click'].includes(name) ? undefined : value }); return transform ? transform(value) : value; }, (error) => { store.event('browser.call.error', { id, callId, error }); throw error; });
        store.event('browser.call.output', { id, callId, value: transform ? undefined : result });
        return transform ? transform(result) : result;
      };
    }
    function wrapLocator(locator, selector) {
      if (seenLocators.has(locator)) return locator;
      seenLocators.add(locator);
      wrapMethod(locator, 'first', selector, (value) => wrapLocator(value, `${selector}.first()`));
      for (const name of ['isVisible', 'boundingBox', 'textContent', 'hover', 'click']) wrapMethod(locator, name, selector);
      return locator;
    }
    function wrapFrame(frame) {
      if (seenFrames.has(frame)) return;
      seenFrames.add(frame);
      const locator = frame.locator.bind(frame);
      frame.locator = (selector, ...args) => wrapLocator(locator(selector, ...args), `${frame.url()}:${selector}`);
    }
    async function snapshot(page, stage) {
      if (page.isClosed()) return;
      const number = ++snapshotNumber;
      const base = `browser-${id}/snapshot-${number}-${stage}`;
      const frames = [];
      for (const frame of page.frames()) {
        try { frames.push({ url: frame.url(), name: frame.name(), html: await frame.content(), fingerprint: await frame.evaluate(readFingerprint) }); }
        catch (error) { frames.push({ url: frame.url(), error: String(error) }); }
      }
      store.json(`${base}.json`, { url: page.url(), frames, cookies: await context.cookies(), storageState: await context.storageState() });
      await page.screenshot({ path: join(store.root, `${base}.png`), fullPage: true, timeout: 5000 });
      store.event('browser.snapshot', { id, stage, path: `${base}.json`, screenshot: `${base}.png` });
    }
    function observePage(page) {
      if (seenPages.has(page)) return;
      seenPages.add(page);
      for (const frame of page.frames()) wrapFrame(frame);
      page.on('frameattached', wrapFrame);
      page.on('framenavigated', (frame) => { wrapFrame(frame); store.event('browser.navigation', { id, url: frame.url(), name: frame.name() }); });
      page.on('domcontentloaded', () => track(snapshot(page, 'domcontentloaded')));
      page.on('console', (message) => store.event('browser.console', { id, type: message.type(), text: message.text(), location: message.location() }));
      page.on('pageerror', (error) => store.event('browser.pageerror', { id, error }));
      page.on('request', (request) => {
        const requestId = store.id(); seenRequests.set(request, requestId);
        track((async () => store.event('browser.request', { id, requestId, method: request.method(), url: request.url(), resourceType: request.resourceType(), headers: await request.allHeaders(), body: store.blob(request.postDataBuffer() ?? Buffer.alloc(0)) }))());
      });
      page.on('response', (response) => track((async () => {
        const requestId = seenRequests.get(response.request());
        const details = { id, requestId, url: response.url(), status: response.status(), headers: await response.allHeaders() };
        store.event('browser.response', details);
        let bodyTimeout;
        try { const body = await Promise.race([response.body(), new Promise((_, reject) => { bodyTimeout = setTimeout(() => reject(new Error('Browser response body was not available within 5000ms; consult HAR and originating HTTP record')), 5000); })]); store.event('browser.response.body', { id, requestId, body: store.blob(body), timing: response.request().timing() }); }
        catch (error) { store.event('browser.response.body.unavailable', { id, requestId, error }); }
        finally { clearTimeout(bodyTimeout); }
      })(), `response:${response.url()}`));
      page.on('requestfailed', (request) => store.event('browser.requestfailed', { id, requestId: seenRequests.get(request), url: request.url(), failure: request.failure() }));
      page.on('websocket', (socket) => {
        const socketId = store.id();
        store.event('browser.ws.open', { id, socketId, url: socket.url() });
        for (const direction of ['framesent', 'framereceived']) socket.on(direction, ({ payload }) => store.event(`browser.ws.${direction}`, { id, socketId, payload: store.blob(Buffer.isBuffer(payload) ? payload : String(payload)) }));
        socket.on('close', () => store.event('browser.ws.close', { id, socketId }));
      });
      for (const name of ['move', 'down', 'up']) wrapMethod(page.mouse, name, 'page.mouse');
      for (const name of ['goto', 'reload', 'evaluate']) wrapMethod(page, name, 'page');
      // The app closes pages before contexts; take the final snapshot before page.close.
      const closePage = page.close.bind(page);
      page.close = async (...args) => {
        await drainTasks();
        await snapshot(page, 'before-close').catch((error) => store.event('recording.error', { id, scope: 'final-snapshot', error }));
        // Persistent Chrome can terminate with its final page. Flush HAR/trace
        // through the native context close before that termination occurs.
        if (context.pages().length === 1) { store.event('browser.final-page.flush', { id }); return recordedClose(); }
        return closePage(...args);
      };
    }
    for (const page of context.pages()) observePage(page);
    context.on('page', observePage);
    for (const name of ['addInitScript', 'addCookies', 'cookies']) wrapMethod(context, name, 'context');
    const close = context.close.bind(context);
    let closing;
    const recordedClose = (...args) => closing ??= (async () => {
      await drainTasks();
      try { await context.tracing.stop({ path: join(dir, 'trace.zip') }); } catch (error) { store.event('recording.error', { id, scope: 'trace', error }); }
      await close(...args);
      if (existsSync(profile)) await snapshotProfile(profile, join(dir, 'profile-after'));
      store.event('browser.close', { id, dir });
    })();
    context.close = recordedClose;
    return context;
  };
}
