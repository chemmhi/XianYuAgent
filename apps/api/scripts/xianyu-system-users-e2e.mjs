import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer as createTcpServer} from 'node:net';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer as createVite} from 'vite';
import {createApp} from '../src/app.js';
import {loadConfig} from '../src/config.js';
import {sha256} from '../src/security.js';
import {passwordTestDatabase} from './password-login-test-database.mjs';

// Real React/API/PostgreSQL. Only Xianyu history/send adapters are controlled fixtures.
const root=await mkdtemp(join(tmpdir(),'system-users-ui-'));
const evidence=join(tmpdir(),'xianyu-system-users-evidence');
const oldPath=process.env.XIANYU_SYSTEM_USERS_FILE;
process.env.XIANYU_SYSTEM_USERS_FILE=join(root,'users.json');
const put=async userIds=>writeFile(process.env.XIANYU_SYSTEM_USERS_FILE,JSON.stringify({version:1,userIds}));
await put(['1400']);
const db=await passwordTestDatabase();
const runtime=createApp(loadConfig({HOST:'127.0.0.1',PORT:'0',DATABASE_URL:db.url,REDIS_URL:'',ALLOW_IN_MEMORY:'false',COOKIE_SECURE:'false',XIANYU_QR_MODE:'stub',AGENT_RUNTIME:'in-process',AUTO_REPLY_MODEL_ENABLED:'false',AUTO_REPLY_AGENT_SEND_DELAY_SECONDS:'0',AUTO_REPLY_AGENT_DEBOUNCE_MS:'0',AUTO_REPLY_OUTCOME_REVIEW_WORKER_ENABLED:'false'}));
let vite,chrome,socket,writes=0,historyReads=0;
async function until(read,accept,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(accept(value))return value;await new Promise(r=>setTimeout(r,70));}throw new Error('Timed out: '+label);}
try{
  const admin=await runtime.store.createAdmin({email:'system-users-e2e@example.test',passwordHash:'fixture-only',displayName:'System users test',role:'admin'});
  const csrf=randomUUID(),session=await runtime.store.createSession({adminId:admin.id,csrfTokenHash:sha256(csrf),expiresAt:new Date(Date.now()+3600000).toISOString()});
  const account=await runtime.store.createAccount({adminId:admin.id,platform:'xianyu',sellerRef:'fixture-seller',displayName:'系统用户测试账号'});
  const conversation=await runtime.store.createConversation({adminId:admin.id,accountId:account.id,buyerRef:'1400',buyerDisplayName:'闲小蜜测试通知',externalConversationRef:'fixture-conv'});
  const custom=await runtime.store.createConversation({adminId:admin.id,accountId:account.id,buyerRef:'2400',buyerDisplayName:'自定义系统用户',externalConversationRef:'custom-conv'});
  const history=[{message:{messageId:'history-system.PNM',senderUserId:'1400@goofish',createAt:Date.now(),content:{custom:{type:1,data:Buffer.from(JSON.stringify({text:{text:'系统通知历史验收'}})).toString('base64')}}}}];
  runtime.xianyuIm.ensureClient=async()=>({selfUserIds:['fixture-seller'],listConversations:async()=>({hasMore:false,userConvs:[]}),listMessages:async ref=>{historyReads++;return{hasMore:false,userMessageModels:ref==='fixture-conv'?history:[]};},markRead:async()=>{},sendText:async()=>({externalMessageRef:`fixture-manual-${++writes}.PNM`})});
  await runtime.listen();
  const api=`http://127.0.0.1:${runtime.server.address().port}`;
  // Future retry jobs are cancelled without leasing or crossing administrator scopes.
  const queued=await runtime.store.enqueueAutoReplyOutbox({scope:'auto_reply_send',aggregateType:'auto_reply_run',aggregateId:randomUUID(),operation:'send_text',idempotencyKey:'future-system',availableAt:new Date(Date.now()+3600000).toISOString(),payload:{adminId:admin.id}});
  assert.equal(await runtime.store.suppressPendingAutoReplyOutbox({adminId:randomUUID(),runId:queued.record.aggregateId,errorCode:'XIANYU_SYSTEM_USER_IGNORED'}),0);
  assert.equal(await runtime.store.suppressPendingAutoReplyOutbox({adminId:admin.id,runId:queued.record.aggregateId,errorCode:'XIANYU_SYSTEM_USER_IGNORED'}),1);
  assert.equal((await runtime.store.getAutoReplyOutbox('auto_reply_send','future-system')).status,'dead_lettered');
  process.env.VITE_API_MODE='live';process.env.VITE_API_PROXY_TARGET=api;
  vite=await createVite({root:resolve(import.meta.dirname,'../../web'),cacheDir:join(root,'vite-cache'),server:{host:'127.0.0.1',port:0}});await vite.listen();
  const web=`http://127.0.0.1:${vite.httpServer.address().port}`;runtime.config.webSocketAllowedOrigins.push(web);
  const tcp=createTcpServer();await new Promise(r=>tcp.listen(0,'127.0.0.1',r));const port=tcp.address().port;await new Promise(r=>tcp.close(r));
  chrome=spawn(process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${join(root,'chrome')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  const target=await until(async()=>{try{return(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');}catch{return undefined;}},Boolean,'isolated Chrome');
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,fail)=>{socket.onopen=ok;socket.onerror=fail;});
  let id=0;const pending=new Map();socket.onmessage=e=>{const reply=JSON.parse(e.data),call=pending.get(reply.id);if(!call)return;pending.delete(reply.id);reply.error?call.reject(new Error(reply.error.message)):call.resolve(reply.result);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??'page exception');return r.result?.value;};
  async function click(selector){const point=await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b||b.disabled)return null;const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);assert.ok(point,selector);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});}
  await send('Network.enable');for(const[name,value]of[['session_id',session.id],['csrf_token',csrf]])await send('Network.setCookie',{name,value,url:web});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:web+'/messages?accountId='+account.id});
  await until(()=>evaluate(`document.body.innerText`),text=>text.includes('闲小蜜测试通知'),'conversation list');
  const select=await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('闲小蜜测试通知'));if(!b)return null;const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if(select){await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...select});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...select});}
  await until(()=>evaluate(`document.querySelector('.messages-system-row')?.innerText`),text=>text?.includes('系统通知历史验收'),'history classified in DOM');
  assert.ok(historyReads>0);
  const rows=await runtime.messages.listMessages(admin.id,conversation.id,{limit:20});
  assert.equal(rows.items.find(m=>m.externalMessageRef==='history-system.PNM').senderRole,'system');
  await put(['1400','2400']);
  const added=await runtime.xianyuIm.handleExternalEvent(admin.id,{accountId:account.id,externalConversationRef:'custom-conv',externalMessageRef:'hot-system.PNM',senderRef:'2400',senderName:'自定义系统用户',direction:'inbound',bodyType:'text',bodyText:'新增ID通知',occurredAt:new Date().toISOString()});
  assert.equal(added.autoReply,undefined);
  assert.equal((await runtime.messages.listMessages(admin.id,custom.id,{limit:20})).items[0].bodyType,'system');
  assert.equal(writes,0);
  await click('textarea[aria-label="消息内容"]');await send('Input.insertText',{text:'人工消息仍可发送'});
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await until(()=>evaluate(`document.querySelector('.messages-bubble-row.outbound')?.innerText`),text=>text?.includes('人工消息仍可发送'),'manual message persisted in DOM');
  assert.equal(writes,1);
  assert.equal((await runtime.messages.listMessages(admin.id,conversation.id,{limit:20})).items.filter(m=>m.source==='human').length,1);
  assert.equal((await runtime.store.listAutoReplyRuns(admin.id,{accountId:account.id,page:1,pageSize:20})).items.length,0);
  await mkdir(evidence,{recursive:true});
  await writeFile(join(evidence,'system-notice-and-manual.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await writeFile(join(evidence,'result.json'),JSON.stringify({path:'Chrome/CDP -> React messages -> real API -> PostgreSQL -> system DOM and manual outbound DOM',hotAddWithoutRestart:true,autoReplyRuns:0,manualExternalFixtureWrites:writes,historyReads,externalPlatform:'controlled fixture',productionAcceptance:false},null,2));
  console.log('System users real DOM/API/PostgreSQL, hot reload, future outbox suppression and manual messaging PASS');
}finally{
  socket?.close();chrome?.kill();await vite?.close();await runtime.close();await db.close();
  if(oldPath===undefined)delete process.env.XIANYU_SYSTEM_USERS_FILE;else process.env.XIANYU_SYSTEM_USERS_FILE=oldPath;
  if(dirname(root)!==resolve(tmpdir())||!basename(root).startsWith('system-users-ui-'))throw new Error('unexpected fixture root');
  await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
