import QRCode from 'qrcode';

export interface PasswordIvStatus { imageDataUrl:string;status:'waiting'|'verifying'|'auditing'|'rejected';expiresAt:string }
export interface PasswordIvContext {
  get(url:string,referer?:string):Promise<{response:Response;url:string}>;
  json(url:string,referer?:string):Promise<Record<string,unknown>>;
  assertActive():Promise<void>;
  signal:AbortSignal;
  onStatus(status:PasswordIvStatus):Promise<void>;
  pollIntervalMs?:number;
}
export function isPasswordIvUrl(value:string):boolean{
  try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='passport.goofish.com'&&!url.port&&!url.username&&!url.password&&url.pathname==='/iv/remote/pc/mini_login_check.htm';}catch{return false;}
}
function scopedUrl(value:string,base:string,path:RegExp):string{
  const url=new URL(value.replaceAll('&amp;','&').replaceAll('\\/','/'),base);
  if(url.protocol!=='https:'||url.hostname!=='passport.goofish.com'||url.port||url.username||url.password||!path.test(url.pathname))throw new Error('PASSWORD_IV_URL_UNSUPPORTED');
  return url.href;
}
function quotedUrl(html:string,part:string):string|undefined{
  const expression=new RegExp(`["']([^"'<>]*${part}[^"'<>]*)["']`);
  return expression.exec(html)?.[1];
}
export async function completePasswordIv(initialUrl:string,context:PasswordIvContext):Promise<void>{
  if(!isPasswordIvUrl(initialUrl))throw new Error('PASSWORD_IV_URL_UNSUPPORTED');
  await context.assertActive();
  let page=await context.get(initialUrl),html=await page.response.text();
  if(page.url.includes('/mini_expired.htm'))throw new Error('PASSWORD_IV_EXPIRED');
  if(!page.response.ok)throw new Error('PASSWORD_IV_INIT_FAILED');
  if(page.url.includes('/iv/mini/normal_validate.htm')){
    const target=quotedUrl(html,'/iv/mini/verify_modes\\.htm');
    if(!target||!target.endsWith('_umidfg='))throw new Error('PASSWORD_IV_RESPONSE_UNSUPPORTED');
    // The official document's SDK error/timeout branch uses -1; no successful device signature is fabricated.
    page=await context.get(scopedUrl(target+'-1',page.url,/^\/iv\/mini\/verify_modes\.htm$/),page.url);html=await page.response.text();
  }
  if(!page.response.ok||!page.url.includes('/iv/mini/identity_verify.htm'))throw new Error('PASSWORD_IV_RESPONSE_UNSUPPORTED');
  const qrText=/\btext\s*:\s*["'](https:\/\/market\.m\.taobao\.com\/app\/msd\/m-rpverify-internal\/start\.html\?[^"'<>]+)["']/.exec(html)?.[1];
  const check=quotedUrl(html,'/iv/photoVerify/check\\.do');
  if(!qrText||!check)throw new Error('PASSWORD_IV_RESPONSE_UNSUPPORTED');
  const checkUrl=scopedUrl(check,page.url,/^\/iv\/photoVerify\/check\.do$/),qr=new URL(qrText.replaceAll('&amp;','&'));
  if(!qr.searchParams.get('token')||qr.searchParams.get('tokenSource')!=='getVerifyToken')throw new Error('PASSWORD_IV_RESPONSE_UNSUPPORTED');
  const interval=Number(/\bcheckInterval\s*=\s*(\d+)/.exec(html)?.[1]??2000),timeout=Number(/\btimeout\s*=\s*(\d+)/.exec(html)?.[1]??480000);
  if(interval<1000||interval>10000||timeout<1000||timeout>480000)throw new Error('PASSWORD_IV_RESPONSE_UNSUPPORTED');
  const deadline=Date.now()+timeout,imageDataUrl=await QRCode.toDataURL(qr.href,{width:240,margin:2});
  let status:PasswordIvStatus['status']='waiting';
  while(Date.now()<deadline){
    await context.assertActive();context.signal.throwIfAborted();
    await context.onStatus({imageDataUrl,status,expiresAt:new Date(deadline).toISOString()});
    await delay(context.pollIntervalMs??interval,context.signal);
    const result=await context.json(checkUrl,page.url),content=record(result.content),code=String(content.code??'');
    if(code==='3'){
      if(typeof content.url!=='string')throw new Error('PASSWORD_IV_RESPONSE_UNSUPPORTED');
      const exchange=scopedUrl(content.url,checkUrl,/^(?:\/iv\/(?:[^/]+\/)*|\/newlogin\/safe\/)ivCheckLogin\.htm$/);
      await context.assertActive();
      await delay(context.pollIntervalMs??3000,context.signal);
      const completed=await context.get(exchange,page.url);await completed.response.arrayBuffer();
      if(!completed.response.ok||completed.url.includes('/mini_expired.htm'))throw new Error('PASSWORD_IV_EXPIRED');
      await context.assertActive();return;
    }
    if(code==='-1')status='rejected';
    else if(code==='1')status='verifying';else if(code==='2')status='auditing';else if(code==='0'||code==='')status='waiting';
    else throw new Error('PASSWORD_IV_RESPONSE_UNSUPPORTED');
  }
  throw new Error('PASSWORD_IV_EXPIRED');
}
function record(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function delay(ms:number,signal:AbortSignal):Promise<void>{return new Promise((resolve,reject)=>{const stop=()=>{clearTimeout(timer);reject(new Error('PASSWORD_LOGIN_CANCELLED'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},ms);signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();});}
