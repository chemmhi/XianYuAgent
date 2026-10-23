import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { XianyuVerificationBrowser } from '../../apps/api/src/xianyu-verification-browser.ts';
import { createRecordingStore } from './store.mjs';

const root = process.env.XIANYU_RECORD_DIR;
if (!root) throw new Error('Run Chrome recording tests with XIANYU_RECORD_DIR and recorder preload');
const store = createRecordingStore(root);
const observations = [];
function challenge(mode) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>受控滑块 ${mode}</title><style>body{margin:80px;font:16px Arial}.nc-container{width:300px}.nc_scale{position:relative;width:300px;height:34px;background:#ddd}#nc_1_n1z{position:absolute;left:2px;top:2px;width:40px;height:30px;background:#4a8;touch-action:none;user-select:none}.message{padding:12px}</style><div class="nc-container"><p>受控测试：请向右滑动</p><div id="nc_1_n1t" class="nc_scale"><div id="nc_1_n1z">&gt;&gt;</div></div><div class="message"></div></div><script>
  const mode=${JSON.stringify(mode)};const button=document.querySelector('#nc_1_n1z');let held=false,start=0,moves=[];
  button.addEventListener('mousedown',event=>{held=true;start=event.clientX;moves=[{type:event.type,x:event.clientX,y:event.clientY,trusted:event.isTrusted,time:event.timeStamp}];});
  document.addEventListener('mousemove',event=>{if(!held)return;moves.push({type:event.type,x:event.clientX,y:event.clientY,trusted:event.isTrusted,time:event.timeStamp});button.style.left=Math.max(2,Math.min(260,event.clientX-start+2))+'px';});
  document.addEventListener('mouseup',async event=>{if(!held)return;held=false;moves.push({type:event.type,x:event.clientX,y:event.clientY,trusted:event.isTrusted,time:event.timeStamp});const completed=event.clientX-start>=256&&moves.length>20&&moves.every(item=>item.trusted);const observed=await fetch('/observe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode,completed,moves})});await observed.text();if(mode==='failure'||!completed){document.querySelector('.message').textContent='验证失败';return;}if(mode!=='no-cookie')document.cookie='x5sec='+ (mode==='stale'?'old-cookie':'fresh-'+mode)+'; Path=/';parent.location.href='/im?mode='+mode;});
  </script></html>`;
}
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/observe') { let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{observations.push(JSON.parse(body));res.end('saved');}); return; }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (url.pathname === '/punish') res.end(url.searchParams.get('mode') === 'iframe' ? '<!doctype html><title>iframe slider</title><iframe style="width:700px;height:400px;border:0" src="/frame?mode=iframe"></iframe>' : challenge(url.searchParams.get('mode')));
  else if (url.pathname === '/frame') res.end(challenge('iframe'));
  else res.end('<!doctype html><title>verified fixture</title><p>受控验证已完成</p>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
store.event('fixture.start', { origin, source: store.blob(readFileSync(new URL(import.meta.url)), 'mjs') });

test('real headed Chrome uses production verification flow with recorded input, drag, fingerprint and final cookies', async (t) => {
  try {
    for (const mode of ['success', 'iframe', 'failure', 'no-cookie', 'stale']) await t.test(mode, async () => {
      const input = { verificationUrl: `${origin}/punish?mode=${mode}`, profileKey: mode, initialCookieSnapshot: [{ name: 'x5sec', value: 'old-cookie', domain: '127.0.0.1', path: '/' }], allowManualFallback: false };
      const options = { mode: 'launch', sliderMode: 'auto', sliderMaxRetries: 1, headless: false, userDataDir: join(root, 'fixture-profiles'), maxWaitMs: 1500, pollIntervalMs: 50 };
      store.event('fixture.case.input', { mode, input, options });
      const browser = new XianyuVerificationBrowser(options);
      if (['success', 'iframe'].includes(mode)) {
        const output = await browser.waitForCompletion(input);
        store.event('fixture.case.output', { mode, output });
        assert.ok(output.finalUrl.includes('/im'));
        assert.equal(output.cookieSnapshot.find((c) => c.name === 'x5sec').value, `fresh-${mode}`);
      } else {
        await assert.rejects(browser.waitForCompletion(input), (error) => { store.event('fixture.case.output', { mode, error: { name: error.name, message: error.message, stack: error.stack } }); return mode === 'failure' ? error.message.startsWith('XIANYU_VERIFICATION_AUTO_SOLVE_FAILED:') : error.message === 'XIANYU_VERIFICATION_TIMEOUT'; });
      }
      const observed = observations.find((item) => item.mode === mode);
      assert.ok(observed?.completed, `${mode}: drag must really complete before testing outcome`);
      assert.ok(observed.moves.every((move) => move.trusted));
    });
    const events = readdirSync(root).filter((name) => name.endsWith('.ndjson')).flatMap((name) => readFileSync(join(root, name), 'utf8').trim().split('\n').map(JSON.parse));
    for (const type of ['browser.request', 'browser.response.body', 'browser.snapshot', 'browser.call.input', 'slider.random', 'browser.close']) assert.ok(events.some((event) => event.type === type), `missing ${type}`);
    for (const event of events.filter((event) => event.type === 'browser.close')) {
      assert.ok(readFileSync(join(event.data.dir, 'network.har')).length > 100);
      assert.ok(readFileSync(join(event.data.dir, 'trace.zip')).length > 100);
    }
    const snapshot = events.find((event) => event.type === 'browser.snapshot' && event.data.stage === 'domcontentloaded');
    const actual = JSON.parse(readFileSync(join(root, snapshot.data.path), 'utf8'));
    assert.ok(actual.frames[0].fingerprint.navigator.userAgent.includes('Chrome/'));
    assert.notEqual(actual.frames[0].fingerprint.navigator.webdriver, true);
    store.event('fixture.assertions.passed', { cases: 5, trustedMouseEvents: true, freshCookieRequired: true });
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
