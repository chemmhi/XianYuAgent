import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const screenshotDir = join(root, 'docs', 'evidence', 'invite-registration-20261025', 'screenshots');
const chromeProfile = join(tmpdir(), `xianyu-agent-settings-chrome-${process.pid}`);
const children = [];

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: command.endsWith('.cmd'), ...options });
  child.stdout.on('data', (chunk) => process.stdout.write(`[settings-e2e:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[settings-e2e:${command}] ${chunk}`));
  children.push(child);
  return child;
}

async function waitFor(check, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${label} did not become ready${lastError ? `: ${lastError.message}` : ''}`);
}

function cookiesFrom(response) {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';', 1)[0]).join('; ');
}

function csrfFrom(cookie) {
  return decodeURIComponent(cookie.match(/(?:^|; )csrf_token=([^;]+)/)?.[1] ?? '');
}

async function createCdpClient(debugPort) {
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    if (!response.ok) return false;
    const pages = await response.json();
    return pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl) ?? false;
  }, 'Chrome DevTools Protocol');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id && message.method) events.push(message);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, send, events };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'browser script failed');
  return result.result?.value;
}

async function setInput(cdp, selector, value) {
  const expression = `(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (!input) throw new Error('missing input: ' + ${JSON.stringify(selector)}); const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set; setter?.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
  return evaluate(cdp, expression);
}

async function setLabelInput(cdp, labelText, value) {
  const expression = `(() => { const label = Array.from(document.querySelectorAll('.settings-form-grid label')).find((node) => node.textContent?.trim().startsWith(${JSON.stringify(labelText)})); const input = label?.querySelector('input'); if (!input) throw new Error('missing labeled input: ' + ${JSON.stringify(labelText)}); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
  return evaluate(cdp, expression);
}

async function setLabelTextArea(cdp, labelText, value) {
  const expression = `(() => { const label = Array.from(document.querySelectorAll('.settings-form-grid label')).find((node) => node.textContent?.trim().startsWith(${JSON.stringify(labelText)})); const textarea = label?.querySelector('textarea'); if (!textarea) throw new Error('missing labeled textarea: ' + ${JSON.stringify(labelText)}); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(textarea, ${JSON.stringify(value)}); textarea.dispatchEvent(new Event('input', { bubbles: true })); textarea.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
  return evaluate(cdp, expression);
}

async function clickText(cdp, text, selector = 'button') {
  const expression = `(() => { const node = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((item) => item.textContent?.trim() === ${JSON.stringify(text)}); if (!node) throw new Error('missing button: ' + ${JSON.stringify(text)}); node.click(); return true; })()`;
  return evaluate(cdp, expression);
}

async function clickContainingText(cdp, text, selector = 'button') {
  const expression = `(() => { const node = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((item) => item.textContent?.includes(${JSON.stringify(text)})); if (!node) throw new Error('missing containing button: ' + ${JSON.stringify(text)}); node.click(); return true; })()`;
  return evaluate(cdp, expression);
}

async function captureViewport(cdp, width, height, filename) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  return captureCurrentViewport(cdp, filename);
}

async function captureCurrentViewport(cdp, filename) {
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  mkdirSync(screenshotDir, { recursive: true });
  const destination = join(screenshotDir, filename);
  writeFileSync(destination, Buffer.from(screenshot.data, 'base64'));
  return destination;
}

async function requestJson(apiUrl, path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

async function run() {
  const apiPort = await freePort();
  const webPort = await freePort();
  const debugPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  mkdirSync(chromeProfile, { recursive: true });

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const apiBuild = spawnProcess(npm, ['--workspace', 'apps/api', 'run', 'build']);
  const buildExit = await new Promise((resolve) => apiBuild.once('exit', resolve));
  if (buildExit !== 0) throw new Error(`API build failed with ${buildExit}`);

  spawnProcess(process.execPath, ['apps/api/scripts/e2e-harness.mjs'], { env: { ...process.env, PORT: String(apiPort), HOST: '127.0.0.1', CREDENTIAL_ENCRYPTION_KEY: 'settings-e2e-encryption-key' } });
  await waitFor(async () => (await fetch(`${apiUrl}/healthz`)).ok, 'API');

  const bootstrap = await requestJson(apiUrl, '/api/v1/auth/bootstrap', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': `settings-bootstrap-${process.pid}` },
    body: JSON.stringify({ email: `settings-e2e-${process.pid}@example.com`, password: 'password-123', displayName: 'Settings E2E' }),
  });
  if (!bootstrap.response.ok) throw new Error(`bootstrap failed: ${bootstrap.response.status} ${JSON.stringify(bootstrap.body)}`);
  const cookie = cookiesFrom(bootstrap.response);
  const csrf = csrfFrom(cookie);
  if (!cookie || !csrf) throw new Error('bootstrap did not return session/csrf cookies');

  const account = await requestJson(apiUrl, '/api/v1/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `settings-account-${process.pid}` },
    body: JSON.stringify({ platform: 'xianyu', sellerRef: `settings-e2e-${process.pid}`, displayName: 'Settings Demo Account' }),
  });
  if (!account.response.ok) throw new Error(`account seed failed: ${account.response.status} ${JSON.stringify(account.body)}`);
  const accountId = account.body.data?.id;
  const inviteSeed = await requestJson(apiUrl, '/api/v1/auth/invites', { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'X-CSRF-Token': csrf }, body: JSON.stringify({ requestKey: `settings-invite-${process.pid}`, days: 7 }) });
  if (!inviteSeed.response.ok || !inviteSeed.body.data?.invite?.code) throw new Error(`invite seed failed: ${inviteSeed.response.status} ${JSON.stringify(inviteSeed.body)}`);
  const inviteCode = inviteSeed.body.data.invite.code;
  if (!accountId) throw new Error('account seed did not return account id');

  const forbidden = await requestJson(apiUrl, `/api/v1/credentials?accountId=${encodeURIComponent('not-scoped-account')}`, { headers: { cookie } });
  if (forbidden.response.status !== 403) throw new Error(`expected 403 for unscoped account, got ${forbidden.response.status}`);

  spawnProcess(npm, ['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)], { env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: apiUrl } });
  await waitFor(async () => (await fetch(`${webUrl}/settings`)).ok, 'Vite frontend');

  const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank']);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
  const cdp = await createCdpClient(debugPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  for (const pair of cookie.split('; ')) {
    const [name, ...valueParts] = pair.split('=');
    await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: `${webUrl}/` });
  }
  await cdp.send('Page.navigate', { url: `${webUrl}/settings` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'settings route');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector("[data-settings-page]"))'), 'Settings page');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('设置'), 'Settings account context');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector("[data-auto-reply-agent-panel]"))'), 'default Auto Reply Agent panel');
  const defaultSettingsTab = await evaluate(cdp, 'document.querySelector(".settings-tabs button.active")?.textContent?.trim() ?? ""');
  if (!String(defaultSettingsTab).includes('自动回复 Agent')) throw new Error(`settings should default to Auto Reply Agent, got: ${defaultSettingsTab}`);

  const agentPath = `/api/v1/settings/agent?accountId=${encodeURIComponent(accountId)}`;
  const agentDefaults = await requestJson(apiUrl, agentPath, { headers: { cookie } });
  if (!agentDefaults.response.ok || agentDefaults.body.data?.configVersion !== 0) throw new Error(`agent settings default readback failed: ${agentDefaults.response.status} ${JSON.stringify(agentDefaults.body)}`);
  await clickContainingText(cdp, '自动回复 Agent');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector("[data-auto-reply-agent-panel]"))'), 'Auto Reply Agent panel');
  const settingsTabStyle = await evaluate(cdp, `(() => {
    const tab = document.querySelector('.settings-tabs button.active');
    if (!tab) throw new Error('active settings tab missing');
    const rect = tab.getBoundingClientRect();
    const style = getComputedStyle(tab);
    return { height: rect.height, borderRadius: style.borderRadius, boxShadow: style.boxShadow, backgroundColor: style.backgroundColor };
  })()`);
  if (settingsTabStyle.height > 72 || settingsTabStyle.height < 40 || !settingsTabStyle.boxShadow.includes('3px 0px 0px')) {
    throw new Error(`settings tab visual state mismatch: ${JSON.stringify(settingsTabStyle)}`);
  }
  const disabledState = await evaluate(cdp, "(() => { const panel = document.querySelector('[data-auto-reply-agent-panel]'); const enabled = panel?.querySelector('input[type=\"checkbox\"]'); if (!enabled) throw new Error('auto-reply enabled checkbox missing'); enabled.click(); const fields = panel?.querySelector('fieldset.auto-reply-agent-fields'); const editable = Array.from(fields?.querySelectorAll('input,textarea,select') ?? []); return { disabled: fields?.disabled === true, allControlsDisabled: editable.length > 0 && editable.every((control) => control.matches(':disabled')), opacity: fields ? Number(getComputedStyle(fields).opacity) : 1 }; })()");
  if (!disabledState.disabled || !disabledState.allControlsDisabled || disabledState.opacity >= 1) throw new Error('disabling Agent did not gray configuration: ' + JSON.stringify(disabledState));
  const agentDisabledMobilePath = await captureViewport(cdp, 390, 844, 'settings-agent-disabled-mobile-390x844.png');
  await evaluate(cdp, "(() => { const enabled = document.querySelector('[data-auto-reply-agent-panel] input[type=\"checkbox\"]'); enabled?.click(); return true; })()");
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector("[data-auto-reply-agent-panel] fieldset.auto-reply-agent-fields:not([disabled])"))'), 'Auto Reply Agent re-enabled');
  await setLabelTextArea(cdp, '系统提示词', '设置页全量回归系统提示词');
  await setLabelTextArea(cdp, '用户提示词模板', '请处理买家问题：{{buyerMessage}}\n{{context}}');
  await setLabelInput(cdp, '最大循环次数', '6');
  await setLabelInput(cdp, '工具调用上限', '9');
  await setLabelInput(cdp, '工具超时（秒）', '15');
  await setLabelInput(cdp, '总超时（秒）', '600');
  await setLabelInput(cdp, '上下文历史条数', '15');
  await setLabelInput(cdp, '最大回复长度', '120');
  await setLabelInput(cdp, '分段发送间隔（秒）', '0.45');
  const legacyDebounceField = await evaluate(cdp, "Boolean(Array.from(document.querySelectorAll('[data-auto-reply-agent-panel] label')).find((label) => label.textContent?.includes('防抖窗口')))" );
  if (legacyDebounceField) throw new Error('legacy debounce field should not be visible');
  const removedSections = await evaluate(cdp, "(() => { const panel = document.querySelector('[data-auto-reply-agent-panel]'); return { sendMode: Array.from(panel?.querySelectorAll('label') ?? []).some((label) => label.textContent?.includes('发送模式')), audit: panel?.textContent?.includes('配置审计') === true, tooltip: panel?.querySelector('.settings-info-tooltip') !== null }; })()");
  if (removedSections.sendMode || removedSections.audit || removedSections.tooltip) throw new Error('marked settings content is still visible: ' + JSON.stringify(removedSections));
  await setLabelInput(cdp, '自动回复接管等待时间（秒）', '1');
  await clickText(cdp, '保存自动回复 Agent 配置');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('自动回复 Agent 配置已保存'), 'agent settings saved');
  const saveToast = await evaluate(cdp, "(() => { const panel = document.querySelector('[data-auto-reply-agent-panel]'); const toast = document.querySelector('.app-toast-success'); const style = toast ? getComputedStyle(toast) : null; return { inline: panel?.querySelector('.settings-save-toast') !== null, toast: toast?.textContent?.includes('自动回复 Agent 配置已保存') === true, position: style?.position ?? '', right: style?.right ?? '', bottom: style?.bottom ?? '' }; })()");
  if (saveToast.inline || !saveToast.toast || saveToast.position !== 'fixed' || !saveToast.right || !saveToast.bottom) throw new Error('save feedback did not use the global bottom-right toast: ' + JSON.stringify(saveToast));
  const agentSaved = await requestJson(apiUrl, agentPath, { headers: { cookie } });
  const savedConfig = agentSaved.body.data;
  const expectedConfig = { enabled: true, systemPrompt: '设置页全量回归系统提示词', userPromptTemplate: '请处理买家问题：{{buyerMessage}}\n{{context}}', maxLoops: 6, maxToolCalls: 9, toolTimeoutSeconds: 15, totalTimeoutSeconds: 600, maxHistory: 15, maxReplyLength: 120, replySegmentDelaySeconds: 0.45, sendDelaySeconds: 1 };
  for (const [key, value] of Object.entries(expectedConfig)) if (savedConfig?.[key] !== value) throw new Error(`agent setting ${key} did not persist: ${JSON.stringify({ expected: value, actual: savedConfig?.[key], response: agentSaved.body })}`);
  if (!agentSaved.response.ok || savedConfig?.configVersion !== 1) throw new Error(`agent settings persistence failed: ${agentSaved.response.status} ${JSON.stringify(agentSaved.body)}`);
  const agentStale = await requestJson(apiUrl, '/api/v1/settings/agent', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `agent-settings-stale-${process.pid}` },
    body: JSON.stringify({ accountId, expectedVersion: 0, maxLoops: 4 }),
  });
  if (agentStale.response.status !== 409) throw new Error(`expected 409 for stale agent settings, got ${agentStale.response.status}`);

  const agentDesktopPath = await captureViewport(cdp, 1440, 900, 'settings-agent-desktop-1440x900.png');
  const agentMobilePath = await captureViewport(cdp, 390, 844, 'settings-agent-mobile-390x844.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(cdp, '(() => { const main = document.querySelector("main.settings-main"); const target = main && main.scrollHeight > main.clientHeight ? main : document.scrollingElement; target?.scrollTo(0, target.scrollHeight); return { top: target?.scrollTop ?? 0, height: target?.scrollHeight ?? 0, client: target?.clientHeight ?? 0 }; })()');
  const agentDesktopBottomPath = await captureCurrentViewport(cdp, 'settings-agent-desktop-bottom-1440x900.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await evaluate(cdp, '(() => { const main = document.querySelector("main.settings-main"); const target = main && main.scrollHeight > main.clientHeight ? main : document.scrollingElement; target?.scrollTo(0, target.scrollHeight); return { top: target?.scrollTop ?? 0, height: target?.scrollHeight ?? 0, client: target?.clientHeight ?? 0 }; })()');
  const agentMobileBottomPath = await captureCurrentViewport(cdp, 'settings-agent-mobile-bottom-390x844.png');
  await evaluate(cdp, '(() => { const main = document.querySelector("main.settings-main"); const target = main && main.scrollHeight > main.clientHeight ? main : document.scrollingElement; target?.scrollTo(0, 0); return target?.scrollTop ?? 0; })()');

  const settingsTabs = await evaluate(cdp, "Array.from(document.querySelectorAll('.settings-tabs button')).map((button) => button.textContent?.trim())");
  const deprecatedTabs = ['凭证管理', '安全输出校验', 'Outbox Worker', '插件配置'];
  if (deprecatedTabs.some((tab) => settingsTabs.some((item) => item.includes(tab))) || !settingsTabs.some((item) => item.includes('邀请码管理'))) throw new Error('settings tabs do not match the new role-isolated surface: ' + JSON.stringify(settingsTabs));
  await clickContainingText(cdp, '邀请码管理');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('生成邀请码'), 'invite panel');
  const expiryInput = await evaluate(cdp, "(() => Array.from(document.querySelectorAll('input')).find((input) => input.getAttribute('aria-label') === '生成有效期（天）')?.value ?? '')()");
  if (expiryInput !== '7') throw new Error(`invite creation expiry input missing or wrong default: ${expiryInput}`);
  await setInput(cdp, 'input[aria-label="生成有效期（天）"]', '14');
  await clickText(cdp, '生成邀请码');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('邀请码列表'), 'invite code generated');
  const inviteDesktopPath = await captureViewport(cdp, 1440, 900, 'settings-invite-desktop-1440x900.png');
  const inviteMobilePath = await captureViewport(cdp, 390, 844, 'settings-invite-mobile-390x844.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const inviteSurface = await evaluate(cdp, "(() => ({ body: document.body.innerText, tabs: Array.from(document.querySelectorAll('.settings-tabs button')).map((button) => button.textContent?.trim()) }))()");
  if (!inviteSurface.body.includes('邀请码列表') || !inviteSurface.body.includes('邀请码列表') || !inviteSurface.body.includes('NEW')) throw new Error('invite management surface missing generated code state');
  await clickText(cdp, '续期');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('应用续期'), 'invite renew editor');
  await setInput(cdp, 'input[aria-label="续期天数"]', '30');
  await clickText(cdp, '应用续期');
  await waitFor(async () => !String(await evaluate(cdp, 'document.body.innerText')).includes('续期天数必须'), 'invite renew saved');

  await cdp.send('Network.clearBrowserCookies');
  await cdp.send('Page.navigate', { url: webUrl + '/' });
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('登录管理控制台'), 'login page after logout');
  const loginDesktopPath = await captureViewport(cdp, 1440, 900, 'auth-login-desktop-1440x900.png');
  const loginMobilePath = await captureViewport(cdp, 390, 844, 'auth-login-mobile-390x844.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await clickText(cdp, '没有账号？去注册');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('注册 FishAgent'), 'registration page');
  const registerDesktopPath = await captureViewport(cdp, 1440, 900, 'auth-register-desktop-1440x900.png');
  const registerMobilePath = await captureViewport(cdp, 390, 844, 'auth-register-mobile-390x844.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await setInput(cdp, 'input[autocomplete="one-time-code"]', inviteCode);
  await setInput(cdp, 'input[autocomplete="name"]', 'Browser Registered User');
  await setInput(cdp, 'input[autocomplete="email"]', `browser-registered-${process.pid}@example.com`);
  await setInput(cdp, 'input[autocomplete="new-password"]', 'password-123');
  await evaluate(cdp, "(() => { const input = document.querySelectorAll('input[autocomplete=\"new-password\"]')[1]; if (!input) throw new Error('missing confirm password'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, 'password-123'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
  await clickText(cdp, '注册');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const registrationBody = String(await evaluate(cdp, 'document.body.innerText'));
  if (!registrationBody.includes('运营控制台')) throw new Error('registered authenticated shell did not become ready: ' + registrationBody.slice(0, 1200));

  await cdp.send('Emulation.clearDeviceMetricsOverride');
  console.log(JSON.stringify({ apiStorage: 'memory', settingsTabs, inviteSurface, screenshots: { loginDesktopPath, loginMobilePath, registerDesktopPath, registerMobilePath, inviteDesktopPath, inviteMobilePath } }, null, 2));
  cdp.socket.close();
}

try {
  await run();
} finally {
  for (const child of children.reverse()) {
    if (!child.killed && child.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGTERM');
    }
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
  try { rmSync(chromeProfile, { recursive: true, force: true }); } catch (error) { console.warn(`Chrome temporary profile cleanup failed: ${error.message}`); }
}
