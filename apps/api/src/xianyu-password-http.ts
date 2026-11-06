import { createHash } from 'node:crypto';
import type { PasswordLoginTransport, PasswordLoginInput, PasswordLoginResult } from './password-login-port.js';
import { XIANYU_USER_AGENT, xianyuNavigatorPlatform } from './xianyu-browser-identity.js';
import { applySetCookies, cookieHeaderForUrl, cookieValue, setCookieValues, normalizeCookieSnapshot, XIANYU_TOP_SITE, type XianyuCookieSnapshot } from './xianyu-cookie-jar.js';
import { encryptXianyuPassword, loginFormFields, loginJsonAssignment } from './xianyu-password-protocol.js';
import { classifyPasswordLoginResponse, safeChallengeUrl } from './xianyu-password-response.js';
import { inspectXianyuVerification } from './xianyu-verification-response.js';
import {completePasswordIv,isPasswordIvUrl} from './xianyu-password-iv.js';
import type {PasswordDevice,PasswordDeviceFactory,PasswordDeviceRequest} from './password-device-port.js';

export class PasswordHttpVerificationRequired extends Error {
  constructor(readonly verificationUrl?: string) { super('PASSWORD_SECURITY_VERIFICATION_REQUIRED'); }
}
export interface PasswordHttpOptions {
  request?: typeof fetch;
  timeoutMs?: number;
  ivPollIntervalMs?:number;
  deviceFactory?:PasswordDeviceFactory;
  /** Explicit server-only fixture endpoints; never accepted from an HTTP request. */
  endpoints?: { home: string; mini: string; login: string; mtop: string };
}
/** Authentication stays on server HTTP; an optional persistent official SDK supplies current device parameters. */
export class XianyuPasswordHttp implements PasswordLoginTransport {
  constructor(private readonly options: PasswordHttpOptions = {}) {}
  async forgetDevice(profileKey:string){await this.options.deviceFactory?.forget?.(profileKey);}
  async run(input: PasswordLoginInput): Promise<PasswordLoginResult> {
    const endpoints = this.options.endpoints ?? { home:'https://www.goofish.com/', mini:'https://passport.goofish.com/mini_login.htm', login:'https://passport.goofish.com/newlogin/login.do', mtop:'https://h5api.m.goofish.com/h5/' };
    let jar: XianyuCookieSnapshot = normalizeCookieSnapshot(input.initialCookieSnapshot) ?? [];
    let userAgent=input.clientInfo?.userAgent??XIANYU_USER_AGENT;
    let device:PasswordDevice|undefined;
    const http = async (url: string, init: RequestInit = {}) => {
      await input.assertActive(); input.signal.throwIfAborted();
      let outgoing:PasswordDeviceRequest={url,method:init.method??'GET',body:typeof init.body==='string'?init.body:undefined,headers:Object.fromEntries(new Headers(init.headers))};
      if(device){
        if(outgoing.method==='POST'||new URL(url).pathname==='/iv/photoVerify/check.do')outgoing=await device.sign(outgoing);
        jar=await device.snapshot();
      }
      const response = await (this.options.request ?? fetch)(outgoing.url, { ...init,method:outgoing.method,body:outgoing.body, redirect:'manual', signal:AbortSignal.any([input.signal,AbortSignal.timeout(this.options.timeoutMs ?? 25000)]),
        headers:{ 'user-agent':userAgent,'accept-language':input.clientInfo?.language??'zh-CN,zh;q=0.9',referer:endpoints.home,...outgoing.headers,cookie:cookieHeaderForUrl(jar,outgoing.url,Date.now(),XIANYU_TOP_SITE) } });
      jar = applySetCookies(jar,url,setCookieValues(response.headers),Date.now(),XIANYU_TOP_SITE);
      if(device){await device.absorbResponse(outgoing.url,setCookieValues(response.headers));jar=await device.snapshot();}
      if (response.status >= 500) throw new Error('PASSWORD_LOGIN_UPSTREAM_UNAVAILABLE');
      return response;
    };
    const withNativeChallenge=async<T>(operation:()=>Promise<T>):Promise<T>=>{
      for(let round=0;round<6;round++){
        try{return await operation();}catch(error){
          if(!(error instanceof PasswordHttpVerificationRequired)||!error.verificationUrl||!input.onHttpVerification||round===5
            ||!/\/_____tmd_____\/punish\/?$/.test(new URL(error.verificationUrl).pathname))throw error;
          const challenge=new URL(error.verificationUrl),proof=await input.onHttpVerification(challenge.href);
          await input.assertActive();input.signal.throwIfAborted();
          if(proof.host!==challenge.host||!proof.value||proof.value.length>8192||/[\x00-\x20;\x7f]/.test(proof.value))throw new Error('PASSWORD_VERIFICATION_INVALID');
          const expires=Math.min(proof.expiresAt??Date.now()+300_000,Date.now()+1_800_000);
          if(!Number.isFinite(expires)||expires<=Date.now())throw new Error('PASSWORD_VERIFICATION_EXPIRED');
          jar=applySetCookies(jar,challenge.href,[`x5sec=${proof.value}; Path=/; Secure; Expires=${new Date(expires).toUTCString()}`],Date.now(),XIANYU_TOP_SITE);
          await device?.absorbResponse(challenge.href,[`x5sec=${proof.value}; Path=/; Secure; Expires=${new Date(expires).toUTCString()}`]);
        }
      }
      throw new Error('PASSWORD_SECURITY_VERIFICATION_REQUIRED');
    };
    const allowed = (raw: string, base: string) => {
      const url = new URL(raw,base);
      if (this.options.endpoints && Object.values(endpoints).some(e=>new URL(e).origin===url.origin)) return url.href;
      if (!safeChallengeUrl(url.href)) throw new Error('PASSWORD_SESSION_EXCHANGE_UNSUPPORTED');
      return url.href;
    };
    const get = async (initial: string,headers:Record<string,string>={}) => {
      let url = initial;
      for (let i=0;i<10;i++) {
        if(/\/_____tmd_____\/punish\/?$/.test(new URL(url).pathname))throw new PasswordHttpVerificationRequired(url);
        const response=await withNativeChallenge(async()=>{
          const next=await http(url,{headers});
          const location=next.headers.get('location');
          if(next.status>=300&&next.status<400&&location){
            const target=allowed(location,url);
            if(/\/_____tmd_____\/punish\/?$/.test(new URL(target).pathname)){await next.arrayBuffer();throw new PasswordHttpVerificationRequired(target);}
          }
          if(next.status<300||next.status>=400){
            const text=await next.clone().text();let payload:unknown;
            try{payload=JSON.parse(text);}catch{/* Exchange endpoints may return an empty body. */}
            // IV documents contain ordinary verify URLs; only an actual native challenge pauses this hop.
            const challenge=inspectXianyuVerification(payload, /_____tmd_____|RGV587|FAIL_SYS_USER_VALIDATE/.test(text)?text:'');
            if(challenge.required)throw new PasswordHttpVerificationRequired(challenge.verificationUrl);
          }
          return next;
        });
        if (response.status>=300 && response.status<400) {
          const location=response.headers.get('location');await response.arrayBuffer();if(!location)throw new Error('PASSWORD_LOGIN_RESPONSE_INVALID');url=allowed(location,url);continue;
        }
        return { response, url };
      }
      throw new Error('PASSWORD_SESSION_REDIRECT_LIMIT');
    };
    const exchange=async(url:string)=>{
      const next=await get(url);
      if(!next.response.ok)throw new Error('PASSWORD_SESSION_EXCHANGE_FAILED');
      if(next.response.headers.get('content-type')?.includes('text/html')){
        const text=await next.response.text(),challenge=inspectXianyuVerification({},text);
        if(challenge.required)throw new PasswordHttpVerificationRequired(challenge.verificationUrl);
      }else await next.response.arrayBuffer();
    };
    const json=async(response:Response)=>{
      const text=await response.text();if(text.length>2_000_000)throw new Error('PASSWORD_HTTP_RESPONSE_UNSUPPORTED');
      let parsed:Record<string,unknown>;
      try{parsed=JSON.parse(text);}catch{
        const challenge=inspectXianyuVerification({},text);if(challenge.required)throw new PasswordHttpVerificationRequired(challenge.verificationUrl);
        throw new Error('PASSWORD_HTTP_RESPONSE_UNSUPPORTED');
      }
      const challenge=inspectXianyuVerification(parsed);if(challenge.required)throw new PasswordHttpVerificationRequired(challenge.verificationUrl);
      if(!response.ok)throw new Error('PASSWORD_HTTP_RESPONSE_UNSUPPORTED');return parsed;
    };
    try {
      device=await this.options.deviceFactory?.open(input);
      const prepared=await device?.prepare();if(device)jar=await device.snapshot();if(prepared)userAgent=prepared.clientInfo.userAgent;
      if(!prepared){const home=await withNativeChallenge(()=>get(endpoints.home));await home.response.arrayBuffer();}
      // New bootstrap/CSRF for every actual password attempt; previously captured tokens are never replayed.
      const mini = new URL(endpoints.mini); mini.search = new URLSearchParams({lang:'zh_cn',appName:'xianyu',appEntrance:'web',styleType:'vertical',bizParams:'',notLoadSsoView:'false',notKeepLogin:'false',isMobile:'false',qrCodeFirst:'false',stie:'77',rnd:String(Math.random())}).toString();
      if(prepared)mini.href=prepared.miniUrl;
      const initialized=prepared?{response:new Response(prepared.html),url:mini.href}:await get(mini.href), html=await initialized.response.text();
      if(!html.includes('window.viewConfig')||!html.includes('window.viewData')){const challenge=inspectXianyuVerification({},html);if(challenge.required)throw new PasswordHttpVerificationRequired(challenge.verificationUrl);}
      if(!initialized.response.ok)throw new Error('PASSWORD_HTTP_RESPONSE_UNSUPPORTED');
      const config=loginJsonAssignment(html,'window.viewConfig'), data=loginJsonAssignment(html,'window.viewData'), form=loginFormFields(data.loginFormData);
      if (!form._csrf_token || !form.umidToken) throw new Error('PASSWORD_LOGIN_BOOTSTRAP_INVALID');
      const password2=encryptXianyuPassword(input.password,String(config.rsaModulus??''),String(config.rsaExponent??''));
      const cna=cookieValue(jar,'cna',endpoints.home), trace=/name=["']eagleeye-trace["'][^>]*content=["']([^"']+)/i.exec(html)?.[1]??'';
      const jsVersion=/havana-nlogin\/([0-9.]+)\//.exec(html)?.[1];
      if(!jsVersion)throw new Error('PASSWORD_LOGIN_BOOTSTRAP_VERSION_MISSING');
      const body = new URLSearchParams({loginId:input.account,password2,keepLogin:'false',isIframe:'true',documentReferer:endpoints.home,defaultView:'password',
        // These are the official bundle's explicit no-UA-SDK / server-UMID fallback values, not forged device signatures.
        ua:'',umidGetStatusVal:'',screenPixel:input.clientInfo?.screenPixel??'1440x900',navlanguage:input.clientInfo?.language??'zh-CN',navUserAgent:userAgent,navPlatform:input.clientInfo?.platform??xianyuNavigatorPlatform(),
        ...form,umidTag:'SERVER',weiBoMpBridge:'',jsVersion,deviceId:cna,pageTraceId:trace,
        ...(prepared?{...prepared.fields,navUserAgent:prepared.clientInfo.userAgent,navPlatform:prepared.clientInfo.platform,screenPixel:prepared.clientInfo.screenPixel,navlanguage:prepared.clientInfo.language}:{})});
      const loginApi=this.options.endpoints?endpoints.login:allowed(String(record(config.api).loginApi??''),endpoints.mini);
      if(new URL(loginApi).pathname!==new URL(endpoints.login).pathname)throw new Error('PASSWORD_LOGIN_BOOTSTRAP_INVALID');
      const authenticate=async():Promise<PasswordLoginResult>=>{
      const {payload,result}=await withNativeChallenge(async()=>{
        const response=await http(loginApi,{method:'POST',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded',origin:new URL(endpoints.mini).origin,referer:mini.href},body:body.toString()});
        const payload=await json(response),result=classifyPasswordLoginResponse(payload);
        if(result.kind==='verification_required'&&(!result.url||!isPasswordIvUrl(result.url)))throw new PasswordHttpVerificationRequired(result.url);
        return {payload,result};
      });
      if(result.kind==='verification_required'){
        if(result.url&&isPasswordIvUrl(result.url)){
          await completePasswordIv(result.url,{get:(url,referer)=>get(url,{referer:referer??mini.href}),
            json:async(url,referer)=>{const page=await get(url,{referer:referer??mini.href,'x-requested-with':'XMLHttpRequest',accept:'application/json, text/javascript, */*; q=0.01'});return json(page.response);},assertActive:input.assertActive,signal:input.signal,
            onStatus:async status=>{if(!input.onIvStatus)throw new PasswordHttpVerificationRequired(result.url);await input.onIvStatus(status);},pollIntervalMs:this.options.ivPollIntervalMs});
        }else throw new PasswordHttpVerificationRequired(result.url);
      }else if(result.kind!=='succeeded')throw new Error(result.code);
      const content=record(payload.content), login=record(content.data);
      if(login.conToken&&login.scene)throw new Error('PASSWORD_SESSION_EXCHANGE_UNSUPPORTED');
      for(const name of ['asyncUrls','miniLogouts','miniVsts'] as const) {
        const urls=login[name]; if(!Array.isArray(urls))continue;
        for(const value of urls.slice(0,20)) { if(typeof value!=='string')throw new Error('PASSWORD_LOGIN_RESPONSE_INVALID');await exchange(allowed(value,endpoints.mini)); }
      }
      if(login.replace)throw new Error('PASSWORD_SESSION_EXCHANGE_UNSUPPORTED');
      for(const name of ['redirectUrl','parentRedirectUrl'] as const)if(typeof login[name]==='string')await exchange(allowed(login[name] as string,endpoints.mini));
      const unb=cookieValue(jar,'unb',endpoints.home);
      if(!unb)throw new Error('PASSWORD_SESSION_COOKIE_MISSING');
      if(input.expectedUserId && input.expectedUserId!==unb)throw new Error('PASSWORD_ACCOUNT_MISMATCH');
      // Refresh the H5 signing token through MTOP itself and validate the authenticated identity.
      const mtop=async(api:string,requestData:string):Promise<Record<string,unknown>>=>withNativeChallenge(async()=>{
      const version='1.0';
      for(let attempt=0;attempt<3;attempt++) {
        const mtopUrl=`${endpoints.mtop}${api}/${version}/`;
        const timestamp=String(Date.now()), token=cookieValue(jar,'_m_h5_tk',mtopUrl).split('_')[0];
        const params=new URLSearchParams({jsv:'2.7.2',appKey:'34839810',t:timestamp,sign:createHash('md5').update(`${token}&${timestamp}&34839810&${requestData}`).digest('hex'),v:version,type:'originaljson',accountSite:'xianyu',dataType:'json',timeout:'20000',api,sessionOption:'AutoLoginOnly',needLogin:'false'});
        const check=await http(`${endpoints.mtop}${api}/${version}/?${params}`,{method:'POST',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded',origin:new URL(endpoints.home).origin,referer:endpoints.home},body:new URLSearchParams({data:requestData}).toString()});
        const checked=await json(check), ret=Array.isArray(checked.ret)?checked.ret.map(String):[];
        const classified=classifyPasswordLoginResponse(checked);
        if(classified.kind==='verification_required')throw new PasswordHttpVerificationRequired(classified.url);
        if(ret.length&&ret.every(r=>r.startsWith('SUCCESS::')))return record(checked.data);
        if(!ret.some(r=>/TOKEN.*EXPIRED|TOKEN.*EMPTY|TOKEN.*ILLEGAL/.test(r)))throw new Error('PASSWORD_SESSION_VERIFY_FAILED');
      }
      throw new Error('PASSWORD_SESSION_VERIFY_FAILED');
      });
      const identity=String((await mtop('mtop.taobao.idlemessage.pc.loginuser.get','{}')).userId??'');
      if(!identity || identity!==unb)throw new Error('PASSWORD_ACCOUNT_MISMATCH');
      const deviceId=input.imDeviceId??`xianyu-${input.profileKey}`;
      const im=await mtop('mtop.taobao.idlemessage.pc.login.token',JSON.stringify({appKey:'444e9908a51d1cb236a27862abc769c9',deviceId}));
      if(typeof im.accessToken!=='string'||!im.accessToken)throw new Error('PASSWORD_IM_TOKEN_MISSING');
      await input.assertActive();
      return { unb, cookieSnapshot:jar,profileKey:input.profileKey,usedPassword:true,deviceId,accessToken:im.accessToken,...(prepared?{clientInfo:prepared.clientInfo}:{}) };
      };
      return await authenticate();
    } catch(error) {
      if(input.signal.aborted)throw new Error('PASSWORD_LOGIN_CANCELLED');
      if(error instanceof PasswordHttpVerificationRequired)throw error;
      if(error instanceof Error && /^PASSWORD_[A-Z0-9_]+$/.test(error.message))throw error;
      throw new Error('PASSWORD_HTTP_FAILED');
    }finally{await device?.close();}
  }
}
function record(value: unknown): Record<string,unknown> {return value && typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
