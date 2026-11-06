import type { BrowserContext } from 'patchright';
import { applySetCookies, type XianyuCookieSnapshot, XIANYU_TOP_SITE } from './xianyu-cookie-jar.js';

function identity(cookie:XianyuCookieSnapshot[number]){return JSON.stringify([cookie.name,(cookie.domain??'').replace(/^\./,''),cookie.path??'/',cookie.partitionKey??'',cookie._crHasCrossSiteAncestor??false]);}
export function officialDeviceCookies(snapshot:XianyuCookieSnapshot):XianyuCookieSnapshot{
  return snapshot.filter(cookie=>/(^|\.)goofish\.com$/.test((cookie.domain??'').replace(/^\./,'')));
}
export async function writeDeviceCookies(context:BrowserContext,snapshot:XianyuCookieSnapshot){
  for(const cookie of officialDeviceCookies(snapshot)){
    if(cookie.expires!==undefined&&cookie.expires>0&&cookie.expires<=Date.now()/1000)continue;
    await context.addCookies([{name:cookie.name,value:cookie.value,domain:cookie.domain!,path:cookie.path??'/',
      ...(cookie.expires&&cookie.expires>0?{expires:cookie.expires}:{}),secure:cookie.secure??false,httpOnly:cookie.httpOnly??false,
      ...(['Strict','Lax','None'].includes(cookie.sameSite??'')?{sameSite:cookie.sameSite as 'Strict'|'Lax'|'None'}:{}),...(cookie.partitionKey?{partitionKey:cookie.partitionKey,_crHasCrossSiteAncestor:cookie._crHasCrossSiteAncestor}: {})}]);
  }
}
/** Apply only this HTTP response's mutations. Never overwrite SDK cookies with a stale full jar. */
export async function absorbDeviceCookies(context:BrowserContext,url:string,raw:string[]){
  const source=new URL(url);if(!/(^|\.)goofish\.com$/.test(source.hostname))throw new Error('PASSWORD_DEVICE_COOKIE_ORIGIN');
  const safe=raw.filter(value=>{const domain=/;\s*domain=([^;]+)/i.exec(value)?.[1]?.trim().replace(/^\./,'').toLowerCase();return !domain||source.hostname===domain||source.hostname.endsWith('.'+domain);});
  if(safe.length!==raw.length)throw new Error('PASSWORD_DEVICE_COOKIE_DOMAIN');
  const before=officialDeviceCookies(await context.cookies());let next=before;
  for(const value of safe){
    const scope=applySetCookies([],url,[value.replace(/;\s*(?:max-age|expires)=[^;]*/ig,'')],Date.now(),XIANYU_TOP_SITE)[0];
    if(scope)next=next.filter(old=>identity(old)!==identity(scope));
    next=applySetCookies(next,url,[value],Date.now(),XIANYU_TOP_SITE);
  }
  const desired=new Map(next.map(cookie=>[identity(cookie),cookie]));
  for(const old of before)if(!desired.has(identity(old))||desired.get(identity(old))!.domain!==old.domain){
    if(old.partitionKey){const session=await context.newCDPSession(context.pages()[0]);try{await session.send('Network.deleteCookies',{name:old.name,domain:old.domain,path:old.path,partitionKey:{topLevelSite:old.partitionKey,hasCrossSiteAncestor:old._crHasCrossSiteAncestor??false}});}finally{await session.detach();}}
    else await context.clearCookies({name:old.name,domain:old.domain,path:old.path});
  }
  for(const cookie of next){const old=before.find(value=>identity(value)===identity(cookie));if(!old||JSON.stringify(old)!==JSON.stringify(cookie))await writeDeviceCookies(context,[cookie]);}
}
