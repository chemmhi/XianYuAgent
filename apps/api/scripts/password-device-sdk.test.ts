import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OfficialPasswordDeviceFactory} from '../src/password-device-sdk.js';
import type {PasswordLoginInput} from '../src/password-login-port.js';

test('real hidden SDK context captures signed bytes with zero browser auth sends, persists device storage and applies scoped cookie rotation/deletion',async()=>{
  const root=await mkdtemp(join(tmpdir(),'password-device-'));let externalAuth=0,websocketUpgrades=0;
  const server=createServer((req,res)=>{
    res.setHeader('content-type','text/html');
    if(req.url==='/auth'||req.url?.startsWith('/h5/')||req.url?.startsWith('/login_token/')){externalAuth++;return res.end('must never reach');}
    res.end(`<script>
      if(!localStorage.getItem('APLUS_CNA'))localStorage.setItem('APLUS_CNA','fixture_stable-device-123456789');
      window.viewConfig={};window.viewData={umidToken:'fixture-official-umid'};window.UA_Opt={LogVal:'fixtureUA'};window.fixtureUA='fixture-ua-token';
      window.um={getStatus:()=>255};window.__baxia__={getFYModule:{fyObj:{}},etModule:{}};
      const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open=function(method,url){this.fixtureUrl=url;return open.apply(this,arguments)};
      XMLHttpRequest.prototype.send=function(body){this.setRequestHeader('bx-fixture','signed');return send.call(this,body+'&bx-ua='+encodeURIComponent('per-request:'+this.fixtureUrl));};
      fetch('/auth',{method:'POST',body:'unsolicited=1'}).catch(()=>{});
      fetch('/h5/mtop.taobao.idlemessage.pc.login.token/1.0/',{method:'POST',body:'data={}'}).catch(()=>{});
      fetch('/login_token/login.do',{method:'POST',body:'unsolicited=1'}).catch(()=>{});
      new WebSocket('ws://'+location.host+'/business-im');
    </script>`);
  });server.on('upgrade',(_req,socket)=>{websocketUpgrades++;socket.destroy();});server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const input:PasswordLoginInput={account:'fixture',password:'never-enters-sdk',profileKey:'11111111-1111-4111-8111-111111111111',signal:new AbortController().signal,assertActive:async()=>undefined};
  const factory=new OfficialPasswordDeviceFactory({root,fixture:{home:origin+'/',mini:origin+'/mini',login:origin+'/auth'}});
  let device:Awaited<ReturnType<typeof factory.open>>|undefined;
  try{
    device=await factory.open(input);const first=await device.prepare();assert.equal(first.fields.deviceId,'stable-device-123456789');assert.equal(first.fields.ua,'fixture-ua-token');
    const body='loginId=fixture&password2=encrypted%2Bfixture';
    const signed=await device.sign({url:origin+'/auth?appName=xianyu',method:'POST',body,headers:{'content-type':'application/x-www-form-urlencoded'}});
    assert.equal(signed.url,origin+'/auth?appName=xianyu');assert.equal(signed.body,body+'&bx-ua='+encodeURIComponent('per-request:'+signed.url));assert.equal(signed.headers['bx-fixture'],'signed');assert.equal(externalAuth,0);
    assert.equal(signed.headers['x-xianyu-device-capture'],undefined,'internal correlation is added below SDK signing and never reaches Node HTTP');
    await device.absorbResponse('https://passport.goofish.com/mini_login.htm',['device_cookie=first; Path=/; Secure','same=keep; Domain=.goofish.com; Path=/; Secure; Max-Age=3600']);
    await device.absorbResponse('https://passport.goofish.com/mini_login.htm',['device_cookie=rotated; Domain=passport.goofish.com; Path=/; Secure']);
    assert.equal((await device.snapshot()).filter(c=>c.name==='device_cookie').length,1);
    await device.absorbResponse('https://passport.goofish.com/mini_login.htm',['device_cookie=; Domain=passport.goofish.com; Path=/; Max-Age=0; Secure']);
    assert.equal((await device.snapshot()).some(c=>c.name==='device_cookie'),false);assert.ok((await device.snapshot()).some(c=>c.name==='same'));
    await assert.rejects(device.absorbResponse('https://passport.goofish.com/', ['bad=1; Domain=other.test; Path=/']),/COOKIE_DOMAIN/);
    await device.absorbResponse('https://passport.goofish.com/',['cna=sdk-latest-device; Domain=.goofish.com; Path=/; Secure; Max-Age=3600']);
    await device.close();device=await factory.open({...input,initialCookieSnapshot:[{name:'cna',value:'old-success-snapshot',domain:'.goofish.com',path:'/',secure:true}]});assert.equal((await device.prepare()).fields.deviceId,first.fields.deviceId);assert.ok((await device.snapshot()).some(c=>c.name==='same'));assert.equal((await device.snapshot()).find(c=>c.name==='cna')?.value,'sdk-latest-device','failed or cancelled attempts cannot roll SDK state back to old successful snapshots');assert.equal(externalAuth,0);assert.equal(websocketUpgrades,0);
  }finally{await device?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
for(const scenario of ['unsigned','late'] as const)test(`hidden device refuses ${scenario} requests and never sends authentication through the browser`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'password-device-fence-'));let submissions=0;
  const server=createServer((req,res)=>{if(req.url==='/auth'){submissions++;return res.end('{}');}res.setHeader('content-type','text/html');res.end(`<script>
    localStorage.setItem('APLUS_CNA','fixture_stable-fixture-device');window.viewConfig={};window.viewData={umidToken:'fixture'};window.UA_Opt={LogVal:'fixtureUA'};window.fixtureUA='fixture';window.um={getStatus:()=>255};window.__baxia__={getFYModule:{fyObj:{}},etModule:{}};
    ${scenario==='late'?"const send=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(body){setTimeout(()=>send.call(this,body+'&bx-ua=delayed'),2000);};":''}
  </script>`);});server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const device=await new OfficialPasswordDeviceFactory({root,timeoutMs:1000,fixture:{home:origin+'/',mini:origin+'/mini',login:origin+'/auth'}}).open({account:'fixture',password:'never-enters-browser',profileKey:'11111111-1111-4111-8111-111111111111',signal:new AbortController().signal,assertActive:async()=>undefined});
  try{await assert.rejects(device.sign({url:origin+'/auth',method:'POST',body:'password2=ciphertext',headers:{'content-type':'application/x-www-form-urlencoded'}}),new RegExp(scenario==='late'?'PASSWORD_DEVICE_SIGNATURE_TIMEOUT':'PASSWORD_DEVICE_SIGNATURE_MISSING'));
    if(scenario==='late')await assert.rejects(device.sign({url:origin+'/auth',method:'POST',body:'next=1',headers:{}}),/PASSWORD_DEVICE_CLOSED/);
    assert.equal(submissions,0);
  }finally{await device.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
