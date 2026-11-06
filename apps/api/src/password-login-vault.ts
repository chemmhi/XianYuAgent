import { decryptCredentialValue, encryptCredentialValue } from './credential-crypto.js';
import type { PasswordLoginRepository, PasswordLoginSecret } from './password-login-repository.js';
import { passwordClientInfo, type PasswordClientInfo } from './password-login-client.js';
import {createHmac} from 'node:crypto';

export class PasswordLoginVault {
  constructor(readonly repository: PasswordLoginRepository, private readonly key: string) {}
  assertConfigured() { if (!this.key || this.key.length < 32 || /^(development-only-|replace-with-)/.test(this.key)) throw new Error('PASSWORD_ENCRYPTION_KEY_REQUIRED'); }
  loginDigest(adminId:string,account:string){this.assertConfigured();return createHmac('sha256',this.key).update(JSON.stringify(['password-device-alias-v1',adminId,account.trim()])).digest('hex');}
  initialDeviceKey(adminId:string,account:string){const hash=this.loginDigest(adminId,account);return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;}
  async save(input: { adminId: string; accountId: string; account: string; password: string; clientInfo?: PasswordClientInfo; profileKey: string; expectedVersion: number }) {
    this.assertConfigured();
    if (!input.account.trim() || !input.password) throw new Error('PASSWORD_LOGIN_INPUT_INVALID');
    const ciphertext = encryptCredentialValue(JSON.stringify({ adminId: input.adminId, accountId: input.accountId, account: input.account, password: input.password,clientInfo:input.clientInfo }), this.key);
    await this.repository.save({ adminId: input.adminId, accountId: input.accountId, ciphertext, profileKey: input.profileKey, expectedVersion: input.expectedVersion });
  }
  open(row: PasswordLoginSecret): { account: string; password: string; clientInfo?: PasswordClientInfo } {
    try {
      const value = JSON.parse(decryptCredentialValue(row.ciphertext, this.key));
      if (value.adminId !== row.adminId || value.accountId !== row.accountId || typeof value.account !== 'string' || typeof value.password !== 'string') throw new Error();
      return { account: value.account, password: value.password,...(value.clientInfo?{clientInfo:passwordClientInfo(value.clientInfo)}:{}) };
    } catch { throw new Error('PASSWORD_SECRET_INVALID'); }
  }
}
