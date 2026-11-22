import {readFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const MAX_BYTES=1_048_576;
export const XIANYU_SYSTEM_USER_IGNORED='XIANYU_SYSTEM_USER_IGNORED';
const templatePath=fileURLToPath(new URL('../config/xianyu-system-users.example.json',import.meta.url));
const defaultPath=fileURLToPath(new URL('../../../runtime-config/xianyu-system-users.json',import.meta.url));

/** Only a parsed platform identity is accepted; names, text and partial ID matches are not identities. */
export function normalizeXianyuSystemUserId(value:unknown):string|undefined{
  if(typeof value!=='string')return;
  const id=value.trim().replace(/@goofish$/iu,'');
  return /^[1-9]\d{0,31}$/.test(id)?id:undefined;
}

function parsePool(raw:string):Set<string>{
  if(Buffer.byteLength(raw)>MAX_BYTES)throw new Error('SYSTEM_USERS_CONFIG_TOO_LARGE');
  const value=JSON.parse(raw) as {version?:unknown;userIds?:unknown};
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||!Array.isArray(value.userIds)||value.userIds.length>10_000)throw new Error('SYSTEM_USERS_CONFIG_INVALID');
  const ids=new Set<string>();
  for(const valueId of value.userIds){const id=normalizeXianyuSystemUserId(valueId);if(!id)throw new Error('SYSTEM_USERS_CONFIG_INVALID_ID');ids.add(id);}
  return ids;
}

/** Each process reloads the same mounted directory on lookup. A new file replaces the set only after full validation. */
export class XianyuSystemUserPool{
  private ids=new Set<string>();
  private loaded=false;
  private attempted='';
  private lastError?:string;
  private sourcePath:string;
  constructor(readonly path:string,private readonly fallback?:string,private readonly report:(code:string)=>void=code=>console.warn(JSON.stringify({component:'xianyu-system-users',event:'config_load_failed',code}))){this.sourcePath=path;}
  private reload(){
    let path=this.path,key='unavailable';
    try{
      let info;
      try{info=statSync(path,{bigint:true});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'||!this.fallback||(this.loaded&&this.sourcePath===this.path))throw error;path=this.fallback;info=statSync(path,{bigint:true});}
      key=`${path}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
      if(key===this.attempted)return;
      this.attempted=key;
      if(!info.isFile()||info.size>BigInt(MAX_BYTES))throw new Error('SYSTEM_USERS_CONFIG_TOO_LARGE');
      const next=parsePool(readFileSync(path,'utf8'));
      const after=statSync(path,{bigint:true});
      if(after.ino!==info.ino||after.mtimeNs!==info.mtimeNs||after.ctimeNs!==info.ctimeNs||after.size!==info.size){throw new Error('SYSTEM_USERS_CONFIG_CHANGED_DURING_READ');}
      this.ids=next;this.loaded=true;this.sourcePath=path;this.lastError=undefined;
    }catch(error){
      const code=error instanceof Error&&/^SYSTEM_USERS_[A-Z_]+$/.test(error.message)?error.message:'SYSTEM_USERS_CONFIG_UNAVAILABLE';
      if(this.lastError!==code||this.attempted!==key)this.report(code);
      this.lastError=code;this.attempted=key;
    }
  }
  has(value:unknown):boolean{const id=normalizeXianyuSystemUserId(value);if(!id)return false;this.reload();return this.ids.has(id);}
  assertReady(){this.reload();if(!this.loaded)throw new Error('SYSTEM_USERS_CONFIG_UNAVAILABLE');}
  snapshot(){this.reload();return{path:this.path,sourcePath:this.sourcePath,userIds:[...this.ids].sort(),ready:this.loaded,lastError:this.lastError};}
}

let pool:XianyuSystemUserPool|undefined,pathKey='';
export function xianyuSystemUserPool():XianyuSystemUserPool{
  const configured=process.env.XIANYU_SYSTEM_USERS_FILE?.trim()||undefined,path=resolve(configured??defaultPath),key=`${configured===undefined?'default':'explicit'}:${path}`;
  if(!pool||key!==pathKey){pathKey=key;pool=new XianyuSystemUserPool(path,configured?undefined:templatePath);}
  return pool;
}
export function isXianyuSystemUser(value:unknown):boolean{return xianyuSystemUserPool().has(value);}
export function assertXianyuSystemUserPoolReady():void{xianyuSystemUserPool().assertReady();}
