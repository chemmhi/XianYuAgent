export interface PasswordClientInfo { userAgent: string; platform: string; language: string; screenPixel: string }
export interface PasswordHttpProof { value: string; host: string; expiresAt?: number }
export function passwordClientInfo(value: unknown): PasswordClientInfo | undefined {
  if(value===undefined)return;
  if(!value||typeof value!=='object')throw new Error('PASSWORD_CLIENT_INVALID');
  const v=value as Record<string,unknown>;
  if(typeof v.userAgent!=='string'||!v.userAgent||v.userAgent.length>512||/[\r\n]/.test(v.userAgent)
    ||typeof v.platform!=='string'||v.platform.length>64||typeof v.language!=='string'||v.language.length>32
    ||typeof v.screenPixel!=='string'||!/^\d{1,5}x\d{1,5}$/.test(v.screenPixel))throw new Error('PASSWORD_CLIENT_INVALID');
  return {userAgent:v.userAgent,platform:v.platform,language:v.language,screenPixel:v.screenPixel};
}
