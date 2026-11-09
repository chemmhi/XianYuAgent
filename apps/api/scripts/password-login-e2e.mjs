import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer as createVite } from 'vite';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { hashPassword } from '../src/security.ts';
import { XianyuPasswordHttp } from '../src/xianyu-password-http.ts';
import { OfficialPasswordDeviceFactory } from '../src/password-device-sdk.ts';
import { passwordTestDatabase } from './password-login-test-database.mjs';

// Real product DOM -> HTTP API -> persistent PG -> DOM, with a local official-platform contract fixture.
// The fixture is explicitly not evidence of successful real Goofish login or IM registration.
const root = await mkdtemp(join(tmpdir(), 'password-login-e2e-'));
const evidence = resolve(process.env.PASSWORD_LOGIN_EVIDENCE_DIR ?? join(tmpdir(), 'xianyu-password-login-evidence'));
const db = await passwordTestDatabase();
let submissions = 0, cookieChecks = 0, socket, chrome, vite, runtime;
const verificationMode=process.env.PASSWORD_LOGIN_E2E_VERIFICATION==='true';let faceApproved=false;
const pair=generateKeyPairSync('rsa',{modulusLength:1024}),publicKey=pair.publicKey.export({format:'jwk'});
const platform = createServer(async (req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if(req.url?.startsWith('/mini_login.htm')){
    res.setHeader('set-cookie','csrf_fixture=valid; Domain=.goofish.com; Path=/; Secure');
    return res.end(`<script>window.viewConfig=${JSON.stringify({rsaModulus:Buffer.from(publicKey.n,'base64url').toString('hex'),rsaExponent:Buffer.from(publicKey.e,'base64url').toString('hex'),api:{loginApi:'/newlogin/login.do?appName=xianyu&fromSite=77'}})};window.viewData=${JSON.stringify({loginFormData:{appName:'xianyu',fromSite:77,_csrf_token:'fresh-csrf-'+submissions,umidToken:'fixture-server-umid'}})};</script><script data-version="havana-nlogin/0.10.38/index.js">localStorage.setItem('APLUS_CNA',localStorage.getItem('APLUS_CNA')||'fixture_stable-device-id');window.UA_Opt={LogVal:'fixtureUA'};window.fixtureUA='fixture-ua';window.um={getStatus:()=>255};window.__baxia__={getFYModule:{fyObj:{}},etModule:{}};const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url){if(method==='GET')url+=(url.includes('?')?'&':'?')+'bx-ua=fixture-current-sdk';return open.call(this,method,url);};const send=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(body){return send.call(this,body+'&bx-ua=fixture-current-sdk&bx-umidtoken=fixture-umid&bx_et=fixture-et&x-pipu2=fixture-ub');};</script>`);
  }
  if(req.url?.startsWith('/iv/remote/pc/mini_login_check.htm')){res.statusCode=302;res.setHeader('location','/iv/mini/normal_validate.htm?htoken=fixture');res.setHeader('set-cookie','JSESSIONID=iv-fixture; Path=/; Secure; HttpOnly');return res.end();}
  if(req.url?.startsWith('/iv/mini/normal_validate.htm'))return res.end('<script>location.href="https://passport.goofish.com/iv/mini/verify_modes.htm?htoken=fixture&_umidfg="+window._iv_umidfg;</script>');
  if(req.url?.startsWith('/iv/mini/verify_modes.htm')){res.statusCode=302;res.setHeader('location','/iv/mini/identity_verify.htm?htoken=fixture');return res.end();}
  if(req.url?.startsWith('/iv/mini/identity_verify.htm'))return res.end(`<script>new Qrcode({text:"https://market.m.taobao.com/app/msd/m-rpverify-internal/start.html?token=fixture-face&tokenSource=getVerifyToken"});var checkInterval=2000,timeout=480000;jQuery.ajax({url:'https://passport.goofish.com/iv/photoVerify/check.do?htoken=fixture'});</script>`);
  if(req.url?.startsWith('/iv/photoVerify/check.do')){assert.match(req.headers.cookie??'',/JSESSIONID=iv-fixture/);res.setHeader('content-type','application/json');return res.end(JSON.stringify({content:{code:faceApproved?'3':'0',...(faceApproved?{url:'https://passport.goofish.com/newlogin/safe/ivCheckLogin.htm?ticket=fixture'}:{})}}));}
  if(req.url?.startsWith('/newlogin/safe/ivCheckLogin.htm')){res.setHeader('set-cookie',['unb=880000009901; Domain=.goofish.com; Path=/; HttpOnly; Secure','cookie2=valid; Domain=.goofish.com; Path=/; HttpOnly; Secure']);return res.end('<script>sendMessage({action:"loginResult"})</script>');}
  if (req.url?.startsWith('/newlogin/login.do')) {
    submissions++;let submitted='';for await (const chunk of req)submitted+=chunk;
    const deviceFields=new URLSearchParams(submitted);assert.equal(deviceFields.get('ua'),'fixture-ua');assert.equal(deviceFields.get('deviceId'),'stable-device-id');assert.equal(deviceFields.get('bx-ua'),'fixture-current-sdk');assert.equal(deviceFields.get('umidGetStatusVal'),'255');
    if(verificationMode&&!faceApproved){res.setHeader('content-type','application/json');return res.end(JSON.stringify({content:{success:true,data:{resultCode:100,iframeRedirect:true,iframeRedirectUrl:'https://passport.goofish.com/iv/remote/pc/mini_login_check.htm?havana_iv_token=fixture'}}}));}
    res.setHeader('set-cookie',['unb=880000009901; Domain=.goofish.com; Path=/; HttpOnly; Secure','cookie2=valid; Domain=.goofish.com; Path=/; HttpOnly; Secure']); res.setHeader('content-type','application/json');
    return res.end(JSON.stringify({ content: { success: true, data: { resultCode: 100 } }, hasError: false }));
  }
  if(req.url?.startsWith('/h5/')){cookieChecks++;res.setHeader('content-type','application/json');if(!req.headers.cookie?.includes('_m_h5_tk=')){res.setHeader('set-cookie','_m_h5_tk=fixture_9999999999999; Domain=.goofish.com; Path=/; Secure');return res.end(JSON.stringify({ret:['FAIL_SYS_TOKEN_EXPIRED::refresh']}));}return res.end(JSON.stringify({ret:['SUCCESS::OK'],data:req.url.includes('pc.login.token')?{accessToken:'fixture-im-access-token'}:{userId:'880000009901'}}));}
  res.end('{}');
});
platform.listen(0, '127.0.0.1'); await once(platform, 'listening');
const platformOrigin = `http://127.0.0.1:${platform.address().port}`;
async function wait(check, label, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(r => setTimeout(r, 80)); }
  throw new Error(`Timed out: ${label}`);
}
try {
  const config = loadConfig({ HOST: '127.0.0.1', PORT: '0', DATABASE_URL: db.url, ALLOW_IN_MEMORY: 'false', REDIS_URL: '',
    XIANYU_QR_MODE: 'stub', XIANYU_VERIFICATION_BROWSER_MODE: 'disabled', XIANYU_VERIFICATION_BROWSER_HEADLESS: 'true',
    CREDENTIAL_ENCRYPTION_KEY: 'password-e2e-encryption-key-only', COOKIE_SECURE: 'false', MODEL_PROVIDER_FAILOVER_V2: 'false' });
  const browser = new XianyuPasswordHttp({ivPollIntervalMs:50,deviceFactory:new OfficialPasswordDeviceFactory({root:join(root,'sdk-profile'),fixture:{home:platformOrigin+'/',mini:platformOrigin+'/mini_login.htm',login:'https://passport.goofish.com/newlogin/login.do'}}),request:async(url,init)=>{const target=new URL(String(url));return fetch(platformOrigin+target.pathname+target.search,init);}});
  runtime = createApp(config, { passwordTransport: browser });
  runtime.xianyuIm.startListener = async () => undefined;
  runtime.xianyu.fetchProfile = async () => ({ success: true, accountInvalid: false, response: { userId:'880000009901',nickname:'密码登录端到端账号' } });
  const admin = await runtime.store.createAdmin({ email: `${randomUUID()}@example.test`, passwordHash: await hashPassword('fixture-admin-password'), displayName:'密码登录验收' });
  const auth = await runtime.auth.login({ email: admin.email, password:'fixture-admin-password' });
  const account = await runtime.store.createAccount({ adminId:admin.id, platform:'xianyu', sellerRef:'880000009901', displayName:'密码登录端到端账号' });
  const old = await runtime.store.upsertCredential({ adminId:admin.id,accountId:account.id,platform:'xianyu',cookieHeader:'unb=880000009901; cookie2=expired' });
  await runtime.store.markCredentialVerified({ adminId:admin.id,accountId:account.id,status:'expired',expected:old });
  await runtime.listen();
  const apiOrigin = `http://127.0.0.1:${runtime.server.address().port}`;
  process.env.VITE_API_MODE='live'; process.env.VITE_API_PROXY_TARGET=apiOrigin;
  vite = await createVite({ root:resolve(import.meta.dirname,'../../web'), server:{ host:'127.0.0.1',port:0 } }); await vite.listen();
  const web = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const tcp = tcpServer(); await new Promise(r=>tcp.listen(0,'127.0.0.1',r)); const port=tcp.address().port; await new Promise(r=>tcp.close(r));
  chrome=spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${join(root,'frontend-profile')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  const target=await wait(async()=>{try{return(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');}catch{return false;}},'Chrome');
  socket=new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0; const pending=new Map(); socket.onmessage=e=>{const message=JSON.parse(e.data);if(!message.id)return;const call=pending.get(message.id);pending.delete(message.id);message.error?call.reject(new Error(message.error.message)):call.resolve(message.result);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??'browser error');return r.result?.value;};
  const clickFormButton = async (label) => {
    const point=await evaluate(`(() => {const b=Array.from(document.querySelectorAll('.account-login-form button')).find(b=>b.textContent===${JSON.stringify(label)});b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
  };
  const checkLoginLayout = async (prefix, saved = false) => {
    for (const [width, height] of [[1440,900],[1440,572],[920,572],[858,572],[390,844],[390,572]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      const layout = await evaluate(`(() => {
        const body=document.querySelector('.account-login-body'),modal=document.querySelector('.account-login-modal');
        const bounds=modal.getBoundingClientRect(),overflow=getComputedStyle(body).overflowY;
        body.scrollTop=body.scrollHeight;
        const buttons=[document.querySelector('.account-login-form button[type="submit"]'),...Array.from(document.querySelectorAll('.account-login-form button')).filter(b=>b.textContent==='使用已保存账密登录')];
        return {inside:bounds.top>=0&&bounds.bottom<=innerHeight,scrollable:body.scrollHeight<=body.clientHeight+1||['auto','scroll'].includes(overflow),buttons:buttons.map(b=>{const r=b.getBoundingClientRect(),p=body.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom&&r.left>=0&&r.right<=innerWidth&&[r.top+1,r.bottom-1].every(y=>b.contains(document.elementFromPoint(r.x+r.width/2,y)));})};
      })()`);
      assert.equal(layout.inside,true,`${prefix} modal fits ${width}x${height}`);
      assert.equal(layout.scrollable,true,`${prefix} overflowing form can be scrolled ${width}x${height}`);
      assert.equal(layout.buttons.length,saved?2:1);
      assert.ok(layout.buttons.every(Boolean),`${prefix} entire buttons are reachable ${width}x${height}: ${JSON.stringify(layout)}`);
      await writeFile(join(evidence,`${prefix}-${width}x${height}.png`),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    }
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  };
  await send('Network.enable');
  for(const [name,value] of [['session_id',auth.session.id],['csrf_token',auth.csrfToken]])await send('Network.setCookie',{name,value,url:web});
  await send('Page.navigate',{url:web+'/accounts'});
  await wait(()=>evaluate(`document.body.innerText.includes('密码登录端到端账号')`),'account visible');
  await evaluate(`[...document.querySelectorAll('button')].find(el=>el.textContent==='添加闲鱼账号').click()`);
  await wait(()=>evaluate(`!!document.querySelector('[data-login-method="password"]')`),'login modal');
  await evaluate(`document.querySelector('[data-login-method="password"]').click()`);
  await wait(()=>evaluate(`!!document.querySelector('.account-login-form input[type="password"]')`),'password form');
  await evaluate(`(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;const inputs=document.querySelectorAll('.account-login-form input');for(const [el,v]of [[inputs[0],'fixture-phone'],[inputs[1],'fixture-password']]){set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('.account-login-form input[type="checkbox"]').click();})()`);
  await mkdir(evidence,{recursive:true});
  await checkLoginLayout('password-form');
  for(const [width,height,name]of [[1440,900,'password-desktop.png'],[390,844,'password-mobile.png']]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    // The field masks a synthetic fixture password; real credentials are never used by this harness.
    await writeFile(join(evidence,name),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await clickFormButton('登录并添加账号');
  if(verificationMode){
    await wait(()=>evaluate(`!!document.querySelector('.password-verification-dialog img[alt="闲鱼官方人脸验证二维码"]')`),'independent verification dialog');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.account-modal-backdrop')).display`),'none','password dialog is hidden while its controller remains alive');
    assert.equal((await runtime.store.getCredential(admin.id,account.id)).status,'expired');
    for(const [width,height,name]of [[1440,900,'verification-desktop.png'],[390,844,'verification-mobile.png'],[808,649,'verification-short.png']]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await wait(()=>evaluate(`(()=>{const f=document.querySelector('.password-verification-dialog img[alt="闲鱼官方人脸验证二维码"]'),r=f.getBoundingClientRect();return r.height>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;})()`),'entire official QR inside viewport');
      await writeFile(join(evidence,name),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    }
    faceApproved=true;
  }
  await wait(async()=>{const row=(await db.pool.query('select status,failure_code from auth.account_login_sessions where admin_id=$1 and login_method=\'password\' order by started_at desc limit 1',[admin.id])).rows[0];if(['failed','expired','cancelled'].includes(row?.status))throw new Error('Password fixture session failed: '+row.failure_code);return row?.status==='succeeded';},'persisted password session');
  await wait(()=>evaluate(`!document.querySelector('.account-modal-backdrop') && !document.querySelector('.password-verification-dialog') && document.body.innerText.includes('密码登录端到端账号')`),'visible login result after the controller acknowledges success');
  const stored=(await runtime.passwordLogin.vault.repository.get(admin.id,account.id));assert.ok(stored?.enabled);assert.equal(stored.ciphertext.includes('fixture-password'),false);
  assert.equal((await runtime.store.listAccounts(admin.id)).total,1,'adding an already known official identity restores its account without duplication');
  const bound=(await db.pool.query("select account_id from auth.account_login_sessions where admin_id=$1 and login_method='password' order by started_at desc limit 1",[admin.id])).rows[0];assert.equal(bound.account_id,account.id);
  assert.equal(runtime.passwordLogin.vault.open(stored).password,'fixture-password');
  assert.equal((await runtime.store.getCredential(admin.id,account.id)).status,'active');assert.equal(submissions,1,'IV confirmation does not submit the password again');
  const publicDetail=await fetch(apiOrigin+`/api/v1/accounts/${account.id}`,{headers:{cookie:`session_id=${auth.session.id}; csrf_token=${auth.csrfToken}`}});assert.equal((await publicDetail.text()).includes('fixture-password'),false);
  if(verificationMode){
    faceApproved=false;
    const previous=await runtime.store.getCredential(admin.id,account.id);await runtime.store.markCredentialVerified({adminId:admin.id,accountId:account.id,status:'expired',expected:previous});
    await runtime.passwordLogin.vault.repository.settle(stored,Date.now(),'PASSWORD_IV_EXPIRED',true);
    await evaluate(`[...document.querySelectorAll('button')].find(el=>el.textContent==='授权').click()`);
    await wait(()=>evaluate(`!!document.querySelector('[data-login-method="password"]')`),'existing-account password tab');
    await evaluate(`document.querySelector('[data-login-method="password"]').click()`);
    const savedStatus=await fetch(apiOrigin+`/api/v1/accounts/${account.id}/password-login/saved`,{headers:{cookie:`session_id=${auth.session.id}; csrf_token=${auth.csrfToken}`}});assert.equal(savedStatus.status,200);assert.equal((await savedStatus.json()).data.available,true);
    await wait(()=>evaluate(`Array.from(document.querySelectorAll('button')).some(el=>el.textContent==='使用已保存账密登录')`),'saved-password retry is offered').catch(async error=>{throw new Error(error.message+'; fixture dialog: '+await evaluate(`document.querySelector('[role="dialog"]')?.innerText`));});
    await checkLoginLayout('password-saved',true);
    await clickFormButton('使用已保存账密登录');
    await wait(()=>evaluate(`document.querySelector('.password-verification-dialog')?.innerText.includes('闲鱼自动登录安全验证')`),'background recovery verification appears without password entry');
    await wait(()=>evaluate(`!!document.querySelector('.password-verification-dialog img[alt="闲鱼官方人脸验证二维码"]')`),'background official QR ready');
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('input[type="password"]')).some(el=>el.getBoundingClientRect().height>0)`),false);
    assert.equal((await runtime.passwordLogin.vault.repository.get(admin.id,account.id)).enabled,true);
    await writeFile(join(evidence,'verification-automatic.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate(`Array.from(document.querySelectorAll('nav button')).find(e=>e.textContent.includes('仪表盘')).click()`);
    await wait(()=>evaluate(`!document.querySelector('.accounts-domain')`),'leaving account page');
    assert.equal((await runtime.passwordLogin.pending(admin.id))?.automatic,true,'navigation does not cancel background verification');
    await evaluate(`Array.from(document.querySelectorAll('nav button')).find(e=>e.textContent.includes('账号管理')).click()`);
    await wait(()=>evaluate(`document.querySelector('.password-verification-dialog')?.innerText.includes('闲鱼自动登录安全验证')`),'background verification survives page navigation',40000);
    faceApproved=true;
    await wait(async()=>await runtime.passwordLogin.pending(admin.id)===null,'background verification completes');
    await wait(()=>evaluate(`!document.querySelector('.password-verification-dialog')`),'background verification closes after success');
    assert.equal((await runtime.store.getCredential(admin.id,account.id)).status,'active');assert.equal(submissions,2,'automatic face confirmation preserves the same password attempt');
  }
  // Rebuild service objects against the same database to prove encrypted recovery survives process-local state loss.
  await runtime.close(); runtime=createApp(config,{passwordTransport:browser});runtime.xianyuIm.startListener=async()=>undefined;runtime.xianyu.fetchProfile=async()=>({success:true,accountInvalid:false,response:{userId:'880000009901',nickname:'密码登录端到端账号'}});
  const current=await runtime.store.getCredential(admin.id,account.id);await runtime.store.markCredentialVerified({adminId:admin.id,accountId:account.id,status:'expired',expected:current});
  const restored=await runtime.passwordLogin.vault.repository.get(admin.id,account.id);await runtime.passwordLogin.recover(restored);
  assert.equal((await runtime.store.getCredential(admin.id,account.id)).status,'active');assert.ok(cookieChecks>=2);
  assert.equal(submissions,verificationMode?3:2,'restart recovery performs another password login via HTTP');
  await writeFile(join(evidence,'result.json'),JSON.stringify({browser:'Chrome/CDP',database:'isolated PostgreSQL',externalPlatform:'local login contract fixture',reactForm:true,independentVerificationDialog:verificationMode,expiredAccountRestored:true,encryptedPasswordSaved:true,restartRecovery:true,realGoofishAcceptance:false,realImRegistration:false},null,2));
  console.log('Password login product DOM -> API -> PostgreSQL -> DOM and restart recovery PASS; external platform is a local contract fixture');
} finally {
  socket?.close();chrome?.kill();await vite?.close();await runtime?.close();await new Promise(r=>platform.close(r));await db.close();
  await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
