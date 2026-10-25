import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as tcpServer } from 'node:net';
import { createServer } from 'vite';
import { fixture } from '../../api/scripts/invite-registration/test-support.mjs';
import { seed } from '../../api/scripts/account-hard-delete-support.mjs';

const profile = await mkdtemp(join(tmpdir(), 'account-delete-chrome-'));
const f = await fixture('postgres', { XIANYU_VERIFICATION_BROWSER_USER_DATA_DIR: join(profile, 'verification') });
const data = await seed(f);
const evidence = join(import.meta.dirname, '../../../docs/evidence/account-hard-delete-20261025');
const server = tcpServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port; await new Promise(resolve => server.close(resolve));
let vite, chrome, socket;
async function wait(check, label) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
}
try {
  process.env.VITE_API_MODE = 'live'; process.env.VITE_API_PROXY_TARGET = f.origin;
  vite = await createServer({ root: join(import.meta.dirname, '..'), server: { host: '127.0.0.1', port: 0 } }); await vite.listen();
  const web = `http://127.0.0.1:${vite.httpServer.address().port}`;
  chrome = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${join(profile, 'chrome')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const target = await wait(async () => {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page'); } catch { return false; }
  }, 'Chrome');
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map();
  socket.onmessage = event => { const result = JSON.parse(event.data); if (!result.id) return; const call = pending.get(result.id); pending.delete(result.id); result.error ? call.reject(new Error(result.error.message)) : call.resolve(result.result); };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Browser error'); return result.result?.value; };
  await send('Network.enable');
  for (const pair of data.admin.cookie.split('; ')) { const index = pair.indexOf('='); await send('Network.setCookie', { name: pair.slice(0, index), value: pair.slice(index + 1), url: web }); }
  await send('Page.navigate', { url: `${web}/accounts` });
  await wait(() => evaluate(`document.body.innerText.includes('删除回归账号')`), 'loaded account list');
  const open = () => evaluate(`(() => { const row=[...document.querySelectorAll('tr,[role="row"]')].find(row=>row.textContent.includes('删除回归账号')); row.querySelector('[data-testid="account-delete"]').click(); return true; })()`);
  await open(); await wait(() => evaluate(`Boolean(document.querySelector('[data-testid="account-delete-confirm"]'))`), 'delete dialog');
  const text = await evaluate('document.querySelector("[role=dialog]").innerText');
  assert.match(text, /订单、商品、设置、聊天记录、登录凭证和图片附件/); assert.match(text, /无法恢复/);
  await mkdir(evidence, { recursive: true });
  for (const [width, height, filename] of [[1440, 900, 'delete-desktop.png'], [390, 844, 'delete-mobile.png']]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await writeFile(join(evidence, filename), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  }
  await evaluate(`document.querySelector('[data-testid="account-delete-cancel"]').click()`);
  assert.ok(await f.runtime.store.getAccount(data.admin.id, data.account.id));
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await open();
  await evaluate(`document.querySelector('[data-testid="account-delete-confirm"]').click()`);
  await wait(() => evaluate(`!document.querySelector('[data-testid="account-delete-confirm"]') && !document.body.innerText.includes('删除回归账号')`), 'visible deletion result');
  assert.equal((await f.db.pool.query('select count(*)::int n from accounts.accounts where id=$1', [data.account.id])).rows[0].n, 0);
  assert.equal((await f.db.pool.query('select count(*)::int n from products.products where id=$1', [data.product.id])).rows[0].n, 0);
  assert.equal((await f.db.pool.query('select count(*)::int n from messages.messages where account_id=$1', [data.account.id])).rows[0].n, 0);
  for (const key of data.paths) assert.equal(await f.runtime.objectStorage.getObject(key), undefined);
  assert.ok(await f.runtime.store.getProduct(data.admin.id, data.otherProduct.id));
  f.runtime.xianyuIm.startListener = async () => {};
  f.runtime.xianyu.verifyLogin = async () => ({ success: true, accountInvalid: false, cookieHeader: 'unb=880000000001' });
  f.runtime.xianyu.fetchProfile = async () => ({ success: true, accountInvalid: false, cookieHeader: 'unb=880000000001', response: { userId: '880000000001', nickname: '重新绑定账号' } });
  const rebound = await f.request('/api/v1/auth/cookie-login', { ...data.invited, method: 'POST', key: 'e2e-rebind', body: { cookieHeader: 'unb=880000000001; _m_h5_tk=test_9999999999999' } });
  assert.equal(rebound.status, 201, JSON.stringify(rebound.body));
  assert.notEqual(rebound.body.data.account.id, data.account.id);
  const newId = rebound.body.data.account.id;
  assert.equal((await f.runtime.store.listProducts(data.invited.id, { accountId: newId })).items.length, 0);
  assert.equal((await f.runtime.store.listConversations(data.invited.id, { accountId: newId })).items.length, 0);
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ database: 'isolated PostgreSQL', storage: 'real MinIO', browser: 'Chrome/CDP', cancellationPreservedData: true, uiDeletionRemovedDatabaseAndObjects: true, invitedUserRebindHasFreshIdAndEmptyData: true, externalXianyuAdapter: 'stub' }, null, 2));
  console.log('Account deletion Chrome -> API -> PostgreSQL/MinIO -> invited-user rebind PASS');
} finally {
  socket?.close(); chrome?.kill(); await vite?.close(); await f.close();
  // Only the isolated test profile created above is removed.
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
