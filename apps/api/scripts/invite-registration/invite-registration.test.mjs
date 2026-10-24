import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './test-support.mjs';
for (const kind of ['memory','postgres']) test(kind + ': invite generation and atomic registration', async t => {
 const f=await fixture(kind); t.after(()=>f.close()); const admin=await f.actor('invite-admin@example.com'); const user=await f.actor('existing-user@example.com','user');
 const generated=await f.request('/api/v1/auth/invites',{...admin,method:'POST',key:'invite-admin-1',body:{requestKey:'invite-request-1',days:7}}); assert.equal(generated.status,201); const code=generated.body.data.invite.code; assert.ok(code); assert.equal(generated.body.data.invite.codeHash,undefined);
 assert.equal((await f.request('/api/v1/auth/invites',{...user})).status,403); const duplicateRequest=await f.request('/api/v1/auth/invites',{...admin,method:'POST',key:'invite-admin-duplicate',body:{requestKey:'invite-request-1',days:7}}); assert.equal(duplicateRequest.status,409);
 const registered=await f.request('/api/v1/auth/register',{method:'POST',body:{inviteCode:code,email:'new-user@example.com',password:'password-123',displayName:'New User'}}); assert.equal(registered.status,201); assert.equal(registered.body.data.profile.role,'user');
 const created=await f.runtime.store.findAdminByEmail('new-user@example.com'); assert.equal(created?.role,'user'); assert.deepEqual((await f.runtime.store.listScopes(created.id)),[]);
 const concurrentCode=(await f.request('/api/v1/auth/invites',{...admin,method:'POST',key:'invite-admin-concurrent',body:{requestKey:'invite-request-concurrent',days:7}})).body.data.invite.code; const concurrent=await Promise.all([1,2,3].map(index=>f.request('/api/v1/auth/register',{method:'POST',body:{inviteCode:concurrentCode,email:'concurrent-'+index+'@example.com',password:'password-123',displayName:'Concurrent'}}))); assert.equal(concurrent.filter(result=>result.status===201).length,1); assert.equal(concurrent.filter(result=>result.status===409).length,2);
 const reused=await f.request('/api/v1/auth/register',{method:'POST',body:{inviteCode:code,email:'second@example.com',password:'password-123',displayName:'Second'}}); assert.equal(reused.status,409); assert.equal((await f.runtime.store.findAdminByEmail('second@example.com')),undefined);
 const second=await f.request('/api/v1/auth/invites',{...admin,method:'POST',key:'invite-admin-2',body:{requestKey:'invite-request-2',days:7}}); const secondCode=second.body.data.invite.code;
 const duplicate=await f.request('/api/v1/auth/register',{method:'POST',body:{inviteCode:secondCode,email:'new-user@example.com',password:'password-123',displayName:'Duplicate'}}); assert.equal(duplicate.status,409);
 const retry=await f.request('/api/v1/auth/register',{method:'POST',body:{inviteCode:secondCode,email:'retry@example.com',password:'password-123',displayName:'Retry'}}); assert.equal(retry.status,201);
 const listed=await f.request('/api/v1/auth/invites',{...admin}); assert.equal(listed.status,200); assert.ok(listed.body.data.items.some(item=>item.usedAt));
});
