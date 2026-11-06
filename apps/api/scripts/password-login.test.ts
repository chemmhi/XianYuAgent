import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from '../src/store-memory.js';
import { AccountService, AuthService, CredentialService } from '../src/services.js';
import { loadConfig } from '../src/config.js';
import { MemoryPasswordLoginRepository } from '../src/password-login-repository.js';
import { PasswordLoginVault } from '../src/password-login-vault.js';
import { PasswordLoginService, type PasswordLoginOptions } from '../src/password-login.js';
import { PasswordReloginWorker } from '../src/password-relogin-worker.js';
import { classifyPasswordLoginResponse, safeChallengeUrl } from '../src/xianyu-password-response.js';
import type { PasswordLoginTransport, PasswordLoginInput } from '../src/password-login-port.js';

const deferred = <T = void>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
async function until<T>(read: () => Promise<T>, check: (value: T) => boolean) {
  const deadline = Date.now() + 3000;
  for (;;) { const value = await read(); if (check(value)) return value; if (Date.now() > deadline) throw new Error('condition timeout'); await new Promise(r => setTimeout(r, 5)); }
}
async function fixture(browser?: PasswordLoginTransport, maxWaitMs = 3000, hydrate: () => Promise<void> = async () => undefined, extra: Partial<PasswordLoginOptions> = {}) {
  const store = new MemoryStore(), repository = new MemoryPasswordLoginRepository();
  const admin = await store.createAdmin({ email: `${randomUUID()}@example.test`, passwordHash: 'fixture', displayName: 'login fixture' });
  const account = await store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'fixture-seller' });
  const old = structuredClone(await store.upsertCredential({ adminId: admin.id, accountId: account.id, platform: 'xianyu', cookieHeader: 'unb=fixture-seller; cookie2=old', accessToken: 'old-token', expiresAt: '2020-01-01T00:00:00Z' }));
  await store.markCredentialVerified({ adminId: admin.id, accountId: account.id, status: 'expired', expected: structuredClone(old) });
  const auth = new AuthService(store, loadConfig({ ALLOW_IN_MEMORY: 'true' }));
  const audit = async () => randomUUID();
  const accounts = new AccountService(store, audit), credentials = new CredentialService(store, audit);
  const vault = new PasswordLoginVault(repository, 'fixture-encryption-key-at-least-32');
  let connected = 0, calls = 0, lastInput: PasswordLoginInput | undefined;
  const login = new PasswordLoginService(store, auth, accounts, credentials, vault, { run: async input => {
    calls++; lastInput = input;
    return browser ? browser.run(input) : { unb: 'fixture-seller', profileKey: input.profileKey, usedPassword: true,
      cookieSnapshot: [{ name: 'unb', value: 'fixture-seller', domain: '.goofish.com', path: '/' }, { name: 'cookie2', value: 'new-session', domain: '.goofish.com', path: '/' }] };
  } }, { enabled: true, maxWaitMs, hydrate, connected: async () => { connected++; }, ...extra });
  const create = () => login.create(admin.id, { account: 'fixture-phone', password: 'fixture-password', accountId: account.id, acceptTerms: true });
  const finish = (id: string) => until(() => login.get(admin.id, id), s => ['succeeded','failed','expired','cancelled'].includes(s.status));
  const remember = async () => { await vault.save({ adminId: admin.id, accountId: account.id, account: 'saved-phone', password: 'saved-password', expectedVersion: 0, profileKey: randomUUID() }); const row = (await repository.get(admin.id, account.id))!; await repository.settle(row, Date.now() - 1); return (await repository.get(admin.id, account.id))!; };
  return { store, repository, admin, account, old, auth, accounts, credentials, vault, login, create, finish, remember, calls: () => calls, connected: () => connected, input: () => lastInput };
}

test('observed official login success requires business success; verification and untrusted URLs are distinct', () => {
  assert.deepEqual(classifyPasswordLoginResponse({ content: { success: true, data: { resultCode: 100, processFinished: true } }, hasError: false }), { kind: 'succeeded' });
  assert.equal(classifyPasswordLoginResponse({ content: { success: false, data: { resultCode: 100 } } }).kind, 'failed');
  assert.equal(classifyPasswordLoginResponse({}).kind, 'failed');
  assert.equal(classifyPasswordLoginResponse({ content: { data: { needSmsCheck: true } } }).kind, 'verification_required');
  for (const url of ['https://evil.test/', 'http://www.goofish.com/', 'https://goofish.com.evil.test/', 'https://user@goofish.com/']) assert.equal(safeChallengeUrl(url), undefined);
});
test('successful password login revives expired authorization, clears old expiry/token, encrypts bound credentials and schedules IM', async () => {
  const f = await fixture(); try {
    const session = await f.create(); const done = await f.finish(session.id);
    assert.equal(done.status, 'succeeded'); assert.equal(done.credentialsSaved, true);
    const credential = (await f.store.getCredential(f.admin.id, f.account.id))!;
    assert.equal(credential.status, 'active'); assert.equal(credential.expiresAt, undefined); assert.equal(credential.accessToken, undefined);
    assert.equal(credential.generation, (f.old.generation ?? 1) + 1); assert.equal(done.account?.id, f.account.id);
    assert.equal(done.account?.status, 'disconnected', 'only a real IM heartbeat can claim connected'); assert.equal(f.connected(), 1);
    const row = (await f.repository.get(f.admin.id, f.account.id))!;
    assert.equal(JSON.stringify(row).includes('fixture-password'), false); assert.equal(JSON.stringify(done).includes('fixture-password'), false);
    assert.deepEqual(f.vault.open(row), { account: 'fixture-phone', password: 'fixture-password' });
    assert.throws(() => f.vault.open({ ...row, accountId: randomUUID() }), /PASSWORD_SECRET_INVALID/);
  } finally { await f.login.close(); }
});
test('wrong new password preserves existing credentials, generation and remembered password', async () => {
  const f = await fixture({ run: async () => { throw new Error('PASSWORD_REJECTED'); } });
  try { const before = await f.remember(); const session = await f.create(); assert.equal((await f.finish(session.id)).errorCode, 'PASSWORD_REJECTED');
    assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.generation, f.old.generation);
    assert.deepEqual(await f.repository.get(f.admin.id, f.account.id), before);
  } finally { await f.login.close(); }
});
test('device aliases reuse the established account profile across add/manual/recovery entry points and isolate administrators',async()=>{
  const f=await fixture();
  try{const first=await f.create();assert.equal((await f.finish(first.id)).status,'succeeded');const profile=f.input()!.profileKey;
    assert.equal(profile,f.vault.initialDeviceKey(f.admin.id,'fixture-phone'));assert.notEqual(profile,f.vault.initialDeviceKey('other-admin','fixture-phone'));
    const alias=await f.repository.deviceAlias(f.admin.id,f.vault.loginDigest(f.admin.id,'fixture-phone'));assert.equal(alias?.accountId,f.account.id);assert.equal(alias?.profileKey,profile);
    const again=await f.login.create(f.admin.id,{account:'fixture-phone',password:'fixture-password',accountId:undefined,acceptTerms:true});assert.equal((await f.finish(again.id)).status,'succeeded');assert.equal(f.input()?.profileKey,profile);assert.equal(f.input()?.expectedUserId,'fixture-seller');
    assert.ok(f.input()?.initialCookieSnapshot?.some(c=>c.name==='cookie2'&&c.value==='new-session'));
  }finally{await f.login.close();}
});
test('device profile lookup failure releases the account lease without leaving a waiting session', async () => {
  const f = await fixture();
  const get = f.repository.get.bind(f.repository);
  const createLoginSession = f.store.createLoginSession.bind(f.store);
  let sessionsCreated = 0;
  f.store.createLoginSession = async input => { sessionsCreated++; return createLoginSession(input); };
  f.repository.get = async () => { throw new Error('FIXTURE_PROFILE_DATABASE_UNAVAILABLE'); };
  try {
    await assert.rejects(f.create(), /FIXTURE_PROFILE_DATABASE_UNAVAILABLE/);
    assert.equal(f.calls(), 0);
    assert.equal(sessionsCreated, 0);
    const nextOwner = randomUUID();
    assert.equal(await f.repository.claim(f.account.id, nextOwner, Date.now() + 1000), true);
    await f.repository.release(f.account.id, nextOwner);
    f.repository.get = get;
    const session = await f.create();
    assert.equal((await f.finish(session.id)).status, 'succeeded');
  } finally { await f.login.close(); }
});
for(const remembered of [false,true])test(`add-account password login binds the resolved existing account before saving its secret (remembered=${remembered})`,async()=>{
  const f=await fixture();
  try{const before=remembered?await f.remember():undefined;
    const session=await f.login.create(f.admin.id,{account:'fixture-phone',password:'fixture-password',accountId:undefined,acceptTerms:true});const done=await f.finish(session.id);
    assert.equal(done.status,'succeeded');assert.equal(done.account?.id,f.account.id);assert.equal(done.credentialsSaved,true);
    const secret=(await f.repository.get(f.admin.id,f.account.id))!;assert.ok(secret);assert.equal(secret.version,(before?.version??0)+1);assert.equal(secret.enabled,true);
    assert.deepEqual(f.vault.open(secret),{account:'fixture-phone',password:'fixture-password'});assert.equal((await f.store.listAccounts(f.admin.id)).total,1);
  }finally{await f.login.close();}
});
test('new official identity creates and binds its account only after authentication, including the encrypted secret',async()=>{
  const f=await fixture({run:async input=>({unb:'brand-new-seller',profileKey:input.profileKey,usedPassword:true,cookieSnapshot:[{name:'unb',value:'brand-new-seller',domain:'.goofish.com',path:'/'}]})});
  try{const session=await f.login.create(f.admin.id,{account:'new-phone',password:'new-fixture-password',accountId:undefined,acceptTerms:true}),done=await f.finish(session.id);assert.equal(done.status,'succeeded');assert.notEqual(done.account?.id,f.account.id);
    const account=done.account!,secret=(await f.repository.get(f.admin.id,account.id))!;assert.equal(account.sellerRef,'brand-new-seller');assert.equal(secret.accountId,account.id);assert.deepEqual(f.vault.open(secret),{account:'new-phone',password:'new-fixture-password'});assert.equal((await f.store.getLoginSessionById(f.admin.id,session.id))?.accountId,account.id);
  }finally{await f.login.close();}
});
test('a read-only collaborator cannot read or cancel another administrator password session',async()=>{
  const entered=deferred(),gate=deferred();const f=await fixture({run:async()=>{entered.resolve();await gate.promise;throw new Error('PASSWORD_REJECTED');}});
  try{const other=await f.store.createAdmin({email:`${randomUUID()}@example.test`,passwordHash:'fixture',displayName:'read collaborator'});
    await f.store.grantScope({adminId:other.id,accountId:f.account.id,scope:'read'});const session=await f.create();await entered.promise;
    await assert.rejects(f.login.get(other.id,session.id),{code:'NOT_FOUND'});await assert.rejects(f.login.cancel(other.id,session.id),{code:'NOT_FOUND'});assert.equal(f.input()?.signal.aborted,false);
  }finally{gate.resolve();await f.login.close();}
});
test('manual official verification is nonce-bound and creator-bound, and only platform success afterwards commits authorization',async()=>{
  const f=await fixture({run:async input=>{
    const proof=await input.onHttpVerification!('https://passport.goofish.com//newlogin/login.do/_____tmd_____/punish?x5secdata=fixture%2Bencoded');
    assert.equal(proof.value,'fixture-proof');
    return {unb:'fixture-seller',profileKey:input.profileKey,usedPassword:true,cookieSnapshot:[{name:'unb',value:'fixture-seller',domain:'.goofish.com',path:'/'}]};
  }});
  try{const session=await f.create(),pending=await until(()=>f.login.get(f.admin.id,session.id),s=>!!s.verificationChallenge);
    assert.match(pending.verificationChallenge!.url,/x5secdata=fixture%2Bencoded&addCookieToHeader=1/);
    assert.equal((await f.store.getCredential(f.admin.id,f.account.id))?.status,'expired','candidate UI is not successful login');
    const candidate={value:'fixture-proof',host:'passport.goofish.com',expire:Date.now()+60_000};
    await assert.rejects(f.login.submitVerification(f.admin.id,session.id,'wrong-nonce',candidate),{code:'PASSWORD_VERIFICATION_CHANGED'});
    await assert.rejects(f.login.submitVerification(f.admin.id,session.id,pending.verificationChallenge!.id,{...candidate,host:'evil.test'}),{code:'PASSWORD_VERIFICATION_INVALID'});
    await f.login.submitVerification(f.admin.id,session.id,pending.verificationChallenge!.id,candidate);
    assert.equal((await f.finish(session.id)).status,'succeeded');
    await assert.rejects(f.login.submitVerification(f.admin.id,session.id,pending.verificationChallenge!.id,candidate),{code:'PASSWORD_VERIFICATION_CHANGED'});
  }finally{await f.login.close();}
});
test('cancellation before challenge abort-listener registration does not leave a pending verification promise',async()=>{
  const f=await fixture(),gate=deferred(),controller=new AbortController();
  const entry={adminId:f.admin.id,controller,public:{id:randomUUID(),status:'logging_in',expiresAt:new Date(Date.now()+3000).toISOString()}};
  const internal=f.login as any;internal.assertActive=async()=>{await gate.promise;};
  try{const pending=internal.waitForHttpVerification(entry,'https://passport.goofish.com//newlogin/login.do/_____tmd_____/punish?x5secdata=fixture');controller.abort();gate.resolve();
    await assert.rejects(Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(new Error('verification wait hung')),100))]),error=>error instanceof Error&&error.message!=='verification wait hung');
  }finally{gate.resolve();await f.login.close();}
});
for (const interference of ['cancel', 'delete', 'scope', 'disabled', 'new-login'] as const) test(`late browser success cannot commit after ${interference}`, async () => {
  const entered = deferred(), gate = deferred();
  const f = await fixture({ run: async input => { entered.resolve(); await gate.promise; return { unb: 'fixture-seller', profileKey: input.profileKey, usedPassword: true, cookieSnapshot: [] }; } });
  try {
    const session = await f.create(); await entered.promise;
    if (interference === 'cancel') await f.login.cancel(f.admin.id, session.id);
    if (interference === 'scope') await f.store.revokeScope(f.admin.id, f.account.id, 'manage');
    if (interference === 'disabled') await f.store.updateAccount(f.admin.id, f.account.id, { status: 'disabled' });
    if (interference === 'delete') await f.store.deleteAccount(f.admin.id, f.account.id);
    if (interference === 'new-login') await f.store.upsertCredential({ adminId: f.admin.id, accountId: f.account.id, platform: 'xianyu', cookieHeader: 'unb=fixture-seller; cookie2=other-login' });
    gate.resolve(); if (interference !== 'delete') assert.notEqual((await f.finish(session.id)).status, 'succeeded'); await f.login.close();
    assert.equal((await f.repository.get(f.admin.id, f.account.id)), undefined);
    assert.equal(f.connected(), 0);
    if (interference === 'scope') assert.equal((await f.store.listScopes(f.admin.id)).some(s => s.accountId === f.account.id), false);
    if (interference === 'disabled') assert.equal((await f.store.getAccountForLogin(f.admin.id, f.account.id))?.status, 'disabled');
    if (interference === 'new-login') assert.match((await f.store.getCredential(f.admin.id, f.account.id))!.cookieHeader!, /other-login/);
  } finally { gate.resolve(); await f.login.close(); }
});
test('concurrent credential commit rejects a stale expected generation atomically', async () => {
  const f = await fixture(); try {
    await assert.rejects(f.store.upsertCredential({ adminId: f.admin.id, accountId: f.account.id, platform: 'xianyu', expectedGeneration: 1, cookieHeader: 'stale' }), /CREDENTIAL_CHANGED/);
    assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.cookieHeader, f.old.cookieHeader);
  } finally { await f.login.close(); }
});
test('two owners cannot recover the same account; stale release cannot remove a current lease', async () => {
  const repo = new MemoryPasswordLoginRepository(), account = randomUUID(), first = randomUUID(), second = randomUUID();
  assert.equal(await repo.claim(account, first, Date.now() + 1000), true); assert.equal(await repo.claim(account, second, Date.now() + 1000), false);
  await repo.release(account, second); assert.equal(await repo.renew(account, first, Date.now() + 2000), true);
  await repo.release(account, first); assert.equal(await repo.claim(account, second, Date.now() + 1000), true);
});
test('stale workers cannot re-enable a disabled password secret', async () => {
  const f = await fixture(); try {
    const row = await f.remember(); await f.repository.settle(row, Date.now(), 'PASSWORD_REJECTED', true);
    await f.repository.settle(row, Date.now() + 1000);
    assert.equal((await f.repository.get(row.adminId, row.accountId))?.enabled, false);
  } finally { await f.login.close(); }
});
test('missing encryption key refuses login before any official HTTP interaction', async () => {
  const f = await fixture(); const login = new PasswordLoginService(f.store,f.auth,f.accounts,f.credentials,new PasswordLoginVault(f.repository,'development-only-credential-key-change-me'),{run:async()=>{throw new Error('browser must not launch');}},{enabled:true,hydrate:async()=>undefined,connected:async()=>undefined});
  try { await assert.rejects(login.create(f.admin.id,{account:'fixture',password:'fixture',acceptTerms:true}),{code:'PASSWORD_ENCRYPTION_KEY_REQUIRED'}); }
  finally { await login.close(); await f.login.close(); }
});
test('HTTP authentication is bound to the existing target before any verification or credential write', async()=>{
  const f=await fixture({run:async input=>{
    assert.equal(input.expectedUserId,'fixture-seller');
    assert.equal(input.initialCookieSnapshot,undefined,'legacy credentials without a scoped snapshot start with a fresh official bootstrap');
    return {unb:'different-seller',profileKey:input.profileKey,usedPassword:true,cookieSnapshot:[]};
  }});
  try{const session=await f.create();assert.equal((await f.store.getLoginSessionById(f.admin.id,session.id))?.accountId,f.account.id);
    const done=await f.finish(session.id);assert.equal(done.errorCode,'PASSWORD_ACCOUNT_MISMATCH');assert.equal(f.connected(),0);
    assert.equal((await f.store.getCredential(f.admin.id,f.account.id))?.cookieHeader,f.old.cookieHeader);
  }finally{await f.login.close();}
});
test('account removal aborts pending HTTP authentication and deletes encrypted remembered credentials',async()=>{
  const entered=deferred();
  const f=await fixture({run:async input=>{entered.resolve();await new Promise<void>(resolve=>input.signal.addEventListener('abort',()=>resolve(),{once:true}));input.signal.throwIfAborted();throw new Error('unexpected');}});
  try{await f.remember();const session=await f.create();await entered.promise;await f.login.forgetAccount(f.account.id);
    assert.equal(await f.repository.get(f.admin.id,f.account.id),undefined);assert.notEqual((await f.login.get(f.admin.id,session.id)).status,'succeeded');assert.equal(f.connected(),0);
  }finally{await f.login.close();}
});
test('password persistence failure reports partial authorization without claiming saved credentials or replacing the prior secret', async () => {
  const f = await fixture();
  try { const before=await f.remember();f.repository.save=async()=>{throw new Error('controlled storage outage');};
    const session=await f.create(),done=await f.finish(session.id);assert.equal(done.status,'failed');assert.equal(done.errorCode,'PASSWORD_SECRET_SAVE_FAILED');assert.equal(done.credentialsSaved,false);
    assert.deepEqual(await f.repository.get(f.admin.id,f.account.id),before);assert.equal(f.connected(),0);
  }finally{await f.login.close();}
});
for (const checked of ['valid','network-error','expired'] as const) test(`offline account first checks cookies: ${checked}`, async () => {
  const f = await fixture(); let reconnects=0;
  try { await f.remember(); await f.store.upsertCredential({adminId:f.admin.id,accountId:f.account.id,platform:'xianyu',cookieHeader:'unb=fixture-seller; cookie2=offline'});
    f.account.status='disconnected';f.account.transportStatus='disconnected';f.account.transportSeenAt='2020-01-01T00:00:00Z';
    const worker = new PasswordReloginWorker(f.store,f.auth,f.login,async()=>checked==='valid'?{success:true}:checked==='expired'?{success:false,accountInvalid:true,errorCode:'SESSION_EXPIRED'}:{success:false,errorCode:'NETWORK_ERROR'},async()=>{reconnects++;});
    worker.start();await worker.tick();await worker.stop();assert.equal(f.calls(),checked==='expired'?1:0);assert.equal(reconnects,checked==='valid'?1:0);
  } finally {await f.login.close();}
});
for (const interference of ['expiry', 'manage', 'lease'] as const) test(`commit cannot succeed after ${interference} changes while hydration is pending`, async () => {
  const entered = deferred(), gate = deferred();
  const f = await fixture(undefined, interference === 'expiry' ? 100 : 3000, async () => { entered.resolve(); await gate.promise; });
  try {
    const session = await f.create(); await entered.promise;
    if (interference === 'expiry') await new Promise(r => setTimeout(r, 130));
    if (interference === 'manage') { await f.store.grantScope({ adminId: f.admin.id, accountId: f.account.id, scope: 'read' }); await f.store.revokeScope(f.admin.id, f.account.id, 'manage'); }
    if (interference === 'lease') { await f.repository.removeAccount(f.account.id); await f.repository.claim(f.account.id, randomUUID(), Date.now() + 30_000); }
    gate.resolve(); assert.notEqual((await f.finish(session.id)).status, 'succeeded'); assert.equal(f.connected(), 0);
  } finally { gate.resolve(); await f.login.close(); }
});
for (const revoked of ['scope', 'disabled', 'credential'] as const) test(`automatic recovery cannot restore a ${revoked} revoked by administrator`, async () => {
  const f = await fixture(); try {
    const row = await f.remember();
    if (revoked === 'scope') await f.store.revokeScope(f.admin.id, f.account.id, 'manage');
    if (revoked === 'disabled') await f.store.updateAccount(f.admin.id, f.account.id, { status: 'disabled' });
    if (revoked === 'credential') await f.store.revokeCredential(f.admin.id, f.account.id);
    const worker = new PasswordReloginWorker(f.store, f.auth, f.login, async () => ({ success: true }), async () => undefined);
    worker.start(); await worker.tick(); await worker.stop();
    assert.equal(f.calls(), 0); assert.equal((await f.repository.get(row.adminId, row.accountId))?.enabled, false);
  } finally { await f.login.close(); }
});
test('background official face verification releases the worker scan, remains creator-owned and resumes the same saved-secret task',async()=>{
  const gate=deferred();let calls=0;
  const f=await fixture({run:async input=>{calls++;await input.onIvStatus!({imageDataUrl:'data:image/png;base64,fixture',status:'waiting',expiresAt:new Date(Date.now()+3000).toISOString()});await gate.promise;await input.assertActive();return {unb:'fixture-seller',profileKey:input.profileKey,usedPassword:true,cookieSnapshot:[{name:'unb',value:'fixture-seller',domain:'.goofish.com',path:'/'}]};}});
  try{
    const secret=await f.remember();await f.login.recover(secret);
    const pending=await f.login.pending(f.admin.id);assert.equal(pending?.automatic,true);assert.ok(pending?.verificationQr);assert.equal((await f.store.getCredential(f.admin.id,f.account.id))?.status,'expired');
    const current=(await f.repository.get(f.admin.id,f.account.id))!;assert.equal(current.enabled,true);assert.equal(current.version,secret.version);assert.equal(current.nextAttemptAt,Date.parse(pending!.expiresAt));
    const other=await f.store.createAdmin({email:'background-other@example.test',passwordHash:'fixture',displayName:'other'});await f.store.grantScope({adminId:other.id,accountId:f.account.id,scope:'read'});
    assert.equal(await f.login.pending(other.id),null);await assert.rejects(f.login.get(other.id,pending!.id),{code:'NOT_FOUND'});
    const presenter=randomUUID();assert.equal((await f.login.pending(f.admin.id,presenter))?.id,pending!.id);assert.equal(await f.login.pending(f.admin.id,randomUUID()),null);await assert.rejects(f.login.get(f.admin.id,pending!.id,randomUUID()),{code:'PASSWORD_VERIFICATION_TAKEN_OVER'});
    (f.login as any).active.get(pending!.id).presenter.expiresAt=Date.now()-1;
    const replacement=randomUUID();assert.equal((await f.login.pending(f.admin.id,replacement))?.id,pending!.id);await assert.rejects(f.login.get(f.admin.id,pending!.id,presenter),{code:'PASSWORD_VERIFICATION_TAKEN_OVER'});
    gate.resolve();assert.equal((await until(()=>f.login.get(f.admin.id,pending!.id,replacement),s=>s.status==='succeeded')).status,'succeeded');assert.equal(calls,1);assert.equal(await f.login.pending(f.admin.id),null);
    const after=(await f.repository.get(f.admin.id,f.account.id))!;assert.equal(after.version,secret.version);assert.equal(after.ciphertext,secret.ciphertext);assert.equal(after.enabled,true);assert.equal(after.failureCode,undefined);
  }finally{gate.resolve();await f.login.close();}
});
test('explicit cancellation of background verification stops the task and automatic retries',async()=>{
  const f=await fixture({run:async input=>{await input.onHttpVerification!('https://passport.goofish.com/newlogin/login.do/_____tmd_____/punish?x5secdata=fixture');throw new Error('must not continue after cancellation');}});
  try{const secret=await f.remember();await f.login.recover(secret);const pending=await f.login.pending(f.admin.id);assert.ok(pending?.verificationChallenge);await f.login.cancel(f.admin.id,pending!.id);
    await f.login.close();assert.equal((await f.repository.get(f.admin.id,f.account.id))?.enabled,false);assert.equal(await f.login.pending(f.admin.id),null);assert.equal((await f.store.getCredential(f.admin.id,f.account.id))?.status,'expired');
  }finally{await f.login.close();}
});
test('a presenter taken over during verification access checks cannot apply its old native proof',async()=>{
  const f=await fixture({run:async input=>{await input.onHttpVerification!('https://passport.goofish.com/newlogin/login.do/_____tmd_____/punish?x5secdata=fixture');throw new Error('must not apply old proof');}});
  try{await f.login.recover(await f.remember());const first=randomUUID(),second=randomUUID(),pending=(await f.login.pending(f.admin.id,first))!,entry=(f.login as any).active.get(pending.id),check=(f.login as any).assertActive.bind(f.login);
    (f.login as any).assertActive=async(value:unknown)=>{await check(value);entry.presenter={id:second,expiresAt:Date.now()+30_000};};
    await assert.rejects(f.login.submitVerification(f.admin.id,pending.id,pending.verificationChallenge!.id,{value:'fixture-proof',host:'passport.goofish.com',expire:Date.now()+60_000},first),{code:'PASSWORD_VERIFICATION_TAKEN_OVER'});assert.equal(entry.httpChallenge.answered,false);
  }finally{await f.login.close();}
});
test('automatic verification reserves a slot for manual login instead of exhausting the global limit',async()=>{
  const gate=deferred(),f=await fixture({run:async input=>{if(input.account==='saved-phone'){await input.onIvStatus!({imageDataUrl:'data:image/png;base64,fixture',status:'waiting',expiresAt:new Date(Date.now()+3000).toISOString()});await gate.promise;}return {unb:input.account==='saved-phone'?'fixture-seller':'manual-fixture-seller',profileKey:input.profileKey,usedPassword:true,cookieSnapshot:[]};}});
  try{const secret=await f.remember();await f.login.recover(secret);await assert.rejects(f.login.recover(secret),{code:'PASSWORD_LOGIN_BUSY'});
    const other=await f.store.createAdmin({email:'manual-slot@example.test',passwordHash:'fixture',displayName:'manual'});
    const session=await f.login.create(other.id,{account:'manual-new-account',password:'fixture',acceptTerms:true});assert.equal((await until(()=>f.login.get(other.id,session.id),s=>s.status==='succeeded')).status,'succeeded');
  }finally{gate.resolve();await f.login.close();}
});
test('expired authorization automatically logs in using the decrypted saved secret and stable login context', async () => {
  const f = await fixture(); try {
    const row = await f.remember(); const worker = new PasswordReloginWorker(f.store, f.auth, f.login, async () => { throw new Error('expired does not need a cookie check'); }, async () => undefined);
    worker.start(); await worker.tick(); await worker.stop();
    assert.equal(f.calls(), 1); assert.equal(f.input()?.account, 'saved-phone'); assert.equal(f.input()?.password, 'saved-password');
    assert.equal(f.input()?.profileKey, row.profileKey);
    assert.equal((await f.store.getCredential(f.admin.id, f.account.id))?.status, 'active');
    assert.equal((await f.repository.get(row.adminId, row.accountId))?.attempts, 0);
  } finally { await f.login.close(); }
});
test('explicit saved-password retry re-enables a paused secret under the account lease without exposing or re-entering its password',async()=>{
  const f=await fixture();
  try{const old=await f.remember();await f.repository.settle(old,Date.now(),'PASSWORD_IV_EXPIRED',true);assert.equal(await f.login.savedAvailable(f.admin.id,f.account.id),true);
    const presenter=randomUUID(),session=await f.login.retrySaved(f.admin.id,f.account.id,presenter);assert.equal(session.automatic,true);
    const done=await until(()=>f.login.get(f.admin.id,session.id,presenter),s=>s.status==='succeeded');assert.equal(done.credentialsSaved,true);
    const next=(await f.repository.get(f.admin.id,f.account.id))!;assert.equal(next.version,old.version+1);assert.equal(next.ciphertext,old.ciphertext);assert.equal(next.enabled,true);assert.equal(f.input()?.password,'saved-password');
    assert.equal(JSON.stringify(done).includes('saved-password'),false);
  }finally{await f.login.close();}
});
test('saved-password retries cannot restore revoked management access or race a second retry',async()=>{
  const gate=deferred(),f=await fixture({run:async input=>{await gate.promise;await input.assertActive();return {unb:'fixture-seller',profileKey:input.profileKey,usedPassword:true,cookieSnapshot:[]};}});
  try{const old=await f.remember();await f.repository.settle(old,Date.now(),'PASSWORD_IV_EXPIRED',true);
    await f.store.revokeScope(f.admin.id,f.account.id,'manage');await assert.rejects(f.login.retrySaved(f.admin.id,f.account.id));assert.equal((await f.repository.get(f.admin.id,f.account.id))?.enabled,false);
    await f.store.grantScope({adminId:f.admin.id,accountId:f.account.id,scope:'manage'});
    const requests=await Promise.allSettled([f.login.retrySaved(f.admin.id,f.account.id),f.login.retrySaved(f.admin.id,f.account.id)]);assert.equal(requests.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.repository.get(f.admin.id,f.account.id))?.version,old.version+1);
  }finally{gate.resolve();await f.login.close();}
});
