import type { PasswordLoginInput } from './password-login-port.js';
import type { PasswordClientInfo } from './password-login-client.js';
import type { XianyuCookieSnapshot } from './xianyu-cookie-jar.js';

export interface PasswordDeviceRequest { url:string;method:string;body?:string;headers:Record<string,string> }
export interface PasswordDevice {
  prepare():Promise<{html:string;miniUrl:string;fields:Record<string,string>;clientInfo:PasswordClientInfo}>;
  sign(request:PasswordDeviceRequest):Promise<PasswordDeviceRequest>;
  absorbResponse(url:string,setCookies:string[]):Promise<void>;
  snapshot():Promise<XianyuCookieSnapshot>;
  close():Promise<void>;
}
export interface PasswordDeviceFactory { open(input:PasswordLoginInput):Promise<PasswordDevice>;forget?(profileKey:string):Promise<void> }
