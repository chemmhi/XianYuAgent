import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer as createTcpServer} from 'node:net';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {createServer as createVite} from 'vite';
import {createVerificationServiceFixture} from './verification-service-fixture.ts';

// Production React/API/WS/Chrome and PostgreSQL; the external challenge is a synthetic fixture.
const databaseUrl=process.env.MANUAL_VERIFICATION_UI_DATABASE_URL;
if(!databaseUrl||!['127.0.0.1','localhost'].includes(new URL(databaseUrl).hostname)||new URL(databaseUrl).pathname!=='/xianyu_manual_verification_ui_test')throw new Error('isolated verification UI DB required');
const root=await mkdtemp(join(tmpdir(),'password-risk-ui-')),evidence=join(tmpdir(),'password-risk-verification-evidence');
const f=await createVerificationServiceFixture({databaseUrl,nativeChallenge:true,passwordAuthenticated:true});
let vite,chrome,socket;
async function until(read,accept,label,timeout=25_000){const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(accept(value))return value;await new Promise(r=>setTimeout(r,80));}throw new Error('Timed out: '+label);}
try{
  process.env.VITE_API_MODE='live';process.env.VITE_API_PROXY_TARGET=f.baseUrl;
  vite=await createVite({root:resolve(import.meta.dirname,'../../web'),cacheDir:join(root,'vite-cache'),server:{host:'127.0.0.1',port:0}});await vite.listen();
  const web=`http://127.0.0.1:${vite.httpServer.address().port}`;f.runtime.config.webSocketAllowedOrigins.push(web);
  const tcp=createTcpServer();await new Promise(r=>tcp.listen(0,'127.0.0.1',r));const port=tcp.address().port;await new Promise(r=>tcp.close(r));
  chrome=spawn(process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${join(root,'frontend')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  const target=await until(async()=>{try{return(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');}catch{return undefined;}},Boolean,'isolated Chrome');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,fail)=>{socket.onopen=ok;socket.onerror=fail;});
  let id=0;const pending=new Map();socket.onmessage=e=>{const reply=JSON.parse(e.data),call=pending.get(reply.id);if(!call)return;pending.delete(reply.id);reply.error?call.reject(new Error(reply.error.message)):call.resolve(reply.result);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??'page exception');return r.result?.value;};
  async function click(label){const point=await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return null;const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);assert.ok(point,label);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});}
  await send('Network.enable');for(const[name,value]of [['session_id',f.session.id],['csrf_token',f.csrf]])await send('Network.setCookie',{name,value,url:web});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:web+'/accounts'});await send('Page.bringToFront');
  await until(()=>evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='重试')`),Boolean,'account verification retry');await click('重试');
  await until(()=>evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='我来操作'&&!b.disabled)`),Boolean,'decoded official session frame');await click('我来操作');
  await until(()=>evaluate(`document.querySelector('[data-testid="verification-panel"]')?.dataset.state`),s=>s==='human_active','manual controller');
  await mkdir(evidence,{recursive:true});
  for(const[width,height,name]of [[1440,900,'manual-desktop.png'],[390,844,'manual-mobile.png']]){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await writeFile(join(evidence,name),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));}
  const box=await evaluate(`(()=>{const i=document.querySelector('img[alt="闲鱼原会话验证画面"]');const r=i?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null;})()`);assert.ok(box&&box.width>100);
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});const{start,end}=f.pointer;
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*start.x,y:box.y+box.height*start.y}]});
  for(let step=1;step<=12;step++){await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*(start.x+(end.x-start.x)*step/12),y:box.y+box.height*(start.y+(end.y-start.y)*step/12)}]});await new Promise(r=>setTimeout(r,35));}
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await until(()=>evaluate(`document.body.innerText`),text=>text.includes('验证完成'),'page verified outcome',35_000);
  const row=(await f.runtime.verification.coordinator.repository.list()).find(s=>s.subject.accountId===f.account.id),account=await f.runtime.store.getAccount(f.admin.id,f.account.id),credential=await f.runtime.store.getCredential(f.admin.id,f.account.id);
  assert.equal(row.state,'succeeded');assert.equal(row.mode,'manual_only');assert.equal(row.autoAttempts,0);assert.equal((await f.runtime.store.listAccountVerificationRisks(f.admin.id,f.account.id)).length,0);
  assert.equal(credential.accessToken,'fixture-access');assert.equal(credential.metadata.loginMethod,'password_http');assert.equal(account.transportStatus,'connected');assert.ok(Date.parse(account.transportSeenAt)>Date.now()-15_000);
  assert.ok(f.stats.registrations>0&&f.stats.heartbeats>0);assert.deepEqual(f.stats.browserUserAgents,['fixture-password-session-ua']);
  await writeFile(join(evidence,'success-mobile.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await writeFile(join(evidence,'result.json'),JSON.stringify({path:'Chrome/CDP -> production React/API/WS -> PostgreSQL -> original server Chrome -> Token CAS -> fresh IM heartbeat -> DOM',passwordAuthenticated:true,manualState:row.state,automaticGestures:row.autoAttempts,externalPlatform:'synthetic controlled fixture',productionAcceptance:false},null,2));
  console.log('Password account real DOM/API/PG/official-session continuation and matched heartbeat PASS (external platform fixture)');
}finally{
  socket?.close();chrome?.kill();await vite?.close();await f.close();
  if(dirname(root)!==resolve(tmpdir())||!basename(root).startsWith('password-risk-ui-'))throw new Error('unexpected fixture root');
  await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
