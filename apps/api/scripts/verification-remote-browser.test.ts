import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext } from 'patchright';
import { createPatchrightVerificationBrowserFactory } from '../src/patchright-verification-browser.js';
import { VerificationRemoteBrowser } from '../src/verification-remote-browser.js';

test('a stale pump candidate or transient encoder failure never releases a newer live human drag', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'verification-pump-candidate-'));
  const context = await createPatchrightVerificationBrowserFactory().launchPersistentContext({ profileDir: profile, headless: true, hideWindow: false });
  await (context as unknown as BrowserContext).route('**/*', route => route.fulfill({ contentType: 'text/html;charset=utf-8', body:
    '<div class="nc-container" style="width:320px;height:50px;background:#ddd"><span id="nc_1_n1z" style="display:block;width:42px;height:30px">拖</span></div><script>document.body.dataset.ups="0";document.onmouseup=()=>document.body.dataset.ups=String(Number(document.body.dataset.ups)+1);</script>' }));
  const page = context.pages()[0]; let now = Date.now();
  const remote = new VerificationRemoteBrowser(page, { now: () => now });
  try {
    await page.goto('https://www.goofish.com/punish');
    const old = await remote.capture(); assert.ok(old);
    const part = (remote as any).frames.get(old.frameId).inputSnapshot.parts[0], evaluate = part.region.evaluate.bind(part.region);
    let unblock!: () => void, enter!: () => void, armed = true;
    const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { unblock = resolve; });
    part.region.evaluate = async (...args: any[]) => { if (armed) { armed = false; enter(); await gate; } return evaluate(...args); };
    const lateOldCandidate = remote.canSend(old); await entered;
    now += 2_001; const fresh = await remote.capture(); assert.ok(fresh);
    await remote.pointer({ ...fresh, type: 'down', x: .05, y: .3, sequence: 1 }, async () => true);
    unblock(); assert.equal(await lateOldCandidate, false, 'an old asynchronous send must not revoke a newer in-progress drag');
    assert.equal(await remote.canSend(old), false, 'an old 2s candidate must still be refused');
    assert.equal(remote.isCurrent(fresh), true, 'dropping the old candidate must preserve the fresh epoch and active mouse');
    const screenshot = (page as any).screenshot.bind(page); (page as any).screenshot = async () => { throw new Error('controlled encoder timeout'); };
    assert.equal(await remote.capture(), undefined); (page as any).screenshot = screenshot;
    assert.equal(remote.isCurrent(fresh), true, 'a transient encoding failure is not a changed security context');
    await remote.pointer({ ...fresh, type: 'move', x: .8, y: .3, sequence: 2 }, async () => true);
    assert.equal(await page.evaluate(() => document.body.dataset.ups), '0');
    await remote.pointer({ ...fresh, type: 'up', x: .8, y: .3, sequence: 3 }, async () => true);
    assert.equal(await page.evaluate(() => document.body.dataset.ups), '1');
  } finally { await remote.close(); await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('original Chrome page: cross-origin iframe and human drag produce a controlled protocol verdict', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'verification-remote-'));
  const context = await createPatchrightVerificationBrowserFactory().launchPersistentContext({ profileDir: profile, headless: true, hideWindow: false });
  let accepted = 0;
  const raw = context as unknown as BrowserContext;
  await raw.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/slide') { accepted++; await route.fulfill({ contentType: 'application/json', body: '{"code":0,"success":true}' }); return; }
    await route.fulfill({ contentType: 'text/html;charset=utf-8', body: url.hostname === 'www.goofish.com'
      ? '<p>private account data outside crop</p><iframe src="https://captcha.goofish.com/challenge" style="width:500px;height:200px"></iframe>'
      : '<div class="nc-container" style="position:relative;margin:20px;width:320px;height:50px;background:#ddd"><button id="nc_1_n1z" style="width:40px;height:50px">拖</button></div><script>let down=false;document.querySelector("button").onmousedown=()=>down=true;document.onmouseup=e=>{if(down&&e.clientX>250)fetch("/slide");down=false};</script>' });
  });
  const page = context.pages()[0];
  const remote = new VerificationRemoteBrowser(page);
  try {
    await page.goto('https://www.goofish.com/punish');
    const frame = await remote.capture(); assert.ok(frame); assert.equal(frame.width, 320); assert.equal(frame.height, 50);
    assert.ok(frame.image.length > 100); assert.equal(await remote.canSend(frame), true);
    const input = { frameId: frame.frameId, streamEpoch: frame.streamEpoch, geometryRevision: frame.geometryRevision, y: .5 };
    const started = performance.now();
    const response = (page as any).waitForResponse('**/slide');
    await remote.pointer({ ...input, type: 'down', x: .05, sequence: 1 }, async () => true);
    await remote.pointer({ ...input, type: 'move', x: .95, sequence: 2 }, async () => true);
    await remote.pointer({ ...input, type: 'up', x: .95, sequence: 3 }, async () => true);
    await response;
    assert.equal(accepted, 1);
    console.info(JSON.stringify({ evidence: 'remote-drag', elapsedMs: Math.round(performance.now() - started), bytes: frame.image.length }));
    await assert.rejects(remote.pointer({ ...input, type: 'down', x: .5, sequence: 4 }, async () => false), /CONTROL_EXPIRED/);
    await page.goto('https://www.goofish.com/im');
    assert.equal(await remote.canSend(frame), false, 'old pixels must not survive navigation');
  } finally { await remote.close(); await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('capture spanning navigation or SPA replacement is discarded; unknown pages never stream', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'verification-frame-fence-'));
  const context = await createPatchrightVerificationBrowserFactory().launchPersistentContext({ profileDir: profile, headless: true, hideWindow: false });
  await (context as unknown as BrowserContext).route('**/*', route => route.fulfill({ contentType: 'text/html;charset=utf-8',
    body: '<div class="nc-container" style="width:300px;height:50px"><button id="nc_1_n1z">verify</button></div>' }));
  const page = context.pages()[0];
  let replace = true;
  const remote = new VerificationRemoteBrowser(page, { beforeCapture: async () => {
    if (replace) { replace = false; await page.evaluate(() => { document.querySelector('.nc-container')!.outerHTML = '<p>private messages</p>'; }); }
  } });
  try {
    await page.goto('https://www.goofish.com/punish');
    assert.equal(await remote.capture(), undefined);
    assert.equal(await remote.capture(), undefined);
    await page.goto('https://untrusted.example/punish');
    assert.equal(await remote.capture(), undefined);
  } finally { await remote.close(); await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('navigation during asynchronous authorization and release cancel queued input before dispatch', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'verification-dispatch-fence-'));
  const context = await createPatchrightVerificationBrowserFactory().launchPersistentContext({ profileDir: profile, headless: true, hideWindow: false });
  await (context as unknown as BrowserContext).route('**/*', route => route.fulfill({ contentType: 'text/html;charset=utf-8',
    body: '<div class="nc-container" style="width:300px;height:50px"><button id="nc_1_n1z">verify</button></div><script>document.body.dataset.downs="0";document.onmousedown=()=>document.body.dataset.downs=String(Number(document.body.dataset.downs)+1);</script>' }));
  const page = context.pages()[0]; const remote = new VerificationRemoteBrowser(page);
  try {
    await page.goto('https://www.goofish.com/punish');
    const frame = await remote.capture(); assert.ok(frame);
    let authorizations = 0;
    await assert.rejects(remote.pointer({ ...frame, x: .1, y: .5, type: 'down', sequence: 1 }, async () => {
      if (++authorizations === 2) await page.goto('https://www.goofish.com/im');
      return true;
    }), /STALE|EXPIRED|CLOSED/);
    assert.equal(await page.evaluate(() => Number(document.body.dataset.downs)), 0, 'no mouse down may reach the new page');
    const fresh = await remote.capture(); assert.ok(fresh);
    let unblock!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const pending = remote.pointer({ ...fresh, x: .1, y: .5, type: 'down', sequence: 2 }, async () => {
      entered(); await new Promise<void>(resolve => { unblock = resolve; }); return true;
    });
    await enteredPromise;
    const released = remote.release(); unblock();
    await assert.rejects(pending, /STALE|EXPIRED|CLOSED/); await released;
    assert.equal(await page.evaluate(() => Number(document.body.dataset.downs)), 0);
    let unblockClose!: () => void; let enteredClose!: () => void;
    const closeEntered = new Promise<void>(resolve => { enteredClose = resolve; });
    const pendingClose = remote.pointer({ ...fresh, x: .1, y: .5, type: 'down', sequence: 3 }, async () => {
      enteredClose(); await new Promise<void>(resolve => { unblockClose = resolve; }); return true;
    });
    await closeEntered; const closing = remote.close(); unblockClose();
    await assert.rejects(pendingClose, /STALE|EXPIRED|CLOSED/); await closing;
    assert.equal(await page.evaluate(() => Number(document.body.dataset.downs)), 0);
  } finally { await remote.close(); await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('negative container coordinates crop only the viewport intersection', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'verification-crop-'));
  const context = await createPatchrightVerificationBrowserFactory().launchPersistentContext({ profileDir: profile, headless: true, hideWindow: false });
  await (context as unknown as BrowserContext).route('**/*', route => route.fulfill({ contentType: 'text/html;charset=utf-8', body:
    '<div class="nc-container" style="position:absolute;left:-100px;top:-10px;width:320px;height:50px"><button id="nc_1_n1z">verify</button></div><p>private</p>' }));
  const page = context.pages()[0]; const remote = new VerificationRemoteBrowser(page);
  try {
    await page.goto('https://www.goofish.com/punish');
    await (page as any).setViewportSize({ width: 400, height: 300 });
    for (const [x, y, width, height, expectedWidth, expectedHeight] of [
      [-100, -10, 320, 50, 220, 40], [350, 20, 100, 50, 50, 50], [10, 270, 100, 50, 100, 30], [500, 20, 100, 50, 0, 0],
    ]) {
      await page.evaluate(({ x, y, width, height }) => {
        Object.assign((document.querySelector('.nc-container') as HTMLElement).style,
          { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
      }, { x, y, width, height });
      const frame = await remote.capture() ?? await remote.capture();
      if (expectedWidth === 0) assert.equal(frame, undefined);
      else { assert.ok(frame); assert.equal(frame.width, expectedWidth); assert.equal(frame.height, expectedHeight); }
    }
  } finally { await remote.close(); await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('top-level and iframe navigation during capture are discarded, as are frames invalidated before send', async () => {
  for (const kind of ['top', 'iframe', 'before-send'] as const) {
    const profile = await mkdtemp(join(tmpdir(), `verification-nav-${kind}-`));
    const context = await createPatchrightVerificationBrowserFactory().launchPersistentContext({ profileDir: profile, headless: true, hideWindow: false });
    const raw = context as unknown as BrowserContext;
    await raw.route('**/*', route => {
      const url = new URL(route.request().url());
      return route.fulfill({ contentType: 'text/html;charset=utf-8', body: url.pathname === '/private'
        ? '<p style="background:magenta">private messages</p>' : url.hostname === 'www.goofish.com'
          ? '<iframe src="https://captcha.goofish.com/challenge"></iframe>'
          : '<div class="nc-container" style="width:280px;height:50px"><button id="nc_1_n1z">verify</button></div>' });
    });
    const page = context.pages()[0];
    const navigate = async () => {
      if (kind === 'iframe') await (page as any).frames()[1].goto('https://captcha.goofish.com/private');
      else await page.goto('https://www.goofish.com/private');
    };
    const remote = new VerificationRemoteBrowser(page, { beforeCapture: kind === 'before-send' ? undefined : navigate });
    try {
      await page.goto('https://www.goofish.com/punish');
      const frame = await remote.capture();
      if (kind === 'before-send') { assert.ok(frame); await navigate(); assert.equal(await remote.canSend(frame), false); }
      else assert.equal(frame, undefined, kind);
    } finally { await remote.close(); await context.close(); await rm(profile, { recursive: true, force: true }); }
  }
});

test('scaled pointer/touch input maps to the original page and JPEG excludes adjacent private pixels', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'verification-touch-'));
  const context = await createPatchrightVerificationBrowserFactory().launchPersistentContext({ profileDir: profile, headless: true, hideWindow: false });
  const raw = context as unknown as BrowserContext;
  await raw.route('**/*', route => route.fulfill({ contentType: 'text/html;charset=utf-8', body:
    '<body style="margin:0;background:rgb(255,0,255)"><input type="text" hidden disabled id="fixture-events" value=""><div class="nc-container" style="position:absolute;left:-100px;top:0;width:320px;height:50px;background:rgb(0,200,0)"><button id="nc_1_n1z">verify</button></div><script>document.getElementById("fixture-events").value="";document.onmousedown=e=>document.getElementById("fixture-events").value+=`down:${e.isTrusted}:${Math.round(e.clientX)},`;document.onmouseup=e=>document.getElementById("fixture-events").value+="up,";</script>' }));
  const page = context.pages()[0]; const remote = new VerificationRemoteBrowser(page);
  const { chromium } = await import('patchright');
  const operator = await chromium.launch({ channel: 'chrome', headless: true });
  const operatorContext = await operator.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const view = await operatorContext.newPage(); let sequence = 0; const inputs: Promise<void>[] = [];
  try {
    await page.goto('https://www.goofish.com/punish');
    const frame = await remote.capture(); assert.ok(frame);
    await view.exposeFunction('remoteInput', (type: 'down' | 'up', x: number, y: number) => {
      const task = remote.pointer({ ...frame, type, x, y, sequence: ++sequence }, async () => true); inputs.push(task); return task;
    });
    await view.setContent(`<img id="frame" style="width:330px;height:75px;touch-action:none" src="data:image/jpeg;base64,${frame.image.toString('base64')}"><script>
      const image=document.querySelector('img'); for(const [event,type] of [['pointerdown','down'],['pointerup','up']]) image.addEventListener(event,e=>{e.preventDefault(); const r=image.getBoundingClientRect(); void remoteInput(type,(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height)});
      </script>`);
    await view.locator('#frame').evaluate(async image => { await (image as HTMLImageElement).decode(); });
    const pixel = await view.locator('#frame').evaluate(image => {
      const canvas = document.createElement('canvas'); canvas.width = (image as HTMLImageElement).naturalWidth; canvas.height = 50;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image as HTMLImageElement, 0, 0);
      return Array.from(ctx.getImageData(canvas.width - 2, 25, 1, 1).data);
    });
    assert.ok(pixel[0] < 20 && pixel[1] > 170 && pixel[2] < 20, `crop leaked adjacent pixels: ${pixel}`);
    await view.touchscreen.tap(173, 45); await Promise.all(inputs);
    assert.match(await page.evaluate(() => (document.getElementById('fixture-events') as HTMLInputElement).value), /down:true:10[89],up,/);
    await remote.close();
    await assert.rejects(remote.pointer({ ...frame, type: 'down', x: .5, y: .5, sequence: ++sequence }, async () => true), /STALE|CLOSED/);
  } finally { await operator.close(); await remote.close(); await context.close(); await rm(profile, { recursive: true, force: true }); }
});
