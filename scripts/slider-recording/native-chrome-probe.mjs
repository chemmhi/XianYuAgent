import { spawn } from 'node:child_process';
import { readFileSync, cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'patchright';
import { store as recording } from './preload.mjs';
import { readFingerprint } from './fingerprint.mjs';
import { probeEndpointDrag } from './drag-probe.mjs';

const root = recording.root;
const installation = JSON.parse(readFileSync(join(root, '../chrome-installation.json'), 'utf8')).path;
const cookies = JSON.parse(readFileSync(join(root, '../current-chrome-goofish-cookies.json'), 'utf8')).cookies.map(({ name,value,domain,path,expires,httpOnly,secure,sameSite })=>({name,value,domain,path,expires,httpOnly,secure,sameSite}));
if(cookies.find(c=>c.name==='unb')?.value!=='1903703477')throw new Error('Account identity mismatch');
const profile = join(root, 'native-profile');
mkdirSync(profile,{recursive:true});
const port = 9339;
const args=[`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--window-size=1440,900','--lang=zh-CN','about:blank'];
recording.event('native.launch',{executable:join(installation,'chrome.exe'),args,cookies});
const child=spawn(join(installation,'chrome.exe'),args,{windowsHide:true,stdio:'ignore'});
recording.json('native-process.json',{pid:child.pid,port,profile,args});
let browser,context;
const pending=new Set();
const observe=(task)=>{pending.add(task);task.catch(error=>recording.event('recording.error',{scope:'native-network',error})).finally(()=>pending.delete(task));};
try{
 for(let index=0;index<40;index++){try{await fetch(`http://127.0.0.1:${port}/json/version`);break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}}
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
 context=browser.contexts()[0];
 const page=context.pages()[0]??await context.newPage();
 const ids=new WeakMap();
 page.on('request',request=>{const requestId=recording.id();ids.set(request,requestId);observe((async()=>recording.event('browser.request',{requestId,method:request.method(),url:request.url(),resourceType:request.resourceType(),headers:await request.allHeaders(),body:recording.blob(request.postDataBuffer()??Buffer.alloc(0))}))());});
 page.on('response',response=>observe((async()=>{const requestId=ids.get(response.request());recording.event('browser.response',{requestId,url:response.url(),status:response.status(),headers:await response.allHeaders()});let timer;try{const body=await Promise.race([response.body(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Native response body timeout')),5000);})]);recording.event('browser.response.body',{requestId,body:recording.blob(body)});}catch(error){recording.event('browser.response.body.unavailable',{requestId,error});}finally{clearTimeout(timer);}})()));
 page.on('requestfailed',request=>recording.event('browser.requestfailed',{requestId:ids.get(request),url:request.url(),failure:request.failure()}));
 page.on('console',message=>recording.event('browser.console',{type:message.type(),text:message.text()}));
 page.on('websocket',socket=>{const socketId=recording.id();recording.event('browser.ws.open',{socketId,url:socket.url()});for(const direction of ['framesent','framereceived'])socket.on(direction,({payload})=>recording.event(`browser.ws.${direction}`,{socketId,payload:recording.blob(Buffer.isBuffer(payload)?payload:String(payload))}));socket.on('close',()=>recording.event('browser.ws.close',{socketId}));});
 for(const name of ['move','down','up']){const original=page.mouse[name].bind(page.mouse);page.mouse[name]=async(...args)=>{recording.event('browser.call.input',{callId:recording.id(),target:'native.mouse',method:name,args});return original(...args);};}
 // Observe before touching the page; no user-agent override or init script.
 await context.addCookies(cookies);
 if(process.env.XIANYU_PROBE_HUMAN==='true') await context.addInitScript(()=>{
   for(const type of ['mousedown','mousemove','mouseup'])document.addEventListener(type,event=>{if(type==='mousemove'&&event.buttons===0)return;console.info('XIANYU_RECORDED_INPUT '+JSON.stringify({type,x:event.clientX,y:event.clientY,buttons:event.buttons,trusted:event.isTrusted,timeStamp:event.timeStamp,utc:new Date().toISOString()}));},true);
 });
 await page.goto('https://www.goofish.com/',{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForTimeout(2500);
 await page.goto('https://www.goofish.com/im',{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForTimeout(10000);
 async function snapshot(stage){const frames=[];for(const frame of page.frames()){try{frames.push({url:frame.url(),html:await frame.content(),fingerprint:await frame.evaluate(readFingerprint)});}catch(error){frames.push({url:frame.url(),error:String(error)});}}recording.json(`${stage}.json`,{url:page.url(),frames,cookies:await context.cookies(),storageState:await context.storageState()});await page.screenshot({path:join(root,`${stage}.png`),fullPage:true});}
 await snapshot('native-before');
 const frame=page.frames().find(frame=>/punish|captcha|verify/i.test(frame.url()));
 if(!frame){recording.event('native.no-challenge',{url:page.url()});}
 else if(process.env.XIANYU_PROBE_HUMAN==='true'){
   recording.json('native-human-ready.json',{utc:new Date().toISOString(),url:page.url(),frameUrl:frame.url(),pid:child.pid,account:'逐星智能',sellerRef:'1903703477'});
   console.log(JSON.stringify({event:'native-human-ready',pid:child.pid}));
   const deadline=Date.now()+10*60_000;
   while(Date.now()<deadline){const current=await context.cookies();if(current.some(cookie=>cookie.name==='x5sec')){recording.event('native.human.challenge-passed',{cookies:current});await page.waitForTimeout(3500);break;}await page.waitForTimeout(1000);}
 }else{const result=await probeEndpointDrag(page,frame,recording);recording.json('native-drag-result.json',result);console.log(JSON.stringify({event:'native-drag-result',...result}));}
 await snapshot('native-after');
 const current=await context.cookies();
 const fresh=current.find(c=>c.name==='x5sec');
 recording.json('native-output-cookies.json',current);
 console.log(JSON.stringify({event:'native-output',hasX5sec:!!fresh}));
 await Promise.allSettled([...pending]);
}finally{
 if(context)await context.close().catch(error=>recording.event('native.close.error',{error}));
 if(browser)await browser.close().catch(()=>{});
 child.kill();
 try{cpSync(profile,join(root,'profile-after'),{recursive:true});}catch(error){recording.event('recording.error',{scope:'native-profile-copy',error});}
 recording.event('native.closed',{});
}
