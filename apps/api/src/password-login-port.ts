import type { XianyuCookieSnapshot } from './xianyu-cookie-jar.js';
import type { PasswordClientInfo, PasswordHttpProof } from './password-login-client.js';
import type { PasswordIvStatus } from './xianyu-password-iv.js';

export interface PasswordLoginInput {
  account: string;
  password: string;
  /** Stable opaque login context identifier, also used to derive a new IM device ID. */
  profileKey: string;
  expectedUserId?: string;
  signal: AbortSignal;
  assertActive(): Promise<void>;
  clientInfo?: PasswordClientInfo;
  initialCookieSnapshot?: XianyuCookieSnapshot;
  imDeviceId?: string;
  onHttpVerification?(url: string): Promise<PasswordHttpProof>;
  onIvStatus?(status: PasswordIvStatus): Promise<void>;
}

export interface PasswordLoginResult {
  unb: string;
  cookieSnapshot: XianyuCookieSnapshot;
  profileKey: string;
  usedPassword: boolean;
  accessToken?: string;
  deviceId?: string;
  clientInfo?:PasswordClientInfo;
}

export interface PasswordLoginTransport {
  run(input: PasswordLoginInput): Promise<PasswordLoginResult>;
  forgetDevice?(profileKey:string):Promise<void>;
}
