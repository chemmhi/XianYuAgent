/** Only the observed passport password punish endpoint and existing MTOP punish paths can be framed. */
import {isNativeXianyuMtopChallenge} from './xianyu-challenge-presentation.js';
export function passwordVerificationUrl(value: string) {
  let url:URL;try{url=new URL(value);}catch{throw new Error('PASSWORD_VERIFICATION_UNSUPPORTED');}
  const password=url.hostname==='passport.goofish.com'&&/^\/+newlogin\/login\.do\/_____tmd_____\/punish\/?$/.test(url.pathname);
  const mtop=isNativeXianyuMtopChallenge(value);
  if(url.protocol!=='https:'||url.port||url.username||url.password||!(password||mtop)||!url.searchParams.has('x5secdata'))throw new Error('PASSWORD_VERIFICATION_UNSUPPORTED');
  if(url.searchParams.has('addCookieToHeader'))return value;
  const hashAt=value.indexOf('#'),base=hashAt<0?value:value.slice(0,hashAt),hash=hashAt<0?'':value.slice(hashAt);
  return `${base}${base.includes('?')?'&':'?'}addCookieToHeader=1${hash}`;
}
export function passwordVerificationPresentation(value:string):{url:string;origin:string;kind:'native'}{
  const url=passwordVerificationUrl(value);return {url,origin:new URL(url).origin,kind:'native'};
}
