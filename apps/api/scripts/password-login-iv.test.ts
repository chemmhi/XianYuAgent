import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {XianyuPasswordHttp} from '../src/xianyu-password-http.js';
import type {PasswordLoginInput} from '../src/password-login-port.js';

for(const scenario of ['success','safe-login-ticket','init-json-captcha','init-redirect-captcha','init-forbidden-captcha','poll-forbidden-captcha','poll-captcha','identity-captcha','unsafe-ticket','cancel','expiry'] as const)test(`official IV HTTP session: ${scenario}`,async()=>{
  const pair=generateKeyPairSync('rsa',{modulusLength:1024}),key=pair.publicKey.export({format:'jwk'}),controller=new AbortController();
  let passwordPosts=0,polls=0,exchanges=0,ivStarts=0,captchas=0;const stages:string[]=[],requests:string[]=[];
  const challengeUrl='https://passport.goofish.com/newlogin/login.do/_____tmd_____/punish?x5secdata=fixture';
  const challenge=(status=200)=>response(JSON.stringify({ret:['FAIL_SYS_USER_VALIDATE::RGV587_ERROR'],data:{url:challengeUrl}}),{'content-type':'application/json'},status);
  const response=(body:string,headers:Record<string,string>={},status=200)=>new Response(body,{status,headers});
  const adapter=new XianyuPasswordHttp({ivPollIntervalMs:1,request:async(input,init)=>{
    const url=new URL(String(input)),cookie=new Headers(init?.headers).get('cookie')??'';requests.push(url.pathname);
    if(url.pathname==='/')return response('home');
    if(url.pathname==='/mini_login.htm')return response(`<script>window.viewConfig=${JSON.stringify({rsaModulus:Buffer.from(key.n!,'base64url').toString('hex'),rsaExponent:Buffer.from(key.e!,'base64url').toString('hex'),api:{loginApi:'/newlogin/login.do?appName=xianyu&fromSite=77'}})};window.viewData=${JSON.stringify({loginFormData:{_csrf_token:'fixture-csrf',umidToken:'fixture-umid'}})};</script><script src="https://x.alicdn.com/vip/havana-nlogin/0.10.38/index.js"></script>`,{'set-cookie':'cookie2=guest; Domain=.goofish.com; Path=/; Secure'});
    if(url.pathname==='/newlogin/login.do'){passwordPosts++;return response(JSON.stringify({content:{success:true,data:{resultCode:100,iframeRedirect:true,iframeRedirectUrl:'https://passport.goofish.com/iv/remote/pc/mini_login_check.htm?havana_iv_token=fixture'}}}));}
    if(url.pathname==='/iv/remote/pc/mini_login_check.htm'){ivStarts++;return response('',{'location':scenario==='expiry'?'/iv/static/mini_expired.htm':'/iv/mini/normal_validate.htm?htoken=fixture','set-cookie':'JSESSIONID=iv-session; Path=/; Secure; HttpOnly'},302);}
    if(url.pathname==='/iv/static/mini_expired.htm')return response('expired');
    if(url.pathname==='/iv/mini/normal_validate.htm'){assert.match(cookie,/JSESSIONID=iv-session/);if(scenario.startsWith('init-')&&!cookie.includes('x5sec=official-fixture-proof'))return scenario==='init-forbidden-captcha'?response(`<script>location.href='${challengeUrl}'</script>`,{'content-type':'text/html'},403):scenario==='init-json-captcha'?challenge():response('',{location:challengeUrl},302);return response(`<script>location.href="https://passport.goofish.com/iv/mini/verify_modes.htm?htoken=fixture&_umidfg="+window._iv_umidfg;</script>`);}
    if(url.pathname==='/iv/mini/verify_modes.htm'){assert.equal(url.searchParams.get('_umidfg'),'-1');return response('',{location:'/iv/mini/identity_verify.htm?htoken=fixture'},302);}
    if(url.pathname==='/iv/mini/identity_verify.htm')return response(`<script>new Qrcode({text:"https://market.m.taobao.com/app/msd/m-rpverify-internal/start.html?token=fixture-face&tokenSource=getVerifyToken",width:166,height:166});var checkInterval=2000,timeout=480000;jQuery.ajax({url:'https://passport.goofish.com/iv/photoVerify/check.do?htoken=fixture'});</script>`);
    if(url.pathname==='/iv/photoVerify/check.do'){assert.match(cookie,/JSESSIONID=iv-session/);if((scenario==='poll-captcha'||scenario==='poll-forbidden-captcha')&&!cookie.includes('x5sec=official-fixture-proof'))return challenge(scenario==='poll-forbidden-captcha'?403:200);polls++;return response(JSON.stringify({content:{code:String(Math.min(3,polls)),...(polls>=3?{url:scenario==='unsafe-ticket'?'https://evil.test/steal':scenario==='safe-login-ticket'?'https://passport.goofish.com/newlogin/safe/ivCheckLogin.htm?ticket=fixture':'https://passport.goofish.com/iv/remote/pc/ivCheckLogin.htm?ticket=fixture'}:{})}}));}
    if(url.pathname.endsWith('/ivCheckLogin.htm')){exchanges++;assert.match(cookie,/JSESSIONID=iv-session/);return response('<script>sendMessage({action:"loginResult"})</script>',{'set-cookie':'unb=fixture-seller; Domain=.goofish.com; Path=/; Secure'});}
    if(url.pathname.includes('pc.loginuser.get')){if(scenario==='identity-captcha'&&captchas===0)return challenge();return response(JSON.stringify({ret:['SUCCESS::OK'],data:{userId:'fixture-seller'}}),{'set-cookie':'_m_h5_tk=token_9999999999999; Domain=.goofish.com; Path=/; Secure'});}
    if(url.pathname.includes('pc.login.token'))return response(JSON.stringify({ret:['SUCCESS::OK'],data:{accessToken:'fixture-im-token'}}));
    throw new Error('PASSWORD_UNEXPECTED_FIXTURE_URL');
  }});
  const input:PasswordLoginInput={account:'fixture',password:'fixture-password',profileKey:'11111111-1111-4111-8111-111111111111',signal:controller.signal,assertActive:async()=>{controller.signal.throwIfAborted();},onHttpVerification:async url=>{assert.ok(scenario.endsWith('-captcha'));assert.equal(url,challengeUrl);captchas++;return {host:'passport.goofish.com',value:'official-fixture-proof',expiresAt:Date.now()+60000};},onIvStatus:async status=>{assert.match(status.imageDataUrl,/^data:image\/png;base64,/);stages.push(status.status);if(scenario==='cancel')controller.abort();}};
  if(scenario==='success'||scenario==='safe-login-ticket'||scenario.endsWith('-captcha')){const result=await adapter.run(input);assert.equal(result.unb,'fixture-seller');assert.equal(result.accessToken,'fixture-im-token');assert.deepEqual(stages,['waiting','verifying','auditing']);assert.equal(exchanges,1);assert.equal(captchas,scenario.endsWith('-captcha')?1:0);}
  else await assert.rejects(adapter.run(input),new RegExp(scenario==='unsafe-ticket'?'PASSWORD_IV_URL_UNSUPPORTED':scenario==='expiry'?'PASSWORD_IV_EXPIRED':'PASSWORD_LOGIN_CANCELLED'));
  assert.equal(passwordPosts,1,'the entire face-verification lifecycle never starts a second password login');
  assert.equal(ivStarts,1,'retries must preserve the original one-use IV session');
  assert.equal(requests.some(path=>path.includes('evil.test')),false);
});
