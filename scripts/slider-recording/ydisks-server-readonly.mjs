import fs from 'node:fs';
import { join } from 'node:path';
const root = process.env.XIANYU_COPY_INPUT_DIR;
const encoded = Buffer.from(fs.readFileSync(join(root, 'verified-recovery-credential.json'))).toString('base64');
const script = `set -eu
cd /home/ubuntu/xianyu-agent-prod
docker compose -f compose.prod.yml exec -T api node --input-type=module <<'READONLY_ACCOUNT_NETWORK_PROBE'
import { WebSocket } from 'ws';
import { XianyuMtopClient } from './dist/xianyu-mtop.js';
import { XianyuImClient } from './dist/xianyu-im.js';
import { XIANYU_USER_AGENT } from './dist/xianyu-browser-identity.js';
const input = JSON.parse(Buffer.from('${encoded}', 'base64').toString('utf8'));
if(input.accountId !== '1d274de5-38b8-4c9b-83ed-d8ba803685ac' || input.sellerRef !== '1903703477') throw Error('Account mismatch');
let sequence=0;
const emit=(type,data)=>console.log(JSON.stringify({utc:new Date().toISOString(),pid:process.pid,sequence:++sequence,type,data}));
emit('runtime',{env:process.env,versions:process.versions,userAgent:XIANYU_USER_AGENT,source:input.source,businessDatabaseAccess:false});
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init={})=>{
 emit('fetch.request',{url:String(url),method:init.method??'GET',headers:[...new Headers(init.headers)],body:init.body});
 const response=await originalFetch(url,init);
 emit('fetch.response',{url:response.url,status:response.status,headers:[...response.headers],setCookie:response.headers.getSetCookie(),bodyBase64:Buffer.from(await response.clone().arrayBuffer()).toString('base64')});
 return response;
};
let credential=input.credential;
const client=new XianyuMtopClient({timeoutMs:20000,loadCredential:async()=>credential,saveCookie:async(_admin,_account,cookieHeader,metadata)=>{credential={...credential,cookieHeader,metadata};emit('credential.memory.update',credential);}});
const login=await client.verifyLogin(input.adminId,input.accountId);emit('account.login.result',login);
const token=await client.fetchImToken(input.adminId,input.accountId,input.deviceId);emit('account.token.result',token);
const accessToken=token.success&&token.accessToken?token.accessToken:input.accessToken;
let registered=false;
if(accessToken){
 const im=new XianyuImClient({accountId:input.accountId,credential:{cookieHeader:input.credential.cookieHeader,accessToken,deviceId:input.deviceId},timeoutMs:15000,
  onStatusChange:status=>emit('ws.status',{status}),onFailure:error=>emit('ws.failure',{message:error.message,code:error.code}),
  webSocketFactory:(url,options)=>{emit('ws.connect',{url,options});const socket=new WebSocket(url,options);const send=socket.send.bind(socket);socket.send=(payload,...args)=>{emit('ws.send',{url,payload:payload.toString()});return send(payload,...args);};socket.on('message',raw=>emit('ws.receive',{url,text:raw.toString()}));socket.on('upgrade',r=>emit('ws.upgrade',{status:r.statusCode,headers:r.headers}));return socket;}
 });
 try{await im.connect();registered=im.connected;emit('ws.client.result',{registered,status:im.status,userId:im.userId,deviceId:im.deviceId});}
 catch(error){emit('ws.client.error',{message:error.message,code:error.code});}
 finally{await im.disconnect();}
}
emit('server.readonly.verdict',{loginSuccess:login.success,tokenSuccess:token.success,hasFreshToken:Boolean(token.accessToken),registered,tokenSource:token.success?'server-request':'verified-native-browser',businessDatabaseWritten:false});
READONLY_ACCOUNT_NETWORK_PROBE
`;
fs.writeFileSync(join(root, 'server-network-readonly.sh'), script);
console.log(JSON.stringify({ prepared: true, target: 'tencent-server', databaseWrites: false, websocketActions: ['/reg'] }));
