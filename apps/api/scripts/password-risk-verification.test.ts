import assert from 'node:assert/strict';
import test from 'node:test';
import {createVerificationServiceFixture} from './verification-service-fixture.js';
import {verificationTransportScenario} from './verification-transport-scenario.js';

test('password account manual verification: HTTP/WS/original Chrome resumes Token CAS and matched heartbeat',()=>
  verificationTransportScenario(process.env.MANUAL_VERIFICATION_TEST_DATABASE_URL,true,false,false,0,true));

test('password account background verification completes without password resubmission or a viewer',async()=>{
  const f=await createVerificationServiceFixture({databaseUrl:process.env.MANUAL_VERIFICATION_TEST_DATABASE_URL,nativeChallenge:true,passwordAuthenticated:true});
  f.runtime.passwordLogin.create=async()=>{throw new Error('PASSWORD_MUST_NOT_BE_RESUBMITTED');};
  try{
    f.runtime.xianyuIm.requestVerificationRecovery(f.admin.id,f.account.id,'im_listener');
    let row;const deadline=Date.now()+40_000;
    while(Date.now()<deadline){row=(await f.runtime.verification!.coordinator.repository.list()).find(s=>s.subject.accountId===f.account.id);if(row&&['succeeded','failed','expired','cancelled'].includes(row.state))break;await new Promise(r=>setTimeout(r,50));}
    assert.ok(row,'background recovery must create its own verification session');assert.equal(row.state,'succeeded',row.failureCode);
    assert.ok(row.autoAttempts>0);assert.equal(row.mode,'manual_then_auto');
    assert.equal((await f.runtime.store.listAccountVerificationRisks(f.admin.id,f.account.id)).length,0);
    assert.equal((await f.runtime.store.getCredential(f.admin.id,f.account.id))?.accessToken,'fixture-access');
    assert.deepEqual(f.stats.browserUserAgents,['fixture-password-session-ua']);assert.ok(f.stats.registrations>0);assert.ok(f.stats.heartbeats>0);
  }finally{await f.close();}
});
