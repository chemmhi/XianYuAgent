set -eu
cd /home/ubuntu/xianyu-agent-prod
docker compose -f compose.prod.yml exec -T api node --input-type=module <<'NODE'
import fs from 'node:fs';
import {loadConfig} from '/app/dist/config.js';
import {createApp} from '/app/dist/app.js';
const root='/tmp/xianyu-slider-recording-20261023';
const runtime=createApp({...loadConfig(),autoReplyModelEnabled:false,autoReplySendMode:'simulate',productAutomationExecutionMode:'simulate',autoReplyOutcomeReviewWorkerEnabled:false});
const adminId='1921b632-b724-4e28-a18b-13f30b4a57f6',accountId='1d274de5-38b8-4c9b-83ed-d8ba803685ac';
const deviceId='DB3BBC6F-9468-4BA9-8833-26CA50F4C44B-1903703477';
const originalFetch=globalThis.fetch;
const events=[];
globalThis.fetch=async (url,init)=>{const input={utc:new Date().toISOString(),url:String(url),init:{...init,signal:undefined}};const response=await originalFetch(url,init);const output={status:response.status,headers:[...response.headers],body:await response.clone().text()};events.push({input,output});return response;};
try {
 const before=await runtime.store.getCredential(adminId,accountId);
 const result=await runtime.xianyu.fetchImToken(adminId,accountId,deviceId);
 fs.writeFileSync(root+'/official-device-probe.json',JSON.stringify({utc:new Date().toISOString(),adminId,accountId,deviceId,before,result,events},null,2));
 if(result.success&&result.accessToken){const latest=await runtime.store.getCredential(adminId,accountId);await runtime.store.upsertCredential({adminId,accountId,platform:'xianyu',cookieHeader:result.cookieHeader,accessToken:result.accessToken,deviceId,metadata:latest.metadata,expiresAt:latest.expiresAt});}
 console.log(JSON.stringify({success:result.success,errorCode:result.errorCode,hasToken:!!result.accessToken}));
} finally {await runtime.close();}
NODE
