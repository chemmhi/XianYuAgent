import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { BrowserContext } from 'patchright';
import { createPatchrightVerificationBrowserFactory } from '../../src/patchright-verification-browser.js';
import type { XianyuVerificationBrowserFactory } from '../../src/xianyu-browser-port.js';

export function readBrowserFixture(api: string, userId: string, outcome = 'success') {
  const base = createPatchrightVerificationBrowserFactory();
  const requests: string[] = [];
  let slides = 0;
  let finishes = 0;
  let identityPassed = false;
  const factory: XianyuVerificationBrowserFactory = { launchPersistentContext: async options => {
    const context = await base.launchPersistentContext(options);
    await (context as unknown as BrowserContext).route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/punish') {
        assert.equal(url.searchParams.get('source'), 'browser');
        await route.fulfill({ status: 200, contentType: 'text/html', headers: { 'access-control-allow-origin': (await request.allHeaders()).origin ?? 'https://www.goofish.com', 'access-control-allow-credentials': 'true' }, body: `<!doctype html><style>
          .nc-container{position:fixed;left:200px;top:200px;width:300px;height:34px}
          .nc_scale{position:relative;width:300px;height:34px;background:#ccc}
          #nc_1_n1z{position:absolute;left:0;top:2px;width:42px;height:30px;background:#444;user-select:none}
          </style><div class="nc-container"><div id="nc_1_n1t" class="nc_scale"><div id="nc_1_n1z"></div></div></div><script>
          let held=false,submitted=false,start=0,distance=0,trusted=0;const button=document.querySelector('#nc_1_n1z');
          button.addEventListener('mousedown',e=>{held=true;start=e.clientX;});
          document.addEventListener('mousemove',e=>{if(held){distance=e.clientX-start;trusted+=Number(e.isTrusted);button.style.left=Math.min(258,Math.max(0,distance))+'px';}});
          document.addEventListener('mouseup',()=>{held=false;});
          button.addEventListener('click',async()=>{if(distance>=258&&!submitted){submitted=true;const verdict=await (await fetch('/slide?kind=${url.searchParams.get('kind')}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({distance,trusted})})).json();
          if(verdict.code===0&&${JSON.stringify(outcome.startsWith('async-'))})setTimeout(()=>{${outcome === 'async-navigation' ? "location.href='/finish'" : "void fetch('/finish')"}},50);}});
          </script>` });
        return;
      }
      if (url.pathname === '/slide') {
        slides++;
        assert.ok(request.postDataJSON().trusted > 20, 'actual trusted pointer events required');
        assert.ok(request.postDataJSON().distance >= 258);
        if (url.searchParams.get('kind') === 'identity') identityPassed = true;
        await route.fulfill({ status: 200, headers: { 'content-type': 'application/json',
          'set-cookie': `${outcome.startsWith('async-') ? 'x5secdata=callback-needed' : 'x5sec=read-passed'}; Domain=.goofish.com; Path=/; Secure; SameSite=None` }, body: JSON.stringify({ code: 0, success: true }) });
        return;
      }
      if (url.pathname === '/finish') {
        await new Promise(resolve => setTimeout(resolve, 1_200));
        assert.ok((await context.cookies()).some(cookie => cookie.name === 'x5secdata' && cookie.value === 'callback-needed'), 'callback cookies must survive until the session exchange completes');
        finishes++;
        await route.fulfill({ status: 200, headers: { 'content-type': 'text/html',
          'set-cookie': 'x5sec=read-passed; Domain=.goofish.com; Path=/; Secure; SameSite=None' }, body: '<!doctype html><p>session exchange completed</p>' });
        return;
      }
      if (!url.pathname.startsWith('/h5/')) {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>ready</p>' });
        return;
      }
      const currentApi = url.searchParams.get('api')!;
      requests.push(currentApi);
      const headers = await request.allHeaders();
      const data = new URLSearchParams(request.postData() ?? '').get('data')!;
      const token = (headers.cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith('_m_h5_tk='))?.split('=')[1].split('_')[0] ?? '';
      assert.equal(url.searchParams.get('sign'), createHash('md5').update(`${token}&${url.searchParams.get('t')}&34839810&${data}`).digest('hex'));
      if (currentApi === api && api.includes('merchant.sold')) {
        assert.equal(headers.origin, 'https://seller.goofish.com');
        assert.equal(url.searchParams.get('type'), 'json');
      }
      const identityChallenge = currentApi.endsWith('loginuser.get') && outcome === 'identity-challenge' && !identityPassed;
      const blocked = currentApi === api && (!(headers.cookie ?? '').includes('x5sec=read-passed') || outcome === 'persistent');
      if (blocked && outcome === 'html-challenge-link') {
        await route.fulfill({ status: 200, headers: { 'content-type': 'text/html',
          'access-control-allow-origin': headers.origin ?? 'https://www.goofish.com', 'access-control-allow-credentials': 'true' },
          body: '<html><meta http-equiv="refresh" content="0;url=https://www.goofish.com/punish?source=browser&amp;kind=read"><div id="captcha">verify</div></html>' });
        return;
      }
      if (outcome === 'html-without-url') {
        await route.fulfill({ status: 403, headers: { 'content-type': 'text/html', 'access-control-allow-origin': headers.origin!, 'access-control-allow-credentials': 'true' },
          body: '<html><div id="captcha">verify</div></html>' });
        return;
      }
      const payload = blocked && outcome === 'top-level-url' ? { url: 'https://www.goofish.com/punish?source=browser&kind=read' }
        : outcome === 'session-expired' ? { ret: ['FAIL_SYS_SESSION_EXPIRED::expired'] }
        : blocked || identityChallenge ? { ret: ['FAIL_SYS_USER_VALIDATE::verify'], data: { url: `https://www.goofish.com/punish?source=browser&kind=${identityChallenge ? 'identity' : 'read'}` } }
        : { ret: ['SUCCESS::ok'], data: currentApi.endsWith('loginuser.get') ? { userId: outcome === 'wrong-account' ? 'other' : userId } : {} };
      await route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': headers.origin ?? 'https://www.goofish.com',
        'access-control-allow-credentials': 'true' }, body: JSON.stringify(payload) });
    });
    return context;
  } };
  return { factory, requests, slides: () => slides, finishes: () => finishes };
}
