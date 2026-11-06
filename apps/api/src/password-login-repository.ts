export interface PasswordLoginSecret {
  adminId: string; accountId: string; ciphertext: string; profileKey: string;
  version: number; enabled: boolean; attempts: number; nextAttemptAt: number; failureCode?: string;
}
export interface PasswordLoginRepository {
  get(adminId: string, accountId: string): Promise<PasswordLoginSecret | undefined>;
  save(input: Pick<PasswordLoginSecret, 'adminId' | 'accountId' | 'ciphertext' | 'profileKey'> & { expectedVersion: number }): Promise<void>;
  due(now: number, limit: number): Promise<PasswordLoginSecret[]>;
  settle(row: PasswordLoginSecret, nextAttemptAt: number, failureCode?: string, disable?: boolean): Promise<void>;
  claim(accountId: string, owner: string, until: number): Promise<boolean>;
  renew(accountId: string, owner: string, until: number): Promise<boolean>;
  release(accountId: string, owner: string): Promise<void>;
  removeAccount(accountId: string): Promise<void>;
  profiles(accountId: string): Promise<string[]>;
  deviceAlias(adminId:string,loginDigest:string):Promise<{accountId:string;profileKey:string}|undefined>;
  bindDeviceAlias(adminId:string,loginDigest:string,accountId:string,profileKey:string):Promise<void>;
}

export class MemoryPasswordLoginRepository implements PasswordLoginRepository {
  private readonly rows = new Map<string, PasswordLoginSecret>();
  private readonly leases = new Map<string, { owner: string; until: number }>();
  private readonly aliases=new Map<string,{accountId:string;profileKey:string}>();
  private readonly deviceProfiles=new Map<string,Set<string>>();
  private key(adminId: string, accountId: string) { return JSON.stringify([adminId, accountId]); }
  async get(adminId: string, accountId: string) { return structuredClone(this.rows.get(this.key(adminId, accountId))); }
  async save(input: Pick<PasswordLoginSecret, 'adminId' | 'accountId' | 'ciphertext' | 'profileKey'> & { expectedVersion: number }) {
    const key = this.key(input.adminId, input.accountId), current = this.rows.get(key);
    if ((current?.version ?? 0) !== input.expectedVersion) throw new Error('PASSWORD_SECRET_CHANGED');
    this.rows.set(key, { ...input, version: input.expectedVersion + 1, enabled: true, attempts: 0, nextAttemptAt: Date.now() + 30_000 });
  }
  async due(now: number, limit: number) { return [...this.rows.values()].filter(r => r.enabled && r.nextAttemptAt <= now).slice(0, limit).map(r => structuredClone(r)); }
  async settle(row: PasswordLoginSecret, nextAttemptAt: number, failureCode?: string, disable = false) {
    const current = this.rows.get(this.key(row.adminId, row.accountId));
    if (current?.version !== row.version) return;
    Object.assign(current, { nextAttemptAt, failureCode, enabled: current.enabled && !disable, attempts: failureCode ? current.attempts + 1 : 0 });
  }
  async claim(accountId: string, owner: string, until: number) {
    const current = this.leases.get(accountId);
    if (current && current.until > Date.now() && current.owner !== owner) return false;
    this.leases.set(accountId, { owner, until }); return true;
  }
  async renew(accountId: string, owner: string, until: number) {
    const current = this.leases.get(accountId);
    if (!current || current.owner !== owner || current.until <= Date.now()) return false;
    current.until = until; return true;
  }
  async release(accountId: string, owner: string) { if (this.leases.get(accountId)?.owner === owner) this.leases.delete(accountId); }
  async removeAccount(accountId: string) {
    for (const [key, row] of this.rows) if (row.accountId === accountId) this.rows.delete(key);
    this.leases.delete(accountId);
    this.deviceProfiles.delete(accountId);
    for(const[key,row]of this.aliases)if(row.accountId===accountId)this.aliases.delete(key);
  }
  async deviceAlias(adminId:string,loginDigest:string){return structuredClone(this.aliases.get(this.key(adminId,loginDigest)));}
  async bindDeviceAlias(adminId:string,loginDigest:string,accountId:string,profileKey:string){const profiles=this.deviceProfiles.get(accountId)??new Set<string>();profiles.add(profileKey);this.deviceProfiles.set(accountId,profiles);for(const[key,row]of this.aliases)if(JSON.parse(key)[0]===adminId&&row.accountId===accountId)row.profileKey=profileKey;this.aliases.set(this.key(adminId,loginDigest),{accountId,profileKey});}
  async profiles(accountId: string) { return [...new Set([...(this.deviceProfiles.get(accountId)??[]),...[...this.rows.values(),...this.aliases.values()].filter(r => r.accountId === accountId).map(r => r.profileKey)])]; }
}
