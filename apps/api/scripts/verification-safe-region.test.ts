import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'patchright';
import { createPatchrightVerificationBrowserFactory } from '../src/patchright-verification-browser.js';
import { VerificationRemoteBrowser } from '../src/verification-remote-browser.js';

const native = `<body style="margin:0;width:420px;height:320px;background:white">
  <h2 style="margin:0;height:60px;background:rgb(0,0,230)">安全验证</h2>
  <p style="height:40px;background:rgb(0,190,0)">请按住滑块，拖动完成验证</p>
  <div class="nc-container" style="margin:20px;width:300px;height:34px;background:#ddd"><button id="nc_1_n1z" style="width:42px;height:30px">拖</button></div>
  <button id="nc_1_refresh1" style="position:absolute;left:50px;top:220px;width:100px;height:40px;background:rgb(230,80,0)" onclick="document.body.dataset.refresh='true'">刷新重试</button>
  <script>document.body.dataset.refresh='false';</script>`;

async function fixture(html: (url: URL) => string, run: (page: Page, remote: VerificationRemoteBrowser) => Promise<void>) {
  const profile = await mkdtemp(join(tmpdir(), 'verification-safe-roi-'));
  const context = await createPatchrightVerificationBrowserFactory().launchPersistentContext({ profileDir: profile, headless: true, hideWindow: false });
  const raw = context as unknown as BrowserContext, page = context.pages()[0] as unknown as Page;
  await raw.route('**/*', route => route.fulfill({ contentType: 'text/html;charset=utf-8', body: html(new URL(route.request().url())) }));
  const remote = new VerificationRemoteBrowser(context.pages()[0]);
  try { await run(page, remote); } finally { await remote.close(); await context.close(); await rm(profile, { recursive: true, force: true }); }
}

test('dedicated native punish iframe includes instructions and refresh, maps clicks and excludes private parent pixels', async () => {
  await fixture(url => url.hostname === 'www.goofish.com'
    ? '<body style="margin:0;background:rgb(255,0,255)"><p data-private>private conversation</p><iframe style="position:absolute;left:90px;top:90px;width:420px;height:320px;border:0" src="https://h5api.m.goofish.com/_____tmd_____/punish"></iframe>' : native,
  async (page, remote) => {
    await page.goto('https://www.goofish.com/im');
    const frame = await remote.capture(); assert.ok(frame);
    assert.equal(frame.regionKind, 'challenge_document'); assert.equal(frame.width, 420); assert.equal(frame.height, 320);
    const colors = await page.evaluate(async jpeg => {
      const image = new Image(); image.src = `data:image/jpeg;base64,${jpeg}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
      let privatePixels = 0, title = 0, instruction = 0, refresh = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        if (r > 200 && b > 200 && g < 40) privatePixels++;
        if (b > 160 && r < 40 && g < 40) title++;
        if (g > 140 && r < 40 && b < 40) instruction++;
        if (r > 180 && g > 40 && g < 120 && b < 40) refresh++;
      }
      return { privatePixels, title, instruction, refresh };
    }, frame.image.toString('base64'));
    assert.equal(colors.privatePixels, 0); assert.ok(colors.title > 1000); assert.ok(colors.instruction > 1000); assert.ok(colors.refresh > 500);
    await remote.pointer({ ...frame, type: 'down', x: 100 / 419, y: 240 / 319, sequence: 1 }, async () => true);
    await remote.pointer({ ...frame, type: 'up', x: 100 / 419, y: 240 / 319, sequence: 2 }, async () => true);
    assert.equal(await page.frames()[1].evaluate(() => document.body.dataset.refresh), 'true', 'native refresh outside inner bar is actually clickable');
    await page.frames()[1].goto('https://h5api.m.goofish.com/private');
    assert.equal(await remote.canSend(frame), false);
  });
});

test('1920px native layout wrappers produce a tight readable ROI around painted challenge content', async () => {
  await fixture(() => `<body style="margin:0;width:1920px;height:1080px;background:white">
    <p style="position:absolute;left:802px;top:550px;margin:0;color:blue">请拖动滑块完成安全验证</p>
    <div class="nc-container" style="position:absolute;left:0;top:609.5px;width:1920px;height:34px">
      <div class="nc_scale" style="position:absolute;left:802px;width:300px;height:34px;background:#ddd"><button id="nc_1_n1z" style="position:absolute;left:2px;top:2px;width:42px;height:30px">拖</button></div>
    </div><button id="nc_1_refresh1" style="position:absolute;left:802px;top:660px;width:100px;height:30px" onclick="document.body.dataset.refresh='true'">刷新重试</button>`, async (page, remote) => {
    await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto('https://h5api.m.goofish.com//h5/mtop.taobao.idlemessage.pc.login.token/1.0/_____tmd_____/punish');
    const frame = await remote.capture(); assert.ok(frame); assert.equal(frame.regionKind, 'challenge_document');
    assert.ok(frame.width >= 300 && frame.width <= 340, `full width wrapper must not shrink the actual 300px bar: ${frame.width}`);
    assert.ok(frame.height > 120 && frame.height < 180, `instructions and refresh remain in the ROI: ${frame.height}`);
    const saved = (remote as any).frames.get(frame.frameId).geometry;
    await remote.pointer({ ...frame, type: 'down', x: (850 - saved.x) / (frame.width - 1), y: (675 - saved.y) / (frame.height - 1), sequence: 1 }, async () => true);
    await remote.pointer({ ...frame, type: 'up', x: (850 - saved.x) / (frame.width - 1), y: (675 - saved.y) / (frame.height - 1), sequence: 2 }, async () => true);
    assert.equal(await page.evaluate(() => document.body.dataset.refresh), 'true');
  });
});

test('business documents only show explicit complete challenge containers; incomplete/unknown/oversized regions fail closed', async () => {
  let mode = 'safe';
  await fixture(() => mode === 'safe'
    ? `<body style="background:magenta"><p data-private>private conversation</p><section class="captcha-wrapper" style="position:absolute;left:20px;top:60px;width:420px;height:320px;background:white">${native.replace('<body style="margin:0;width:420px;height:320px;background:white">', '')}</section>`
    : mode === 'incomplete'
      ? '<div class="captcha-wrapper"><div class="nc-container" style="width:300px;height:34px"><button id="nc_1_n1z">拖</button></div></div><button id="nc_1_refresh1">刷新重试</button>'
      : mode === 'private'
        ? `${native}<p data-private>private conversation</p>`
        : '<body style="margin:0;width:1200px;height:900px"><h1 style="width:1100px">安全验证</h1><div class="nc-container" style="width:1100px;height:600px"><button id="nc_1_n1z">拖</button></div><button id="nc_1_refresh1" style="position:absolute;left:1100px;top:850px">刷新</button>',
  async (page, remote) => {
    await page.goto('https://www.goofish.com/im'); const safe = await remote.capture(); assert.ok(safe);
    assert.equal(safe.regionKind, 'challenge_container'); assert.equal(safe.width, 420); assert.equal(safe.height, 320);
    mode = 'incomplete'; await page.goto('https://www.goofish.com/im'); assert.equal(await remote.capture(), undefined);
    mode = 'private'; await page.goto('https://www.goofish.com/im'); assert.equal(await remote.capture(), undefined, 'ordinary page must never expand to body to include controls');
    await page.goto('https://h5api.m.goofish.com/_____tmd_____/punish'); assert.equal(await remote.capture(), undefined, 'dedicated URL alone does not authorize business content');
    mode = 'oversized'; await page.goto('https://h5api.m.goofish.com/_____tmd_____/punish'); assert.equal(await remote.capture(), undefined);
  });
});

test('CSS/native media outside the bar are retained, while oversized/overflow drawings cannot be silently omitted', async () => {
  let mode = 'background';
  await fixture(() => `<body style="margin:0;width:1920px;height:1080px"><p style="position:absolute;left:800px;top:400px">安全验证</p>
    <div style="position:absolute;left:800px;top:450px;width:${mode === 'oversized' ? 800 : 300}px;height:120px;${mode === 'pseudo' ? '' : 'background-image:linear-gradient(blue,green)'}" class="native-picture"></div>
    ${mode.startsWith('pseudo') ? `<style>.native-picture::before{content:"";position:absolute;inset:0;background-image:linear-gradient(blue,green);${mode === 'pseudo-overflow' ? 'width:900px;height:120px' : ''}}</style>` : ''}
    <div class="nc-container" style="position:absolute;left:800px;top:600px;width:300px;height:34px"><button id="nc_1_n1z">拖</button></div>`, async (page, remote) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    for (mode of ['background', 'pseudo', 'oversized', 'pseudo-overflow']) {
      await page.goto('https://h5api.m.goofish.com/_____tmd_____/punish'); const frame = await remote.capture();
      if (['oversized', 'pseudo-overflow'].includes(mode)) assert.equal(frame, undefined, 'oversized native media must close the whole view');
      else { assert.ok(frame); assert.ok(frame.height >= 200, `CSS verification image/icon remains above the bar in the frame: ${frame.height}`); }
    }
  });
});

test('parent overlays covering the trusted iframe invalidate all composed pixels including pointer-events:none', async () => {
  await fixture(url => url.hostname === 'www.goofish.com'
    ? '<iframe style="position:absolute;left:90px;top:90px;width:420px;height:320px;border:0" src="https://h5api.m.goofish.com/_____tmd_____/punish"></iframe>' : native,
  async (page, remote) => {
    await page.goto('https://www.goofish.com/im'); const initial = await remote.capture(); assert.ok(initial);
    for (const pointerEvents of ['auto', 'none']) {
      await page.evaluate(pointerEvents => {
        document.querySelector('#overlay')?.remove(); const overlay = document.createElement('aside'); overlay.id = 'overlay'; overlay.dataset.private = 'true'; overlay.textContent = 'private messages';
        Object.assign(overlay.style, { position: 'absolute', left: '90px', top: '90px', width: '420px', height: '320px', background: 'magenta', zIndex: '999', pointerEvents }); document.body.append(overlay);
      }, pointerEvents);
      assert.equal(await remote.canSend(initial), false); assert.equal(await remote.capture(), undefined, 'a trusted child URL never authorizes parent overlay pixels');
    }
  });
});

test('cached boundaries still reject CSSOM-only private reveal and a same-box 180 degree parent transform', async () => {
  await fixture(url => url.hostname === 'www.goofish.com'
    ? '<style id="rules"></style><iframe style="position:absolute;left:90px;top:90px;width:420px;height:320px;border:0" src="https://h5api.m.goofish.com/_____tmd_____/punish"></iframe>'
    : `${native}<style id="rules">#hidden-content{display:none}</style><div id="hidden-content" style="position:absolute;left:20px;top:280px">private conversation</div>`, async (page, remote) => {
    for (const mode of ['private', 'rotate', 'pseudo']) {
      await page.goto('https://www.goofish.com/im'); const frame = await remote.capture(); assert.ok(frame);
      if (mode === 'private') await page.frames()[1].evaluate(() => (document.querySelector('#rules') as HTMLStyleElement).sheet!.insertRule('#hidden-content{display:block}', 1));
      else if (mode === 'pseudo') await page.frames()[1].evaluate(() => (document.querySelector('#rules') as HTMLStyleElement).sheet!.insertRule('.nc-container::after{content:"private";position:fixed;left:0;top:0;width:900px;height:40px;background:magenta}', 1));
      else await page.evaluate(() => (document.querySelector('#rules') as HTMLStyleElement).sheet!.insertRule('iframe{transform:rotate(180deg)}', 0));
      assert.equal(await remote.canSend(frame), false, mode);
      assert.equal(await remote.capture(), undefined, mode);
    }
  });
});

test('native progress/style updates sustain 12 real moves at 35ms plus final up within the original 2s frame lifetime', async () => {
  await fixture(() => `<body style="margin:0;width:1920px;height:1080px"><p style="position:absolute;left:802px;top:550px">请拖动滑块完成安全验证</p>
    <div class="nc-container" style="position:absolute;left:802px;top:610px;width:300px;height:34px;background:#ddd">
      <div class="nc_scale" style="position:absolute;left:0;top:0;height:34px;width:0;background:green"></div>
      <span id="nc_1_n1z" role="button" tabindex="0" style="position:absolute;left:2px;top:2px;width:42px;height:30px">拖</span></div>
    <button id="nc_1_refresh1" style="position:absolute;left:802px;top:660px;width:100px;height:30px">刷新重试</button>
    <script>let down=false;document.querySelector('#nc_1_n1z').onmousedown=e=>{down=true;e.currentTarget.setAttribute('data-spm-anchor-id','fixture-tracking');};document.onmousemove=e=>{if(down){document.querySelector('.nc_scale').style.width=Math.max(0,e.clientX-802)+'px';document.querySelector('#nc_1_n1z').style.left=Math.min(258,Math.max(2,e.clientX-820))+'px';}};document.onmouseup=e=>{document.body.dataset.accepted=String(down&&e.clientX>1050&&e.isTrusted);down=false;};</script>`, async (page, remote) => {
    await page.setViewportSize({ width: 1920, height: 1080 }); await page.goto('https://h5api.m.goofish.com//h5/mtop.taobao.idlemessage.pc.login.token/1.0/_____tmd_____/punish');
    const frame = await remote.capture(); assert.ok(frame);
    const geometry = (remote as any).frames.get(frame.frameId).geometry, started = performance.now(); let sequence = 0;
    const pending: Promise<void>[] = [];
    pending.push(remote.pointer({ ...frame, type: 'down', x: (820 - geometry.x) / (frame.width - 1), y: (625 - geometry.y) / (frame.height - 1), sequence: ++sequence }, async () => true));
    for (let step = 1; step <= 12; step++) {
      await new Promise(resolve => setTimeout(resolve, 35));
      pending.push(remote.pointer({ ...frame, type: 'move', x: (820 + step * 22.5 - geometry.x) / (frame.width - 1), y: (625 - geometry.y) / (frame.height - 1), sequence: ++sequence }, async () => true));
    }
    pending.push(remote.pointer({ ...frame, type: 'move', x: (1090 - geometry.x) / (frame.width - 1), y: (625 - geometry.y) / (frame.height - 1), sequence: ++sequence }, async () => true));
    pending.push(remote.pointer({ ...frame, type: 'up', x: (1090 - geometry.x) / (frame.width - 1), y: (625 - geometry.y) / (frame.height - 1), sequence: ++sequence }, async () => true));
    await Promise.all(pending);
    assert.equal(await page.evaluate(() => document.body.dataset.accepted), 'true');
    assert.ok(performance.now() - started < 1_900, 'native drag completed before the original frame expired');
    console.info(JSON.stringify({ evidence: 'native-progress-drag-12x35ms', elapsedMs: Math.round(performance.now() - started) }));
  });
});

test('input snapshots reject style/class reveal of existing unknown descendants and non-motion native styles', async () => {
  await fixture(() => '<style>.unknown{display:none}.unknown.shown{display:block}</style><div class="nc-container" style="position:relative;width:320px;height:50px"><button id="nc_1_n1z" style="position:absolute;left:2px;width:42px;height:30px">拖</button><div id="unknown-style" style="display:none">private messages</div><div id="unknown-class" class="unknown">private messages</div><div id="unknown-paint" style="display:none;width:100px;height:30px"></div></div>', async (page, remote) => {
    let sequence = 0;
    for (const change of ['unknown-style', 'unknown-class', 'unknown-paint', 'native-image', 'native-class']) {
      await page.goto('https://www.goofish.com/im'); const frame = await remote.capture(); assert.ok(frame);
      await page.evaluate(change => {
        if (change === 'unknown-class') document.getElementById(change)!.classList.add('shown');
        else if (change === 'unknown-paint') Object.assign(document.getElementById(change)!.style, { display: 'block', backgroundImage: 'linear-gradient(red,blue)' });
        else if (change === 'native-image') document.getElementById('nc_1_n1z')!.style.backgroundImage = 'linear-gradient(red,blue)';
        else if (change === 'native-class') document.getElementById('nc_1_n1z')!.classList.add('different-action');
        else document.getElementById(change)!.style.display = 'block';
      }, change);
      await assert.rejects(remote.pointer({ ...frame, type: 'down', x: .1, y: .5, sequence: ++sequence }, async () => true), /STALE/, change);
    }
  });
});

test('attribute diagnosis reports only finite attribute/node categories and still refuses native telemetry changes', async () => {
  await fixture(() => '<div class="nc-container" style="width:320px;height:50px"><button id="nc_1_n1z" style="width:42px;height:30px">拖</button></div>', async (page, remote) => {
    for (const [attribute, expected] of [['data-spm-anchor-id', 'SPM_ANCHOR_ID_HANDLE_GUARD_UNARMED'], ['data-private-secret-name', 'OTHER_HANDLE']]) {
      await page.goto('https://www.goofish.com/im'); const frame = await remote.capture(); assert.ok(frame);
      await page.locator('#nc_1_n1z').evaluate((node, attribute) => node.setAttribute(attribute, 'private-value-never-logged'), attribute);
      await assert.rejects(remote.pointer({ ...frame, type: 'down', x: .1, y: .5, sequence: 1 }, async () => true), error => {
        assert.equal((error as Error).message, `VERIFICATION_FRAME_STALE_DOM_ATTRIBUTE_${expected}`); return true;
      });
    }
  });
});

test('only armed native-handle tracking with identical document paint is compatible with down', async () => {
  let mode = 'safe';
  await fixture(() => `<style>#unknown{display:none}${mode === 'css-delayed' ? '#unknown{display:block;opacity:0;transition:opacity 1s 1s}.nc-container:has([data-spm-anchor-id]) #unknown{opacity:1}' : ''}${mode === 'css-reveal' ? '.nc-container:has([data-spm-anchor-id]) #unknown{display:block}' : ''}${mode === 'css-pseudo' ? '#nc_1_n1z[data-spm-anchor-id]::after{content:attr(data-spm-anchor-id);background:red}' : ''}</style>
    <div class="nc-container" style="position:relative;width:320px;height:50px;background:#ddd"><span id="nc_1_n1z" role="button" tabindex="0" style="position:absolute;left:2px;width:42px;height:30px">拖</span><div id="unknown" style="width:40px;height:20px;background:magenta;pointer-events:none">${mode === 'css-delayed' ? '' : 'private content'}</div></div>
    <script>document.querySelector('#nc_1_n1z').onmousedown=e=>{${mode === 'other-attribute' ? "e.currentTarget.setAttribute('data-other','value')" : mode === 'other-node' ? "document.querySelector('.nc-container').setAttribute('data-spm-anchor-id','tracking')" : mode === 'class' ? "e.currentTarget.classList.add('changed')" : "e.currentTarget.setAttribute('data-spm-anchor-id','tracking')"}};</script>`, async (page, remote) => {
    let sequence = 0;
    for (mode of ['safe', 'css-reveal', 'css-pseudo', 'css-delayed', 'other-attribute', 'other-node', 'class']) {
      await page.goto('https://www.goofish.com/im'); const frame = await remote.capture(); assert.ok(frame, mode);
      await remote.pointer({ ...frame, type: 'down', x: .05, y: .3, sequence: ++sequence }, async () => true);
      const move = () => remote.pointer({ ...frame, type: 'move', x: .3, y: .3, sequence: ++sequence }, async () => true);
      if (mode === 'safe') {
        await move(); await remote.pointer({ ...frame, type: 'up', x: .3, y: .3, sequence: ++sequence }, async () => true);
        assert.equal(await page.locator('#nc_1_n1z').getAttribute('data-spm-anchor-id'), 'tracking');
      } else await assert.rejects(move(), /VERIFICATION_FRAME_STALE/, mode);
    }
  });
});

test('original 3s infinite NC shimmer permits tracking while altered animation, paint and language remain fenced', async () => {
  let mode = 'native';
  await fixture(() => `<style>.scale_text.slidetounlock>span[data-nc-lang="SLIDE"]{display:inline-block;width:100%;background:-webkit-gradient(linear,left top,right top,color-stop(0,#4d4d4d),color-stop(.4,#4d4d4d),color-stop(.5,#fff),color-stop(.6,#4d4d4d),color-stop(1,#4d4d4d));-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:slidetounlock 3s infinite}@keyframes slidetounlock{0%{background-position:-200px 0}100%{background-position:200px 0}}</style>
    <div class="nc-container" style="position:relative;width:320px;height:50px;background:#ddd"><div class="scale_text slidetounlock"><span data-nc-lang="SLIDE">请按住滑块，拖动完成验证</span></div><span id="nc_1_n1z" role="button" tabindex="0" style="position:absolute;left:2px;top:2px;width:42px;height:30px">拖</span></div>
    <script>document.querySelector('#nc_1_n1z').onmousedown=e=>{const text=document.querySelector('[data-nc-lang]'),animation=text.getAnimations()[0];
      ${mode === 'timing' ? 'animation.effect.updateTiming({duration:4000});' : mode === 'keyframes' ? 'animation.effect.setKeyframes([{backgroundPosition:"-200px 0px",opacity:0},{backgroundPosition:"200px 0px",opacity:1}]);' : mode === 'new-animation' ? 'text.animate([{color:"red"},{color:"blue"}],{duration:3000,iterations:Infinity});' : mode === 'gradient' ? 'text.style.backgroundImage="linear-gradient(red,blue)";' : mode === 'language' ? 'text.textContent="验证内容已改变";' : ''}
      e.currentTarget.setAttribute('data-spm-anchor-id','fixture-tracking');};</script>`, async (page, remote) => {
    let sequence = 0;
    const down = page.mouse.down.bind(page.mouse);
    page.mouse.down = async options => { await new Promise(resolve => setTimeout(resolve, 40)); await down(options); };
    for (mode of ['native', 'timing', 'keyframes', 'new-animation', 'gradient', 'language']) {
      await page.goto('https://www.goofish.com/im'); const frame = await remote.capture(); assert.ok(frame, mode);
      await remote.pointer({ ...frame, type: 'down', x: .05, y: .3, sequence: ++sequence }, async () => true);
      if (mode === 'native') {
        for (let step = 1; step <= 12; step++) {
          await new Promise(resolve => setTimeout(resolve, 35));
          await remote.pointer({ ...frame, type: 'move', x: .05 + step * .06, y: .3, sequence: ++sequence }, async () => true);
        }
        await remote.pointer({ ...frame, type: 'up', x: .77, y: .3, sequence: ++sequence }, async () => true);
      } else await assert.rejects(remote.pointer({ ...frame, type: 'move', x: .3, y: .3, sequence: ++sequence }, async () => true), /VERIFICATION_FRAME_STALE/, mode);
    }
  });
});

test('known native error/reset controls remain visible and tracking-compatible, while generic errors and tracking CSS fail closed', async () => {
  let mode = 'known';
  await fixture(() => `<style>#unknown{display:none}${mode === 'css-reveal' ? '.errloading[data-spm-anchor-id] #unknown{display:block}' : ''}</style>
    <div class="nc-container" style="width:320px;height:50px"><div class="${mode === 'generic' ? 'unknown-wrapper' : 'nc_wrapper'}"><div ${mode === 'generic' ? '' : 'id="nc_1_refresh1"'} class="errloading" style="width:320px;height:50px">验证失败，点击框体重试<span class="nc-errcode">(300)</span><div id="unknown">private messages</div></div></div></div>
    <script>document.querySelector('.errloading').onmousedown=e=>e.currentTarget.setAttribute('data-spm-anchor-id','fixture-tracking');document.onmouseup=()=>document.body.dataset.reset='true';</script>`, async (page, remote) => {
    let sequence = 0;
    for (mode of ['known', 'css-reveal', 'generic']) {
      await page.goto('https://www.goofish.com/im'); const frame = await remote.capture();
      if (mode === 'generic') { assert.equal(frame, undefined, 'a generic error class cannot establish an NC reset control'); continue; }
      assert.ok(frame);
      await remote.pointer({ ...frame, type: 'down', x: .9, y: .8, sequence: ++sequence }, async () => true);
      const up = () => remote.pointer({ ...frame, type: 'up', x: .9, y: .8, sequence: ++sequence }, async () => true);
      if (mode === 'css-reveal') { await assert.rejects(up(), /VERIFICATION_FRAME_STALE/); assert.equal(await remote.capture(), undefined); }
      else { await up(); assert.equal(await page.evaluate(() => document.body.dataset.reset), 'true'); }
    }
  });
});

test('fast input snapshots still reject changed structure and newly painted external overlays', async () => {
  let mode = 'replace';
  await fixture(() => '<body><div class="nc-container" style="width:320px;height:50px"><button id="nc_1_n1z">拖</button></div>', async (page, remote) => {
    for (mode of ['replace', 'overlay']) {
      await page.goto('https://www.goofish.com/im'); const frame = await remote.capture(); assert.ok(frame);
      await page.evaluate(mode => {
        if (mode === 'replace') document.querySelector('.nc-container')!.innerHTML = '<button id="nc_1_n1z">different action</button>';
        else { const overlay = document.createElement('p'); overlay.dataset.private = 'true'; overlay.textContent = 'private message'; overlay.style.cssText = 'position:absolute;left:8px;top:8px;width:320px;height:50px;background:magenta;z-index:999'; document.body.append(overlay); }
      }, mode);
      await assert.rejects(remote.pointer({ ...frame, type: 'down', x: .1, y: .5, sequence: 1 }, async () => true), /STALE/);
    }
  });
});

test('pointer-transparent img/canvas/svg overlays are rejected for composed iframes and fast top-page inputs', async () => {
  let variant = 'iframe';
  await fixture(url => url.hostname !== 'www.goofish.com' ? native : variant === 'iframe'
    ? '<iframe style="position:absolute;left:90px;top:90px;width:420px;height:320px;border:0" src="https://h5api.m.goofish.com/_____tmd_____/punish"></iframe>'
    : `<section class="captcha-wrapper" style="position:absolute;left:90px;top:90px;width:420px;height:320px">${native.replace('<body style="margin:0;width:420px;height:320px;background:white">', '')}</section>`, async (page, remote) => {
    let sequence = 0;
    for (variant of ['iframe', 'top']) for (const tag of ['img', 'canvas', 'svg', 'ancestor-pseudo']) {
      await page.goto('https://www.goofish.com/im'); const frame = await remote.capture(); assert.ok(frame, `${variant}/${tag}`);
      await page.evaluate(tag => {
        if (tag === 'ancestor-pseudo') {
          const style = document.createElement('style'); style.textContent = 'body::after{content:"private message";position:absolute;left:90px;top:90px;width:420px;height:320px;background:magenta;z-index:999;pointer-events:none}'; document.head.append(style); return;
        }
        const overlay = tag === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement(tag);
        Object.assign((overlay as HTMLElement).style, { position: 'absolute', left: '90px', top: '90px', width: '420px', height: '320px', zIndex: '999', pointerEvents: 'none' });
        if (tag === 'img') (overlay as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="420" height="320"><rect width="420" height="320" fill="magenta"/></svg>';
        if (tag === 'canvas') { (overlay as HTMLCanvasElement).width = 420; (overlay as HTMLCanvasElement).height = 320; const ctx = (overlay as HTMLCanvasElement).getContext('2d')!; ctx.fillStyle = 'magenta'; ctx.fillRect(0, 0, 420, 320); }
        if (tag === 'svg') overlay.innerHTML = '<rect width="420" height="320" fill="magenta"/>';
        document.body.append(overlay);
      }, tag);
      await assert.rejects(remote.pointer({ ...frame, type: 'down', x: .1, y: .5, sequence: ++sequence }, async () => true), /STALE/);
      assert.equal(await remote.canSend(frame), false, `${variant}/${tag} cannot send existing pixels`);
      assert.equal(await remote.capture(), undefined, `${variant}/${tag} never captures parent/sibling media`);
    }
  });
});
