import assert from 'node:assert/strict';
import test from 'node:test';
import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { encryptXianyuPassword, loginJsonAssignment } from '../src/xianyu-password-protocol.js';
import { XianyuPasswordHttp, PasswordHttpVerificationRequired } from '../src/xianyu-password-http.js';
import type { PasswordLoginInput } from '../src/password-login-port.js';

const keys=generateKeyPairSync('rsa',{modulusLength:1024}),jwk=keys.publicKey.export({format:'jwk'});
const modulus=Buffer.from(jwk.n!,'base64url').toString('hex'),exponent=Buffer.from(jwk.e!,'base64url').toString('hex');
function decrypt(hex: string) {
  const encrypted=Buffer.from(hex.padStart(256,'0'),'hex'), padded=privateDecrypt({key:keys.privateKey,padding:constants.RSA_NO_PADDING},encrypted);
  assert.equal(padded[0],0);assert.equal(padded[1],2);const separator=padded.indexOf(0,2);assert.ok(separator>=10);return padded.subarray(separator+1);
}
test('official RSA contract uses random PKCS#1 v1.5 padding, even hex and UTF-16 unit encoding',()=>{
  const first=encryptXianyuPassword('A🔐中',modulus,exponent),second=encryptXianyuPassword('A🔐中',modulus,exponent);
  assert.notEqual(first,second);assert.equal(first.length%2,0);assert.equal(decrypt(first).toString('hex'),'41eda0bdedb490e4b8ad');
  assert.throws(()=>encryptXianyuPassword('a'.repeat(118),modulus,exponent),/LENGTH_UNSUPPORTED/);
  assert.throws(()=>encryptXianyuPassword('abc','bad','10001'),/RSA_INVALID/);
  assert.deepEqual(loginJsonAssignment('window.x={"nested":{"text":"}\\\"{"}};alert(1)','window.x'),{nested:{text:'}"{'}});
  assert.throws(()=>loginJsonAssignment('window.x={malicious()}','window.x'),/BOOTSTRAP_INVALID/);
});
for(const scenario of ['success','wrong-password','challenge-with-100','captcha-with-100','html-challenge','mixed-ret','success-with-challenge','http-error-success','identity-mismatch','exchange-redirect','untrusted-redirect','scoped-token','manual-verification'] as const)test(`real HTTP login contract: ${scenario}`,async()=>{
  let initialization=0,submissions=0,identityCalls=0;const seen: Array<{url:string;body:string}>=[];
  const server=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/'){res.setHeader('set-cookie','cna=fixtureCnaWithoutUnderscore; Domain=.goofish.com; Path=/; Secure');return res.end('{}');}
    if(req.url?.startsWith('/mini_login.htm')){
      initialization++;res.setHeader('set-cookie','csrf_fixture=valid; Domain=.goofish.com; Path=/; HttpOnly; Secure');res.setHeader('content-type','text/html');
      return res.end(`<script>window.viewConfig=${JSON.stringify({rsaModulus:modulus,rsaExponent:exponent,api:{loginApi:'/newlogin/login.do?appName=xianyu&fromSite=77'}})};window.viewData=${JSON.stringify({loginFormData:{appName:'xianyu',fromSite:77,_csrf_token:'fresh-csrf',umidToken:'server-issued-umid'}})};</script><script src="https://x.alicdn.com/vip/havana-nlogin/0.10.38/index.js"></script>`);
    }
    if(req.url?.startsWith('/newlogin/login.do')){
      submissions++;let text='';for await(const chunk of req)text+=chunk;const form=new URLSearchParams(text);
      assert.match(req.headers.cookie??'',/csrf_fixture=valid/);assert.equal(form.get('_csrf_token'),'fresh-csrf');assert.equal(form.get('umidToken'),'server-issued-umid');assert.equal(form.get('umidTag'),'SERVER');
      assert.equal(form.get('loginId'),'fixture-user');assert.equal(form.get('defaultView'),'password');assert.equal(decrypt(form.get('password2')!).toString(),'fixture-password');assert.equal(text.includes('fixture-password'),false);
      assert.equal(form.get('deviceId'),'fixtureCnaWithoutUnderscore');
      if(scenario==='manual-verification'){
        if(submissions===1)return res.end(JSON.stringify({ret:['FAIL_SYS_USER_VALIDATE','RGV587_ERROR'],data:{url:'https://passport.goofish.com//newlogin/login.do/_____tmd_____/punish?x5secdata=fixture'}}));
        assert.match(req.headers.cookie??'',/x5sec=fixture-proof/);assert.equal(form.get('_csrf_token'),'fresh-csrf');
      }
      const data: Record<string,unknown>={resultCode:scenario==='wrong-password'?5:100};
      if(scenario==='html-challenge'){res.statusCode=403;res.setHeader('content-type','text/html');return res.end('<a href="https://www.goofish.com/punish">RGV587 x5sec</a>');}
      if(scenario==='challenge-with-100')Object.assign(data,{iframeRedirect:true,iframeRedirectUrl:'https://www.goofish.com/punish'});
      if(scenario==='captcha-with-100')data.isCheckCodeShowed=true;
      if(scenario==='exchange-redirect')data.asyncUrls=['https://www.goofish.com/exchange'];
      if(scenario==='untrusted-redirect')data.asyncUrls=['https://evil.test/steal'];
      res.setHeader('set-cookie',['unb=fixture-seller; Domain=.goofish.com; Path=/; Secure; HttpOnly','cookie2=valid-session; Domain=.goofish.com; Path=/; Secure; HttpOnly']);
      return res.end(JSON.stringify({content:{success:scenario!=='wrong-password',data},hasError:false}));
    }
    if(req.url?.startsWith('/h5/')){
      if(req.url.includes('pc.login.token'))return res.end(JSON.stringify({ret:['SUCCESS::OK'],data:{accessToken:'fixture-im-access-token'}}));
      identityCalls++;
      if(!req.headers.cookie?.includes('_m_h5_tk=')){res.setHeader('set-cookie',`_m_h5_tk=fixturetoken_9999999999999; ${scenario==='scoped-token'?'Path=/h5/':'Domain=.goofish.com; Path=/'}; Secure`);return res.end(JSON.stringify({ret:['FAIL_SYS_TOKEN_EXPIRED::refresh']}));}
      if(scenario==='http-error-success')res.statusCode=403;
      const ret=scenario==='mixed-ret'?['SUCCESS::OK','FAIL_SYS_USER_VALIDATE::security']:['SUCCESS::OK'];
      assert.match(req.headers.cookie,/cookie2=valid-session/);return res.end(JSON.stringify({ret,data:{userId:scenario==='identity-mismatch'?'someone-else':'fixture-seller',...(scenario==='success-with-challenge'?{verificationUrl:'https://www.goofish.com/punish'}:{})}}));
    }
    if(req.url==='/exchange'){res.statusCode=302;res.setHeader('location','https://www.goofish.com/exchanged');return res.end();}
    res.end('{}');
  });server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const input: PasswordLoginInput={account:'fixture-user',password:'fixture-password',profileKey:'11111111-1111-4111-8111-111111111111',expectedUserId:'fixture-seller',signal:new AbortController().signal,assertActive:async()=>undefined,};
  if(scenario==='manual-verification')input.onHttpVerification=async url=>{assert.equal(submissions,1);assert.equal(initialization,1);assert.equal(new URL(url).host,'passport.goofish.com');return {value:'fixture-proof',host:'passport.goofish.com',expiresAt:Date.now()+60_000};};
  const adapter=new XianyuPasswordHttp({request:async(url,init)=>{const target=new URL(String(url));seen.push({url:target.origin+target.pathname,body:String(init?.body??'')});return fetch(origin+target.pathname+target.search,init);}});
  try {
    if(scenario==='wrong-password')await assert.rejects(adapter.run(input),/PASSWORD_REJECTED/);
    else if(['challenge-with-100','captcha-with-100','html-challenge','mixed-ret','success-with-challenge'].includes(scenario))await assert.rejects(adapter.run(input),PasswordHttpVerificationRequired);
    else if(scenario==='http-error-success')await assert.rejects(adapter.run(input),/HTTP_RESPONSE_UNSUPPORTED/);
    else if(scenario==='identity-mismatch')await assert.rejects(adapter.run(input),/PASSWORD_ACCOUNT_MISMATCH/);
    else if(scenario==='untrusted-redirect'){await assert.rejects(adapter.run(input),/EXCHANGE_UNSUPPORTED/);assert.equal(seen.some(r=>r.url.includes('evil.test')),false);}
    else{const result=await adapter.run(input);assert.equal(result.unb,'fixture-seller');assert.equal(result.usedPassword,true);assert.ok(result.cookieSnapshot.some(c=>c.name==='cookie2'&&c.httpOnly));assert.equal(identityCalls,2);}
    assert.equal(initialization,1);assert.equal(submissions,scenario==='manual-verification'?2:1);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
