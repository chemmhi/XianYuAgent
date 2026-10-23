import { store as recording } from './preload.mjs';
import { probeEndpointDrag } from './drag-probe.mjs';
const { chromium } = await import('patchright');
const { loadConfig } = await import('/app/dist/config.js');
const { createApp } = await import('/app/dist/app.js');
const { XianyuSliderSolver } = await import('/app/dist/xianyu-slider-solver.js');
const { cookieHeaderFromSnapshot, metadataWithCookieSnapshot, dropStaleCaptchaChallengeCookies } = await import('/app/dist/xianyu-cookie-jar.js');
const runtime = createApp({ ...loadConfig(), autoReplyModelEnabled: false, autoReplySendMode: 'simulate', productAutomationExecutionMode: 'simulate', autoReplyOutcomeReviewWorkerEnabled: false });
const adminId='1921b632-b724-4e28-a18b-13f30b4a57f6',accountId='1d274de5-38b8-4c9b-83ed-d8ba803685ac';
const credential = await runtime.store.getCredential(adminId, accountId);
const cookies=(credential.cookieHeader??'').split(';').flatMap(part=>{const index=part.indexOf('=');if(index<1)return [];const name=part.slice(0,index).trim();if(/^x5sec(data|tag)?$/i.test(name))return [];return [{name,value:part.slice(index+1).trim(),domain:'.goofish.com',path:'/'}];});
recording.json('browser-probe-input.json',{adminId,accountId,credential,cookies,source:'Shipped Patchright and solver; native UA; fresh account-isolated profile; homepage then official IM, no QR login'});
let context;
try {
 context=await chromium.launchPersistentContext('/tmp/xianyu-slider-browser-probe-profile-20261023',{channel:'chrome',headless:false,viewport:{width:1440,height:900},locale:'zh-CN',timezoneId:'Asia/Shanghai',args:['--no-sandbox','--disable-setuid-sandbox','--window-size=1440,900','--lang=zh-CN']});
 await context.addCookies(cookies);
 const page=context.pages()[0]??await context.newPage();
 await page.goto('https://www.goofish.com/',{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForTimeout(2500);
 await page.goto('https://www.goofish.com/im',{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForTimeout(12000);
 recording.json('browser-probe-before-solve.json',{url:page.url(),frames:await Promise.all(page.frames().map(async frame=>({url:frame.url(),html:await frame.content().catch(String)}))),cookies:await context.cookies()});
 const challengeFrame=page.frames().find(frame=>/punish|captcha|verify/i.test(frame.url()));
 const solverPage=challengeFrame?{url:()=>challengeFrame.url(),locator:challengeFrame.locator.bind(challengeFrame),frames:()=>[challengeFrame],mouse:page.mouse,reload:()=>challengeFrame.goto(challengeFrame.url(),{waitUntil:'domcontentloaded',timeout:30000})}:page;
 recording.event('browser.probe.target',{mainUrl:page.url(),challengeUrl:challengeFrame?.url()});
 const solver=new XianyuSliderSolver(solverPage,{maxRetries:2,elementTimeoutMs:8000,verificationTimeoutMs:6000,retryDelayMs:2500,logger:console});
 const result=process.env.XIANYU_PROBE_STRATEGY==='endpoint'?await probeEndpointDrag(page,challengeFrame??page,recording):await solver.solve();
 recording.json('browser-probe-solver-result.json',result);
 await page.waitForTimeout(2000);
 const after=await context.cookies();
 const fresh=after.find(cookie=>cookie.name==='x5sec');
 recording.json('browser-probe-after-solve.json',{result,cookies:after,url:page.url(),frames:await Promise.all(page.frames().map(async frame=>({url:frame.url(),html:await frame.content().catch(String)})))});
 if(result.success&&fresh){
   const snapshot=dropStaleCaptchaChallengeCookies(after);
   await runtime.store.upsertCredential({adminId,accountId,platform:'xianyu',cookieHeader:cookieHeaderFromSnapshot(snapshot),deviceId:credential.deviceId,metadata:metadataWithCookieSnapshot(credential.metadata,snapshot),expiresAt:credential.expiresAt});
   const token=await runtime.xianyu.fetchImToken(adminId,accountId,credential.deviceId);
   recording.json('browser-probe-token-after.json',token);
   if(token.success&&token.accessToken){const latest=await runtime.store.getCredential(adminId,accountId);await runtime.store.upsertCredential({adminId,accountId,platform:'xianyu',cookieHeader:token.cookieHeader,accessToken:token.accessToken,deviceId:credential.deviceId,metadata:latest.metadata,expiresAt:latest.expiresAt});}
 }
 console.log(JSON.stringify({event:'browser-probe-result',solverSuccess:result.success,hasFreshX5sec:!!fresh,failureReason:result.failureReason}));
}finally{if(context)await context.close();await runtime.close();}
