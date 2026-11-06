import {mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {BrowserContext,Page,Route} from 'patchright';
import type {PasswordDevice,PasswordDeviceFactory,PasswordDeviceRequest} from './password-device-port.js';
import type {PasswordLoginInput} from './password-login-port.js';
import {createPatchrightVerificationBrowserFactory} from './patchright-verification-browser.js';
import {acquireXianyuVerificationProfileLock} from './xianyu-verification-profile-lock.js';
import {resolveDefaultVerificationUserDataDir} from './xianyu-verification-browser.js';
import {officialDeviceCookies,writeDeviceCookies,absorbDeviceCookies} from './password-device-cookies.js';

interface Options {root?:string;executablePath?:string;timeoutMs?:number;fixture?:{home:string;mini:string;login:string}}
const HOME='https://www.goofish.com/';
const MINI='https://passport.goofish.com/mini_login.htm?lang=zh_cn&appName=xianyu&appEntrance=web&styleType=vertical&bizParams=&notLoadSsoView=false&notKeepLogin=false&isMobile=false&qrCodeFirst=false&stie=77';

/** Runs only official device SDKs in a persistent, invisible context. Authentication itself stays on Node HTTP. */
export class OfficialPasswordDeviceFactory implements PasswordDeviceFactory{
  constructor(private readonly options:Options={}){}
  async forget(profileKey:string){
    if(!/^[0-9a-f-]{36}$/i.test(profileKey))throw new Error('PASSWORD_DEVICE_PROFILE_INVALID');
    const directory=join(this.options.root??resolveDefaultVerificationUserDataDir(),'password-device',profileKey);
    await mkdir(directory,{recursive:true,mode:0o700});const release=await acquireXianyuVerificationProfileLock(directory,15_000);
    try{await rm(directory,{recursive:true,force:true});}finally{await release();}
  }
  async open(input:PasswordLoginInput):Promise<PasswordDevice>{
    if(!/^[0-9a-f-]{36}$/i.test(input.profileKey))throw new Error('PASSWORD_DEVICE_PROFILE_INVALID');
    const directory=join(this.options.root??resolveDefaultVerificationUserDataDir(),'password-device',input.profileKey);
    await mkdir(directory,{recursive:true,mode:0o700});
    const release=await acquireXianyuVerificationProfileLock(directory,15_000);
    let context:BrowserContext|undefined,closed=false;
    const close=async()=>{if(closed)return;closed=true;try{await context?.close();}finally{await release();}};
    const aborted=()=>{void close().catch(()=>undefined);};
    try{
      await input.assertActive();input.signal.throwIfAborted();
      context=await createPatchrightVerificationBrowserFactory().launchPersistentContext({profileDir:directory,headless:true,hideWindow:true,serviceWorkers:'block',executablePath:this.options.executablePath}) as unknown as BrowserContext;
      input.signal.addEventListener('abort',aborted,{once:true});input.signal.throwIfAborted();
      const owner=context;
      await owner.routeWebSocket('**/*',socket=>{socket.close();});
      const retained=officialDeviceCookies(await owner.cookies());
      // A cancelled/failed attempt can still refresh device trust. Do not roll those cookies back to an older DB snapshot.
      await writeDeviceCookies(owner,(input.initialCookieSnapshot??[]).filter(cookie=>!['cna','isg','tfstk','_uab_collina'].includes(cookie.name)||!retained.some(current=>current.name===cookie.name)));
      await owner.clearPermissions();
      let page=await owner.newPage();const homePage=page,timeout=this.options.timeoutMs??35_000;
      const blocked=new Set<string>();
      await installCapture(owner,page);
      let pending:{request:PasswordDeviceRequest;page:Page;nonce:string;requiresSignature:boolean;resolve(value:PasswordDeviceRequest):void;reject(error:Error):void}|undefined;
      // Browser auth requests are never sent; install before loading any official document.
      await owner.route('**/*',async(route:Route)=>{
        const request=route.request(),url=new URL(request.url()),active=pending,requestHeaders=await request.allHeaders();
        const expected=active&&new URL(active.request.url),same=expected&&url.origin===expected.origin&&url.pathname===expected.pathname&&request.method()===active.request.method&&[...expected.searchParams].every(([key,value])=>url.searchParams.getAll(key).includes(value));
        if(same&&request.frame()===active!.page.mainFrame()&&requestHeaders['x-xianyu-device-capture']===active!.nonce&&(['xhr','fetch'].includes(request.resourceType()))){
          const body=request.postData()??undefined;
          if(active!.request.body&&!body?.startsWith(active!.request.body)){await route.abort();active!.reject(new Error('PASSWORD_DEVICE_REQUEST_CHANGED'));return;}
          const parameters=request.method()==='POST'?new URLSearchParams(body):url.searchParams;
          const required=!active!.requiresSignature?[]:this.options.fixture?['bx-ua']:['bx-ua','bx-umidtoken','bx_et','x-pipu2'];
          const missing=required.filter(key=>!parameters.get(key)||/^(?:default|fast-load)/i.test(parameters.get(key)!));
          if(missing.length){await route.abort();pending=undefined;active!.reject(new Error('PASSWORD_DEVICE_SIGNATURE_MISSING',{cause:{path:url.pathname,missing}}));return;}
          const headers=requestHeaders,out:Record<string,string>={};
          for(const [key,value]of Object.entries(headers))if(/^(?:accept|content-type|origin|referer|sec-ch-ua(?:-mobile|-platform)?|bx-[a-z-]+|x-pipu2)$/.test(key))out[key]=value;
          await route.fulfill({status:200,contentType:'application/json',body:'{}'});
          pending=undefined;active!.resolve({url:request.url(),method:request.method(),body,headers:{...active!.request.headers,...out}});return;
        }
        // Never let the SDK/browser submit authentication, MTOP, or a late signing request itself.
        const fixture=this.options.fixture,fixtureOrigin=fixture&&new URL(fixture.home).origin;
        const business=/(^|\.)goofish\.com$/.test(url.hostname)||url.origin===fixtureOrigin;
        const publicDocument=request.method()==='GET'&&request.resourceType()==='document'&&(url.href===(fixture?.home??HOME)||url.href===(fixture?.mini??MINI));
        const staticAsset=request.method()==='GET'&&!/^\/(?:newlogin|iv|h5|login_token|auth|api)(?:\/|$)/.test(url.pathname)&&['script','stylesheet','image','font'].includes(request.resourceType())&&/\.(?:js|css|png|jpg|webp|svg|woff2?|ico)$/.test(url.pathname);
        const sdkDomain=/(^|\.)(?:alicdn\.com|mmstat\.com|aliyun\.com|aliyuncs\.com)$/.test(url.hostname)||['ynuf.aliapp.org','fxnnqu.tdum.alibaba.com'].includes(url.hostname);
        if(requestHeaders['x-xianyu-device-capture']||request.resourceType()==='serviceworker'||business&&!publicDocument&&!staticAsset||!business&&!sdkDomain){blocked.add(url.origin+url.pathname);await route.abort();return;}
        await route.fallback();
      });
      const home=this.options.fixture?.home??HOME,miniUrl=this.options.fixture?.mini??MINI;
      await homePage.goto(home,{waitUntil:'domcontentloaded',timeout});
      page=await owner.newPage();await installCapture(owner,page);
      await page.goto(miniUrl,{waitUntil:'domcontentloaded',timeout});
      // Patchright defaults to an isolated world; official SDK objects live in the document's main world.
      const read=()=>page.evaluate(deviceState,undefined,undefined,false);
      const deadline=Date.now()+timeout;let state=await read();
      while((!state.ready||!state.fields.deviceId||!state.fields.ua)&&Date.now()<deadline){await input.assertActive();input.signal.throwIfAborted();await page.waitForTimeout(200);state=await read();}
      if(!state.ready||!state.fields.ua||!state.fields.deviceId)throw new Error('PASSWORD_DEVICE_SDK_NOT_READY',{cause:{ready:state.ready,fieldLengths:Object.fromEntries(Object.entries(state.fields).map(([key,value])=>[key,value.length])),blocked:[...blocked]}});
      const html=await page.content();
      return {
        prepare:async()=>({html,miniUrl,fields:state.fields,clientInfo:state.clientInfo}),
        snapshot:async()=>officialDeviceCookies(await owner.cookies()),
        absorbResponse:(url,cookies)=>absorbDeviceCookies(owner,url,cookies),
        sign:async request=>{
          await input.assertActive();input.signal.throwIfAborted();if(closed)throw new Error('PASSWORD_DEVICE_CLOSED');if(pending)throw new Error('PASSWORD_DEVICE_BUSY');
          const target=new URL(request.url);if(!this.options.fixture&&(!/(^|\.)goofish\.com$/.test(target.hostname)||target.protocol!=='https:'||target.port||target.username||target.password))throw new Error('PASSWORD_DEVICE_REQUEST_ORIGIN');
          if(target.pathname==='/newlogin/login.do'&&request.body){
            const current=await page.evaluate(deviceState,undefined,undefined,false),body=new URLSearchParams(request.body);
            if(!current.ready||!current.fields.ua||!current.fields.deviceId)throw new Error('PASSWORD_DEVICE_SDK_NOT_READY');
            for(const[key,value]of Object.entries(current.fields))body.set(key,value);
            request={...request,body:body.toString()};
          }
          const signingPage=request.headers.origin===new URL(home).origin&&target.hostname!=='passport.goofish.com'?homePage:page;
          if(signingPage===homePage&&!this.options.fixture){const readyUntil=Date.now()+timeout;while(!await homePage.evaluate(()=>!!(window as any).__baxia__?.getFYModule?.fyObj,undefined,undefined,false)){if(Date.now()>readyUntil)throw new Error('PASSWORD_DEVICE_SDK_NOT_READY');await input.assertActive();input.signal.throwIfAborted();await homePage.waitForTimeout(100);}}
          let timer:ReturnType<typeof setTimeout>;
          const nonce=randomUUID();
          const requiresSignature=this.options.fixture||target.pathname==='/newlogin/login.do'?true:await signingPage.evaluate(url=>{const configured=(window as any).__baxia__?.options?.checkApiPath;return Array.isArray(configured)?configured.some(check=>check(url)):typeof configured==='function'&&configured(url);},request.url,undefined,false);
          const result=new Promise<PasswordDeviceRequest>((resolve,reject)=>{pending={request,page:signingPage,nonce,requiresSignature,resolve,reject};timer=setTimeout(()=>{pending=undefined;void close().catch(()=>undefined);reject(new Error('PASSWORD_DEVICE_SIGNATURE_TIMEOUT'));},timeout);});
          const send=signingPage.evaluate(async(value)=>{await new Promise<void>(resolve=>{const xhr=new XMLHttpRequest();(window as unknown as {__xianyuDeviceCapture(xhr:XMLHttpRequest,nonce:string):void}).__xianyuDeviceCapture(xhr,value.nonce);xhr.open(value.request.method,value.request.url);xhr.withCredentials=true;for(const [name,content]of Object.entries(value.request.headers))if(['accept','content-type','x-requested-with'].includes(name.toLowerCase()))xhr.setRequestHeader(name,content);xhr.onload=()=>resolve();xhr.onerror=()=>resolve();xhr.send(value.request.body??null);});},{request,nonce},undefined,false).catch(error=>{pending?.reject(new Error('PASSWORD_DEVICE_CONTEXT_FAILED',{cause:error}));});
          try{const signed=await result;await send;await input.assertActive();return signed;}finally{clearTimeout(timer!);pending=undefined;}
        },
        close:async()=>{input.signal.removeEventListener('abort',aborted);await close();},
      };
    }catch(error){input.signal.removeEventListener('abort',aborted);await close().catch(()=>undefined);if(error instanceof Error&&/^PASSWORD_/.test(error.message))throw error;throw new Error('PASSWORD_DEVICE_INIT_FAILED');}
  }
}

async function installCapture(context:BrowserContext,page:Page){
  const session=await context.newCDPSession(page);await session.send('Page.enable');
  // Installed in the main world before vendor code wraps XHR; this bottom layer tags only our marked request after signing.
  await session.send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    const send=XMLHttpRequest.prototype.send,set=XMLHttpRequest.prototype.setRequestHeader,marked=new WeakMap();
    Object.defineProperty(window,'__xianyuDeviceCapture',{value:(xhr,nonce)=>marked.set(xhr,nonce)});
    XMLHttpRequest.prototype.send=function(body){const nonce=marked.get(this);if(nonce){marked.delete(this);set.call(this,'x-xianyu-device-capture',nonce);}return send.call(this,body);};
  })();`});
}

function deviceState(){
  const w=window as unknown as Record<string,any>,form=w.viewData?.loginFormData??{},token=w.umidToken||w.viewData?.umidToken||form.umidToken||'';
  let deviceId='';try{deviceId=(localStorage.getItem('APLUS_CNA')??'').split('_')[1]??'';}catch{/* Official storage can be disabled. */}
  const ua=w.UA_Opt&&w[w.UA_Opt.LogVal]||'';
  return {ready:!!w.viewConfig&&!!w.__baxia__?.getFYModule?.fyObj&&!!w.__baxia__?.etModule&&Number(w.um?.getStatus?.(true))>200,
    fields:{ua:String(ua),umidToken:String(token),umidTag:w.umidToken?'WEB':'SERVER',umidGetStatusVal:String(w.um?.getStatus?.(true)??''),deviceId,pageTraceId:document.querySelector('meta[name="eagleeye-trace"]')?.getAttribute('content')??''},
    clientInfo:{userAgent:navigator.userAgent,platform:navigator.platform,language:navigator.language,screenPixel:`${screen.width}x${screen.height}`}};
}
