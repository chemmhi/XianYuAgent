import { randomUUID } from 'node:crypto';
import type { AccountRecord, Store } from './domain.js';
import { AccountService, AuthService, CredentialService, ServiceError } from './services.js';
import type { PasswordLoginTransport } from './password-login-port.js';
import type { PasswordLoginSecret } from './password-login-repository.js';
import { PasswordLoginVault } from './password-login-vault.js';
import { cookieHeaderForUrl, metadataWithCookieSnapshot, cookieSnapshotFromMetadata } from './xianyu-cookie-jar.js';
import { PasswordHttpVerificationRequired } from './xianyu-password-http.js';
import { passwordClientInfo, type PasswordClientInfo, type PasswordHttpProof } from './password-login-client.js';
import { passwordVerificationPresentation } from './password-verification.js';
import { scopedVerificationCandidate } from './verification-native-candidate.js';
import type {PasswordIvStatus} from './xianyu-password-iv.js';

export type PasswordLoginStatus = 'logging_in' | 'verification_required' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
export interface PasswordLoginSession {
  id: string; status: PasswordLoginStatus; expiresAt: string; account?: AccountRecord;
  errorCode?: string; verificationPresentation?: 'http';
  verificationChallenge?: { id: string; url: string; origin: string;kind:'native' };
  verificationQr?:PasswordIvStatus;
  automatic?:boolean;
  accountDisplayName?:string;
  credentialsSaved?: boolean;
}
interface ActiveLogin {
  adminId: string; targetAccountId?: string; public: PasswordLoginSession; controller: AbortController;
  profileKey: string; generation?: number; hadManageScope: boolean; automatic?: PasswordLoginSecret;
  leaseAccountId?: string; leaseOwner: string; task?: Promise<void>; hadVerification: boolean;
  committing?: boolean;
  finished?: boolean;
  verificationReady:Promise<void>; resolveVerificationReady():void;
  presenter?:{id:string;expiresAt:number};
  httpChallenge?: { id: string; url: string;kind:'native'; resolve(proof: PasswordHttpProof): void; answered: boolean };
}
export interface PasswordLoginOptions {
  enabled: boolean; maxWaitMs?: number;
  hydrate(adminId: string, accountId: string, unb: string): Promise<void>;
  connected(adminId: string, accountId: string): Promise<void>;
}

export class PasswordLoginService {
  private readonly active = new Map<string, ActiveLogin>();
  private closed = false;
  private starting = 0;
  private startingAutomatic=0;
  constructor(readonly store: Store, private readonly auth: AuthService, private readonly accounts: AccountService,
    private readonly credentials: CredentialService, readonly vault: PasswordLoginVault, private readonly transport: PasswordLoginTransport,
    private readonly options: PasswordLoginOptions) {}

  async create(adminId: string, input: { account: string; password: string; accountId?: string; acceptTerms: boolean; clientInfo?: PasswordClientInfo }) {
    if (!input.acceptTerms) throw new ServiceError(422, 'PASSWORD_TERMS_REQUIRED', '请先阅读并同意闲鱼登录协议');
    if (!input.account?.trim() || input.account.length > 128 || !input.password || input.password.length > 512) throw new ServiceError(422, 'VALIDATION_FAILED', '请输入有效账号和密码');
    let clientInfo;try{clientInfo=passwordClientInfo(input.clientInfo);}catch{throw new ServiceError(422,'PASSWORD_CLIENT_INVALID','登录环境参数无效，请刷新后重试');}
    return this.begin(adminId, {...input,clientInfo});
  }
  async savedAvailable(adminId:string,accountId:string){
    await this.auth.assertActorAccess(adminId);const account=await this.accounts.getForLogin(adminId,accountId);
    if(account.status==='disabled'||!(await this.store.listScopes(adminId)).some(s=>s.accountId===accountId&&s.scope==='manage'))throw new ServiceError(403,'FORBIDDEN','账号已停用或管理权限已失效');
    return !!await this.vault.repository.get(adminId,accountId);
  }
  async retrySaved(adminId:string,accountId:string,presenterId?:string){
    await this.savedAvailable(adminId,accountId);const row=await this.vault.repository.get(adminId,accountId);
    if(!row)throw new ServiceError(404,'PASSWORD_SECRET_MISSING','该账号尚未保存账密');
    const session=await this.begin(adminId,{...this.vault.open(row),accountId},row,true);
    const entry=this.active.get(session.id);if(entry&&presenterId)entry.presenter={id:presenterId,expiresAt:Date.now()+30_000};
    return session;
  }
  private async begin(adminId: string, input: { account: string; password: string; accountId?: string; clientInfo?: PasswordClientInfo }, automatic?: PasswordLoginSecret,reactivateSaved=false) {
    if(automatic&&this.startingAutomatic+[...this.active.values()].filter(e=>!!e.automatic&&!e.finished&&!terminal(e.public.status)).length>=1)throw new ServiceError(429,'PASSWORD_LOGIN_BUSY','后台登录任务正在进行');
    if (this.starting + [...this.active.values()].filter(e => !e.finished && !terminal(e.public.status)).length >= 2) throw new ServiceError(429, 'PASSWORD_LOGIN_BUSY', '登录任务繁忙，请稍后重试');
    this.starting++;
    if(automatic)this.startingAutomatic++;
    try { return await this.beginReserved(adminId, input, automatic,reactivateSaved); } finally { this.starting--;if(automatic)this.startingAutomatic--; }
  }
  private async beginReserved(adminId: string, input: { account: string; password: string; accountId?: string; clientInfo?: PasswordClientInfo }, automatic?: PasswordLoginSecret,reactivateSaved=false) {
    if (this.closed || !this.options.enabled) throw new ServiceError(503, 'PASSWORD_LOGIN_UNAVAILABLE', '当前服务未启用闲鱼密码登录运行时');
    await this.auth.assertActorAccess(adminId);
    try { this.vault.assertConfigured(); } catch { throw new ServiceError(503, 'PASSWORD_ENCRYPTION_KEY_REQUIRED', '请先配置独立的凭证加密密钥'); }
    for (const [id, entry] of this.active) if (terminal(entry.public.status) && Date.parse(entry.public.expiresAt) < Date.now()) this.active.delete(id);
    if ([...this.active.values()].filter(e => !e.finished && !terminal(e.public.status)).length >= 2) throw new ServiceError(429, 'PASSWORD_LOGIN_BUSY', '登录任务繁忙，请稍后重试');
    const alias=await this.vault.repository.deviceAlias(adminId,this.vault.loginDigest(adminId,input.account));
    const targetId=input.accountId??alias?.accountId;
    const account = targetId ? await this.accounts.getForLogin(adminId, targetId) : undefined;
    if (account?.status === 'disabled') throw new ServiceError(403, 'FORBIDDEN', '账号已停用，请先启用账号');
    if (automatic && (!account || !await this.store.hasAccountScope(adminId, account.id))) throw new ServiceError(403, 'FORBIDDEN', '账号已停用或管理权限已失效');
    const hadManageScope = account ? (await this.store.listScopes(adminId)).some(s => s.accountId === account.id && s.scope === 'manage') : false;
    if (account && !hadManageScope) throw new ServiceError(403, 'FORBIDDEN', '该账号管理权限已失效');
    const id = randomUUID();
    if (account && !await this.vault.repository.claim(account.id, id, Date.now() + 360_000)) throw new ServiceError(409, 'PASSWORD_LOGIN_BUSY', '该账号正在登录');
    let login, previousDevice: PasswordLoginSecret | undefined;
    try {
      // Only an explicit user retry can re-enable a paused secret; the account lease is already held.
      if(reactivateSaved&&automatic){
        await this.vault.repository.save({adminId,accountId:automatic.accountId,ciphertext:automatic.ciphertext,profileKey:automatic.profileKey,expectedVersion:automatic.version});
        automatic=(await this.vault.repository.get(adminId,automatic.accountId))!;
      }
      // Resolve device persistence before creating a waiting session, while
      // initialization failures still release the account lease below.
      previousDevice = account ? await this.vault.repository.get(adminId, account.id) : undefined;
      // Direct persistence deliberately avoids AccountService.createLoginSession restoring scope before authentication.
      login = await this.store.createLoginSession({ adminId, accountId: account?.id, loginMethod: 'password', provisionalAccountRef: account ? undefined : `password_${id}`,
        expiresAt: new Date(Date.now() + (this.options.maxWaitMs ?? 600_000)).toISOString(), qrTokenRef: `password_ref_${id}` });
    } catch (error) { if (account) await this.vault.repository.release(account.id, id); throw error; }
    let resolveVerificationReady!:()=>void;const verificationReady=new Promise<void>(resolve=>{resolveVerificationReady=resolve;});
    const entry: ActiveLogin = { adminId, targetAccountId: account?.id, profileKey: automatic?.profileKey ?? previousDevice?.profileKey??alias?.profileKey??this.vault.initialDeviceKey(adminId,input.account),verificationReady,resolveVerificationReady,
      generation: account?.credentialGeneration ?? (account ? 1 : undefined),
      hadManageScope,
      automatic, controller: new AbortController(), hadVerification: false, leaseAccountId: account?.id, leaseOwner: id,
      public: { id: login.id, status: 'logging_in', expiresAt: login.expiresAt,...(automatic?{automatic:true,accountDisplayName:account?.displayName??account?.sellerRef}:{}) } };
    this.active.set(login.id, entry);
    entry.task = this.run(entry, input).catch(() => undefined);
    return structuredClone(entry.public);
  }
  async get(adminId: string, id: string,presenterId?:string): Promise<PasswordLoginSession> {
    await this.auth.assertActorAccess(adminId);
    const row = await this.accounts.getLoginSessionById({ adminId, sessionId: id });
    if (row.adminId !== adminId || row.loginMethod !== 'password') throw new ServiceError(404, 'NOT_FOUND', 'password login session not found');
    const entry = this.active.get(id);
    if (entry?.adminId === adminId) {
      if(entry.automatic&&entry.presenter&&!terminal(entry.public.status)){
        if(entry.presenter.id!==presenterId)throw new ServiceError(403,'PASSWORD_VERIFICATION_TAKEN_OVER','验证已在其他页面打开');
        entry.presenter.expiresAt=Date.now()+30_000;
      }
      if (entry.finished && entry.public.status === 'verification_required' && Date.parse(entry.public.expiresAt) <= Date.now()) {
        entry.public.status='expired'; entry.public.errorCode='PASSWORD_LOGIN_EXPIRED';
        await this.store.updateLoginSession(adminId,undefined,id,{status:'expired',failureCode:'PASSWORD_LOGIN_EXPIRED'});
      }
      return structuredClone(entry.public);
    }
    return { id, status: row.status === 'succeeded' ? 'succeeded' : terminal(row.status) ? row.status as PasswordLoginStatus : 'failed',
      expiresAt: row.expiresAt, errorCode: row.failureCode ?? (row.status === 'succeeded' ? undefined : 'PASSWORD_LOGIN_INTERRUPTED'),
      account: row.status === 'succeeded' && row.accountId ? await this.accounts.get(adminId, row.accountId) : undefined, credentialsSaved: row.status === 'succeeded' };
  }
  async cancel(adminId: string, id: string) {
    await this.get(adminId, id,this.active.get(id)?.presenter?.id); const entry = this.active.get(id);
    if (!entry || entry.adminId !== adminId || terminal(entry.public.status)) return;
    if (entry.committing) throw new ServiceError(409, 'PASSWORD_LOGIN_COMMITTING', '登录已验证，正在保存授权，请稍候');
    entry.public.status = 'cancelled'; entry.controller.abort();
    await this.store.updateLoginSession(adminId, undefined, id, { status: 'cancelled', completedAt: new Date().toISOString() });
  }
  async pending(adminId:string,presenterId?:string):Promise<PasswordLoginSession|null>{
    await this.auth.assertActorAccess(adminId);
    for(const entry of this.active.values()){
      if(entry.adminId!==adminId||!entry.automatic||entry.finished||entry.public.status!=='verification_required')continue;
      try{await this.assertActive(entry);}catch{entry.controller.abort();continue;}
      if(entry.finished||entry.public.status!=='verification_required')continue;
      if(presenterId){if(entry.presenter&&entry.presenter.id!==presenterId&&entry.presenter.expiresAt>Date.now())continue;entry.presenter={id:presenterId,expiresAt:Date.now()+30_000};}
      return structuredClone(entry.public);
    }
    return null;
  }
  private async verificationStarted(entry:ActiveLogin){
    if(entry.automatic&&!entry.hadVerification)await this.vault.repository.settle(entry.automatic,Date.parse(entry.public.expiresAt),'PASSWORD_SECURITY_VERIFICATION_REQUIRED');
    entry.hadVerification=true;
    await this.store.updateLoginSession(entry.adminId,undefined,entry.public.id,{status:'verification_required'});
    entry.resolveVerificationReady();
  }
  async submitVerification(adminId:string,id:string,challengeId:string,candidate:unknown,presenterId?:string){
    await this.get(adminId,id,presenterId);const entry=this.active.get(id),challenge=entry?.httpChallenge;
    if(!entry||entry.adminId!==adminId||!challenge||challenge.id!==challengeId||challenge.answered||entry.public.status!=='verification_required')throw new ServiceError(409,'PASSWORD_VERIFICATION_CHANGED','验证状态已变化，请重试');
    await this.assertActive(entry);
    let proof;try{proof=scopedVerificationCandidate(candidate,new URL(challenge.url).host,Date.now());}catch{throw new ServiceError(422,'PASSWORD_VERIFICATION_INVALID','验证结果无效，请重试');}
    if(entry.httpChallenge!==challenge||challenge.answered||entry.controller.signal.aborted)throw new ServiceError(409,'PASSWORD_VERIFICATION_CHANGED','验证状态已变化，请重试');
    if(entry.automatic&&entry.presenter&&(entry.presenter.id!==presenterId||entry.presenter.expiresAt<=Date.now()))throw new ServiceError(403,'PASSWORD_VERIFICATION_TAKEN_OVER','验证已在其他页面打开');
    challenge.answered=true;challenge.resolve({value:proof.value,host:proof.host,expiresAt:proof.expire});
  }
  private async waitForHttpVerification(entry:ActiveLogin,url:string):Promise<PasswordHttpProof>{
    await this.assertActive(entry);const presented=passwordVerificationPresentation(url),id=randomUUID();
    let resolve!:(proof:PasswordHttpProof)=>void,reject!:(reason:Error)=>void;
    const proof=new Promise<PasswordHttpProof>((done,fail)=>{resolve=done;reject=fail;});void proof.catch(()=>undefined);
    const abort=()=>reject(new Error('PASSWORD_LOGIN_CANCELLED'));entry.controller.signal.addEventListener('abort',abort,{once:true});
    if(entry.controller.signal.aborted)abort();
    entry.httpChallenge={id,url,kind:presented.kind,resolve,answered:false};
    delete entry.public.verificationQr;
    entry.public.status='verification_required';entry.public.verificationPresentation='http';entry.public.verificationChallenge={id,...presented};
    try{await this.verificationStarted(entry);
      entry.controller.signal.throwIfAborted();
      const result=await proof;await this.assertActive(entry);entry.public.status='logging_in';delete entry.public.verificationChallenge;
      await this.store.updateLoginSession(entry.adminId,undefined,entry.public.id,{status:'waiting'});return result;
    }finally{entry.controller.signal.removeEventListener('abort',abort);if(entry.httpChallenge?.id===id)entry.httpChallenge=undefined;}
  }
  private async assertActive(entry: ActiveLogin) {
    entry.controller.signal.throwIfAborted();
    if (this.closed || Date.parse(entry.public.expiresAt) <= Date.now()) throw new Error('PASSWORD_LOGIN_EXPIRED');
    await this.auth.assertActorAccess(entry.adminId);
    const row = await this.store.getLoginSessionById(entry.adminId, entry.public.id);
    if (!row || ['cancelled', 'failed', 'expired'].includes(row.status)) throw new Error('PASSWORD_LOGIN_CANCELLED');
    if (entry.targetAccountId) {
      const account = await this.store.getAccountForLogin(entry.adminId, entry.targetAccountId);
      if (!account || (account.credentialGeneration ?? 1) !== entry.generation) throw new Error('XIANYU_VERIFICATION_CREDENTIAL_CHANGED');
      if (account.status === 'disabled') throw new ServiceError(403, 'FORBIDDEN', '账号已停用');
      if (entry.hadManageScope && !(await this.store.listScopes(entry.adminId)).some(s => s.accountId === account.id && s.scope === 'manage')) throw new ServiceError(403, 'FORBIDDEN', '账号权限已变更');
      if (entry.automatic && !await this.store.hasAccountScope(entry.adminId, account.id)) throw new ServiceError(403, 'FORBIDDEN', '账号已停用');
    }
    if (entry.automatic) {
      const current = await this.vault.repository.get(entry.adminId, entry.automatic.accountId);
      if (!current?.enabled || current.version !== entry.automatic.version) throw new Error('PASSWORD_SECRET_CHANGED');
    }
    entry.controller.signal.throwIfAborted();
  }
  private async run(entry: ActiveLogin, input: { account: string; password: string; clientInfo?: PasswordClientInfo }) {
    const { id } = entry.public;
    let leaseLost = false, savedSecret: PasswordLoginSecret | undefined;
    const timeout = setTimeout(() => entry.controller.abort(), Math.max(1, Date.parse(entry.public.expiresAt) - Date.now()));
    const heartbeat = setInterval(() => {
      if (entry.leaseAccountId) void this.vault.repository.renew(entry.leaseAccountId, entry.leaseOwner, Date.now() + 360_000)
        .then(ok => { if (!ok) { leaseLost = true; entry.controller.abort(); } }).catch(() => { leaseLost = true; entry.controller.abort(); });
    }, 15_000);
    try {
      await this.store.updateLoginSession(entry.adminId, undefined, id, { status: 'waiting' });
      const result = await this.transport.run({ ...input, profileKey: entry.profileKey,
        initialCookieSnapshot:entry.targetAccountId?cookieSnapshotFromMetadata((await this.store.getCredential(entry.adminId,entry.targetAccountId))?.metadata):undefined,
        imDeviceId:entry.targetAccountId?(await this.store.getCredential(entry.adminId,entry.targetAccountId))?.deviceId:undefined,
        onHttpVerification:url=>this.waitForHttpVerification(entry,url),
        onIvStatus:async status=>{
          await this.assertActive(entry);
          entry.public.status='verification_required';entry.public.verificationPresentation='http';entry.public.verificationQr={...status,expiresAt:new Date(Math.min(Date.parse(status.expiresAt),Date.parse(entry.public.expiresAt))).toISOString()};delete entry.public.verificationChallenge;
          await this.verificationStarted(entry);
        },
        expectedUserId: entry.targetAccountId ? knownIdentity((await this.accounts.getForLogin(entry.adminId, entry.targetAccountId)).sellerRef) : undefined,
        signal: entry.controller.signal, assertActive: () => this.assertActive(entry) });
      await this.assertActive(entry);
      if (!entry.automatic && !result.usedPassword) throw new Error('PASSWORD_NOT_VERIFIED');
      if (entry.targetAccountId) {
        const expected = knownIdentity((await this.accounts.getForLogin(entry.adminId, entry.targetAccountId)).sellerRef);
        if (expected && expected !== result.unb) throw new Error('PASSWORD_ACCOUNT_MISMATCH');
      }
      entry.controller.signal.throwIfAborted();
      entry.committing = true;
      if (!entry.targetAccountId && !entry.automatic) {
        const existing = await this.store.findAccountForLogin({ adminId: entry.adminId, platform: 'xianyu', sellerRef: result.unb });
        if (existing) {
          const manage = (await this.store.listScopes(entry.adminId)).some(s => s.accountId === existing.id && s.scope === 'manage');
          if (!manage || existing.status === 'disabled') throw new ServiceError(403, 'FORBIDDEN', '账号已停用或管理权限已失效');
          entry.targetAccountId = existing.id; entry.generation = existing.credentialGeneration ?? 1; entry.hadManageScope = true;
          if (!await this.vault.repository.claim(existing.id, entry.leaseOwner, Date.now() + 360_000)) throw new Error('PASSWORD_LOGIN_BUSY');
          entry.leaseAccountId = existing.id;
        }
      }
      const account = entry.automatic ? await this.accounts.get(entry.adminId, entry.targetAccountId!)
        : await this.accounts.resolveForLogin({ adminId: entry.adminId, accountId: entry.targetAccountId, platform: 'xianyu', sellerRef: result.unb, requestId: id, traceId: id,
          restoreGuard: entry.targetAccountId ? { generation: entry.generation!, allowDisabled: false, requireManage: true } : undefined });
      if (!entry.leaseAccountId) {
        if (!await this.vault.repository.claim(account.id, entry.leaseOwner, Date.now() + 360_000)) throw new Error('PASSWORD_LOGIN_BUSY');
        entry.leaseAccountId = account.id;
      }
      const before = await this.vault.repository.get(entry.adminId, account.id);
      const saved = await this.credentials.save({ adminId: entry.adminId, accountId: account.id,
        expectedGeneration: entry.generation ?? account.credentialGeneration ?? 1,
        cookieHeader: cookieHeaderForUrl(result.cookieSnapshot, 'https://www.goofish.com/'),
        accessToken:result.accessToken,deviceId:result.deviceId,
        metadata: metadataWithCookieSnapshot({ unb: result.unb, loginMethod: 'password_http',...((result.clientInfo??input.clientInfo)?{loginUserAgent:(result.clientInfo??input.clientInfo)!.userAgent}:{}) }, result.cookieSnapshot),
        clearAccessToken: true, clearExpiresAt: true, requestId: id, traceId: id });
      entry.controller.signal.throwIfAborted();
      await this.credentials.verify({ adminId: entry.adminId, accountId: account.id, status: 'active', expected: saved, requestId: id, traceId: id });
      if (!entry.automatic) {
        try { await this.vault.save({ adminId: entry.adminId, accountId: account.id, account:input.account,password:input.password,clientInfo:result.clientInfo??input.clientInfo, profileKey: result.profileKey, expectedVersion: before?.version ?? 0 }); }
        catch { entry.public.credentialsSaved = false; throw new Error('PASSWORD_SECRET_SAVE_FAILED'); }
        savedSecret = await this.vault.repository.get(entry.adminId, account.id);
      }
      await this.vault.repository.bindDeviceAlias(entry.adminId,this.vault.loginDigest(entry.adminId,input.account),account.id,result.profileKey);
      await this.options.hydrate(entry.adminId, account.id, result.unb).catch(() => undefined);
      entry.controller.signal.throwIfAborted();
      await this.auth.assertActorAccess(entry.adminId);
      if (!await this.vault.repository.renew(account.id, entry.leaseOwner, Date.now() + 360_000)) throw new Error('PASSWORD_LOGIN_LEASE_LOST');
      entry.controller.signal.throwIfAborted();
      if (!await this.store.completePasswordLogin({ adminId: entry.adminId, accountId: account.id, sessionId: id, generation: saved.generation ?? 1, leaseOwner: entry.leaseOwner })) throw new Error('PASSWORD_LOGIN_COMMIT_REJECTED');
      entry.public = { ...entry.public, status: 'succeeded', account: await this.accounts.get(entry.adminId, account.id), credentialsSaved: true };
      void this.options.connected(entry.adminId, account.id).catch(() => undefined);
      if (entry.automatic) await this.vault.repository.settle(entry.automatic, Date.now() + 90_000);
    } catch (error) {
      if (error instanceof PasswordHttpVerificationRequired) {
        // The transport has exited, so there is no live QR/proof continuation to present.
        // A waiting status here would strand the user in a dialog with no actionable content.
        entry.hadVerification=true;
        error=new Error('PASSWORD_VERIFICATION_UNAVAILABLE');
      }
      const code = leaseLost ? 'PASSWORD_LOGIN_LEASE_LOST' : passwordErrorCode(error, entry);
      if (entry.public.status !== 'succeeded') {
        entry.public.status = entry.public.status === 'cancelled' ? 'cancelled' : code === 'PASSWORD_LOGIN_EXPIRED' ? 'expired' : 'failed';
        entry.public.errorCode = code;
        delete entry.public.verificationChallenge; delete entry.public.verificationQr; delete entry.public.verificationPresentation;
        await this.store.updateLoginSession(entry.adminId, undefined, id, { status: entry.public.status, failureCode: code, completedAt: new Date().toISOString() }).catch(() => undefined);
        if (savedSecret) await this.vault.repository.settle(savedSecret, Date.now() + 60_000, code, true).catch(() => undefined);
        if (entry.automatic) {
          const disable = entry.hadVerification || ['PASSWORD_REJECTED', 'PASSWORD_SECRET_INVALID', 'FORBIDDEN', 'PASSWORD_ACCOUNT_MISMATCH'].includes(code);
          await this.vault.repository.settle(entry.automatic, Date.now() + Math.min(1_800_000, 60_000 * 2 ** Math.min(5, entry.automatic.attempts)), code, disable).catch(() => undefined);
        }
      }
    } finally {
      entry.finished=true;
      clearTimeout(timeout); clearInterval(heartbeat);
      if (entry.leaseAccountId) await this.vault.repository.release(entry.leaseAccountId, entry.leaseOwner).catch(() => undefined);
    }
  }
  async recover(row: PasswordLoginSecret) {
    const input = this.vault.open(row);
    const session = await this.begin(row.adminId, { ...input, accountId: row.accountId }, row);
    const entry=this.active.get(session.id);if(entry)await Promise.race([entry.task,entry.verificationReady]);
  }
  async forgetAccount(accountId: string) {
    const profiles=await this.vault.repository.profiles(accountId);
    const jobs = [...this.active.values()].filter(entry => entry.targetAccountId === accountId || entry.leaseAccountId === accountId || entry.public.account?.id === accountId);
    for (const entry of jobs){entry.controller.abort();profiles.push(entry.profileKey);}
    await Promise.allSettled(jobs.map(entry => entry.task));
    await this.vault.repository.removeAccount(accountId);
    for(const profile of new Set(profiles))await this.transport.forgetDevice?.(profile);
  }
  async close() {
    this.closed = true;
    for (const entry of this.active.values()) if (!terminal(entry.public.status)) entry.controller.abort();
    await Promise.allSettled([...this.active.values()].map(e => e.task));
  }
}
function terminal(status: string) { return ['succeeded', 'failed', 'cancelled', 'expired'].includes(status); }
function knownIdentity(value?: string) { return value && !value.startsWith('pending_') ? value : undefined; }
function passwordErrorCode(error: unknown, entry: ActiveLogin) {
  if (Date.parse(entry.public.expiresAt) <= Date.now()) return 'PASSWORD_LOGIN_EXPIRED';
  if (error instanceof ServiceError) return error.code;
  const message = error instanceof Error ? error.message : '';
  return /^(?:PASSWORD_|XIANYU_VERIFICATION_CREDENTIAL_CHANGED|ACCOUNT_SCOPE_FORBIDDEN|LOGIN_ACCOUNT_BUSY)[A-Z0-9_]*$/.test(message) ? message : 'PASSWORD_LOGIN_FAILED';
}
