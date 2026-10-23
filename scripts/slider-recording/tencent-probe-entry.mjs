// Executed through SSH stdin in the existing API container. No application
// source or deployed files are replaced; only /tmp recording artifacts are written.
import { store as recording } from './preload.mjs';

const { loadConfig } = await import('/app/dist/config.js');
const { createApp } = await import('/app/dist/app.js');
const { XIANYU_USER_AGENT, xianyuBrowserIdentity } = await import('/app/dist/xianyu-browser-identity.js');
const adminId = '1921b632-b724-4e28-a18b-13f30b4a57f6';
const accountId = '1d274de5-38b8-4c9b-83ed-d8ba803685ac';
const config = { ...loadConfig(), autoReplyModelEnabled: false, autoReplySendMode: 'simulate', productAutomationExecutionMode: 'simulate', autoReplyOutcomeReviewWorkerEnabled: false };
recording.json('effective-config.json', { config, identity: xianyuBrowserIdentity(XIANYU_USER_AGENT), adminId, accountId });
const runtime = createApp(config);
try {
  const account = await runtime.store.getAccount(adminId, accountId);
  const credential = await runtime.store.getCredential(adminId, accountId);
  recording.json('account-before.json', { account, credential });
  if (!account || account.sellerRef !== '1903703477' || !credential?.cookieHeader) throw new Error('Target account identity or credential mismatch');
  const login = await runtime.xianyu.verifyLogin(adminId, accountId);
  recording.json('login-verification.json', login);
  recording.event('replay.step', { step: 'verifyLogin', success: login.success, errorCode: login.errorCode });
  try {
    // Call the shipped production recovery method with the same inputs it
    // receives from ensureClient. It owns challenge URL, Cookie merge and retry.
    const refreshed = await runtime.xianyuIm.refreshCredential(adminId, account, await runtime.store.getCredential(adminId, accountId));
    recording.json('credential-refresh-output.json', refreshed);
    recording.event('replay.step', { step: 'refreshCredential', success: true });
  } catch (error) {
    recording.json('credential-refresh-error.json', { name: error.name, message: error.message, code: error.code, status: error.status, details: error.details, stack: error.stack });
    recording.event('replay.step', { step: 'refreshCredential', success: false, error });
  }
  recording.json('account-after.json', { account: await runtime.store.getAccount(adminId, accountId), credential: await runtime.store.getCredential(adminId, accountId) });
} finally {
  await runtime.close();
  recording.event('replay.closed', {});
}
