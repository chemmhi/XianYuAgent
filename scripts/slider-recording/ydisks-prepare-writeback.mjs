import fs from 'node:fs';
import { join } from 'node:path';
const root = process.env.XIANYU_COPY_INPUT_DIR;
const input = JSON.parse(fs.readFileSync(join(root, 'verified-recovery-credential.json'), 'utf8'));
const native = JSON.parse(fs.readFileSync(join(root, 'same-browser-ticket-check/account-verdict.json'), 'utf8'));
const events = fs.readFileSync(join(root, 'server-existing-client-readonly.stdout.log'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const registration = events.find(e => e.type === 'ws.client.result' && e.data.registered);
if (!native.normal || registration?.data.userId !== input.sellerRef || input.sellerRef !== '1903703477') throw Error('Validated account proof required');
const nativeDirectory = join(root, 'same-browser-ticket-check');
let nativeStartedAt, nativeCompletedAt, previousRequest;
for (const file of fs.readdirSync(nativeDirectory).filter(n => /^events-.*\.ndjson$/.test(n))) {
  for (const line of fs.readFileSync(join(nativeDirectory, file), 'utf8').split('\n').filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.type === 'native.fetch.input') previousRequest = event;
    if (event.type === 'native.fetch.output' && event.data.body?.path && previousRequest?.data.url.includes('login.token')) {
      const body = JSON.parse(fs.readFileSync(join(nativeDirectory, event.data.body.path), 'utf8'));
      if (body.data?.accessToken === input.accessToken) { nativeStartedAt = previousRequest.utc; nativeCompletedAt = event.utc; }
    }
  }
}
if (!nativeStartedAt) throw Error('Unable to correlate the native token proof');
const payload = { cookieHeader: input.credential.cookieHeader, accessToken: input.accessToken,
  deviceId: input.deviceId, metadata: input.credential.metadata };
const baselineRaw = fs.readFileSync(join(root, 'production-final-state.stdout.log'), 'utf8');
const baseline = JSON.parse(baselineRaw.slice(baselineRaw.indexOf('{"observedAt"'), baselineRaw.indexOf('\nCOMMIT')).trim());
fs.writeFileSync(join(root, 'credential-put-body.json'), JSON.stringify(payload, null, 2));
fs.writeFileSync(join(root, 'rollback-account-snapshot.json'), JSON.stringify(baseline, null, 2));
const plan = {
  status: 'PREPARED_NOT_EXECUTED', target: 'tencent-server', accountId: input.accountId, sellerRef: input.sellerRef, displayName: '逐星智能',
  reasonNotExecuted: 'User instruction: 绝不能动生产环境本地数据. Credential and health reconciliation writes require the user to lift that restriction.',
  proof: { nativeAccountNormal: native.normal, nativeStartedAt, nativeCompletedAt, serverRegistration: registration.data, serverRegistrationAt: registration.utc,
    nativeFiles: ['same-browser-native-recovery/native-judgment-1.json', 'same-browser-ticket-check/account-check-token.json',
      'same-browser-ticket-check/account-check-login.json'], serverFile: 'server-existing-client-readonly.stdout.log' },
  steps: [
    { action: 'Revalidate the native token through the real server IM client; read and back up current credential and health rows; stop if account owner, credential contents or risk episode changed since production-final-state.stdout.log.' },
    { action: 'Use the authenticated existing API to save the validated credential and start the real listener', method: 'PUT',
      path: `/api/v1/accounts/${input.accountId}/credential`, bodyFile: 'credential-put-body.json' },
    { action: 'Observe a fresh connected transport from the production listener; do not force transport_status.' },
    { action: 'Reconcile only this account’s recorded old risk episode through PostgresStore.clearAccountRisk after the genuine native token success and real IM connection',
      riskEpisode: baseline.account.risk_episode, source: 'mtop.taobao.idlemessage.pc.login.token', startedAt: nativeStartedAt,
      guard: 'If a newer risk signal exists or the listener cannot connect, leave the risk signal intact.' },
    { action: 'Read account, credential and transport again; acceptance requires active credential, no remaining verification risk, and fresh connected transport.' },
  ],
  rollbackSnapshot: 'rollback-account-snapshot.json',
  scope: 'Only the named account credential, corresponding health reconciliation and normal audit records. No source deployment or production profile replacement.',
  limitation: 'The server HTTP client still receives a token challenge; its existing IM client can register the token obtained by the native browser. Future renewal through the browser remains necessary; this is not proof of indefinite stability.',
};
fs.writeFileSync(join(root, 'production-writeback-plan.json'), JSON.stringify(plan, null, 2));
console.log(JSON.stringify({ prepared: true, executed: false, target: plan.target, sellerRef: plan.sellerRef, nativeNormal: true, serverRegistered: true }));
