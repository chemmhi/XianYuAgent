import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..', '..', '..');
const chromePath = process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const screenshotDir = join(root, 'docs', 'evidence', 'stage5', 'S4-VS7A', 'screenshots');
const chromeProfile = join(tmpdir(), `xianyu-agent-settings-openai-chrome-${process.pid}`);
const children = [];
const resources = { runtime: undefined, providers: [], cdp: undefined };

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
  child.stdout.on('data', (chunk) => process.stdout.write(`[settings-openai-e2e:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[settings-openai-e2e:${command}] ${chunk}`));
  children.push(child);
  return child;
}

async function waitFor(check, label, timeoutMs = 30_000) {
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

async function requestJson(apiUrl, path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  try { return text ? JSON.parse(text) : undefined; } catch { return text; }
}

async function startFakeProvider(name, model, reply) {
  const state = { failing: false, requests: [] };
  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    state.requests.push({ path: request.url, authorization: request.headers.authorization, body });
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/models' && request.method === 'GET') {
      response.statusCode = 200;
      response.end(JSON.stringify({ object: 'list', data: [{ id: model, object: 'model', owned_by: name }] }));
      return;
    }
    if (request.url === '/v1/responses' && request.method === 'POST') {
      if (state.failing) {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: { message: `${name} forced authentication failure` } }));
        return;
      }
      response.statusCode = 200;
      response.end(JSON.stringify({ id: `${name}-response-${state.requests.length}`, model, output_text: JSON.stringify({ decision: 'reply', text: reply, segments: [reply] }) }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    name,
    model,
    state,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
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
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
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
  return { socket, send };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'browser script failed');
  return result.result?.value;
}

async function setCardField(cdp, role, labelText, value) {
  const expression = `(() => {
    const card = document.querySelector('[data-openai-config="${role}"]');
    const label = Array.from(card?.querySelectorAll('label') ?? []).find((node) => node.textContent?.trim().startsWith(${JSON.stringify(labelText)}));
    const input = label?.querySelector('input,select');
    if (!input) throw new Error('missing OpenAI field: ' + ${JSON.stringify(role)} + '/' + ${JSON.stringify(labelText)});
    input.focus();
    if (input instanceof HTMLSelectElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.value;
    }
    input.select();
    return true;
  })()`;
  const selected = await evaluate(cdp, expression);
  if (selected !== true) return selected;
  await cdp.send('Input.insertText', { text: String(value) });
  await new Promise((resolve) => setTimeout(resolve, 120));
  return evaluate(cdp, `(() => { const card = document.querySelector('[data-openai-config="${role}"]'); const label = Array.from(card?.querySelectorAll('label') ?? []).find((node) => node.textContent?.trim().startsWith(${JSON.stringify(labelText)})); return label?.querySelector('input,select')?.value ?? ''; })()`);
}

async function openModelOptions(cdp, role) {
  return evaluate(cdp, `(() => { const select = document.querySelector('[data-openai-config="${role}"] select'); if (!select) throw new Error('missing model select'); select.focus(); select.click(); return true; })()`);
}

async function modelOptionValues(cdp, role) {
  return evaluate(cdp, `Array.from(document.querySelector('[data-openai-config="${role}"] select')?.options ?? []).map((option) => option.value).filter(Boolean)`);
}

async function clickCardButton(cdp, role, text) {
  return evaluate(cdp, `(() => { const card = document.querySelector('[data-openai-config="${role}"]'); const button = Array.from(card?.querySelectorAll('button') ?? []).find((node) => node.textContent?.trim() === ${JSON.stringify(text)}); if (!button) throw new Error('missing card button: ' + ${JSON.stringify(role)} + '/' + ${JSON.stringify(text)}); button.click(); return true; })()`);
}

async function chooseModel(cdp, role, model) {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await openModelOptions(cdp, role);
  try {
    await waitFor(async () => await evaluate(cdp, `Boolean(Array.from(document.querySelector('[data-openai-config="${role}"] select')?.options ?? []).find((option) => option.value === ${JSON.stringify(model)}))`), `${role} model options`);
  } catch (error) {
    const diagnostics = await evaluate(cdp, `(() => { const card = document.querySelector('[data-openai-config="${role}"]'); const select = card?.querySelector('select'); return { card: card?.innerText, options: Array.from(select?.options ?? []).map((option) => option.value), error: card?.querySelector('.openai-status-copy')?.textContent }; })()`);
    throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}`);
  }
  await setCardField(cdp, role, 'Model', model);
}

async function captureViewport(cdp, width, height, filename, scrollY = 0) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await evaluate(cdp, `(() => { const main = document.querySelector('main.settings-main'); const target = main && main.scrollHeight > main.clientHeight ? main : document.scrollingElement; target?.scrollTo(0, ${Math.max(0, Math.trunc(scrollY))}); return { top: target?.scrollTop ?? 0, height: target?.scrollHeight ?? 0, client: target?.clientHeight ?? 0 }; })()`);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  mkdirSync(screenshotDir, { recursive: true });
  const destination = join(screenshotDir, filename);
  writeFileSync(destination, Buffer.from(screenshot.data, 'base64'));
  return destination;
}

async function saveConfigFromUi(cdp, role, input) {
  assert.equal(await setCardField(cdp, role, 'Provider', input.provider), input.provider, `${role} provider input did not stick`);
  assert.equal(await setCardField(cdp, role, 'Base URL', input.baseUrl), input.baseUrl, `${role} base URL input did not stick`);
  if (input.apiKey !== undefined) assert.equal(await setCardField(cdp, role, 'API Key', input.apiKey), input.apiKey, `${role} API key input did not stick`);
  await chooseModel(cdp, role, input.model);
  await clickCardButton(cdp, role, '测试连通性');
  try {
    const passedLabel = role === 'primary' ? '测试通过' : '备用可用';
    await waitFor(async () => String(await evaluate(cdp, `document.querySelector('[data-openai-config="${role}"]')?.innerText ?? ''`)).includes(passedLabel), `${role} connectivity test`);
  } catch (error) {
    const diagnostics = await evaluate(cdp, `document.querySelector('[data-openai-config="${role}"]')?.innerText ?? ''`);
    throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}`);
  }
  await clickCardButton(cdp, role, '保存');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes(role === 'primary' ? '当前 API 配置已保存' : '备用 API 配置已保存'), `${role} config save`);
}

function apiViewByRole(body, role) {
  return body?.data?.items?.find((item) => item.role === role);
}

function assertNoSecret(value, secret, label) {
  assert.equal(JSON.stringify(value).includes(secret), false, `${label} leaked plaintext secret`);
}

async function run() {
  const apiPort = await freePort();
  const webPort = await freePort();
  const debugPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const databaseUrl = String(process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? '').trim();
  const primary = await startFakeProvider('primary-v1', 'primary-model-v1', 'PRIMARY_V1_REPLY');
  const primaryV2 = await startFakeProvider('primary-v2', 'primary-model-v2', 'PRIMARY_V2_REPLY');
  const backup = await startFakeProvider('backup', 'backup-model', 'BACKUP_REPLY');
  resources.providers.push(primary, primaryV2, backup);
  mkdirSync(chromeProfile, { recursive: true });

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const apiBuild = spawnProcess(npm, ['--workspace', 'apps/api', 'run', 'build']);
  const buildExit = await new Promise((resolve) => apiBuild.once('exit', resolve));
  if (buildExit !== 0) throw new Error(`API build failed with ${buildExit}`);

  const apiDist = join(root, 'apps', 'api', 'dist');
  const { createApp } = await import(pathToFileURL(join(apiDist, 'app.js')).href);
  const { loadConfig } = await import(pathToFileURL(join(apiDist, 'config.js')).href);
  const { hashPassword } = await import(pathToFileURL(join(apiDist, 'security.js')).href);
  const runtimeConfig = loadConfig({
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(apiPort),
    DATABASE_URL: databaseUrl,
    REDIS_URL: '',
    ALLOW_IN_MEMORY: databaseUrl ? 'false' : 'true',
    COOKIE_SECURE: 'false',
    XIANYU_QR_MODE: 'stub',
    AGENT_RUNTIME: 'in-process',
    AUTO_REPLY_MODEL_ENABLED: 'false',
    AUTO_REPLY_SEND_MODE: 'simulate',
    AUTOMATION_BUYER_ALLOWLIST: JSON.stringify(['Buyer E2E']),
    AUTO_REPLY_AGENT_DEBOUNCE_MS: '0',
    AUTO_REPLY_AGENT_REPLY_SEGMENT_DELAY_SECONDS: '0',
  });
  let runtime = createApp(runtimeConfig);
  resources.runtime = runtime;
  await runtime.listen();
  const actualApiPort = runtime.server.address()?.port ?? apiPort;
  const actualApiUrl = `http://127.0.0.1:${actualApiPort}`;

  const adminEmail = `settings-openai-e2e-${process.pid}@example.com`;
  const adminPassword = 'password-123';
  const bootstrap = await requestJson(actualApiUrl, '/api/v1/auth/bootstrap', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': `settings-openai-bootstrap-${process.pid}` },
    body: JSON.stringify({ email: adminEmail, password: adminPassword, displayName: 'OpenAI Settings E2E' }),
  });
  let cookie = cookiesFrom(bootstrap.response);
  let csrf = csrfFrom(cookie);
  let adminId = bootstrap.body.data?.profile?.id;
  if (bootstrap.response.status === 409) {
    const admin = await runtime.store.createAdmin({ email: adminEmail, passwordHash: await hashPassword(adminPassword), displayName: 'OpenAI Settings E2E' });
    const loggedIn = await runtime.auth.login({ email: adminEmail, password: adminPassword });
    cookie = `session_id=${loggedIn.session.id}; csrf_token=${encodeURIComponent(loggedIn.csrfToken)}`;
    csrf = loggedIn.csrfToken;
    adminId = admin.id;
  } else {
    assert.equal(bootstrap.response.status, 200, JSON.stringify(bootstrap.body));
  }
  assert.ok(cookie && csrf, 'bootstrap did not return session/csrf cookies');
  assert.ok(adminId, 'bootstrap did not return admin id');

  const account = await requestJson(actualApiUrl, '/api/v1/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'X-CSRF-Token': csrf, 'Idempotency-Key': `settings-openai-account-${process.pid}` },
    body: JSON.stringify({ platform: 'xianyu', sellerRef: `settings-openai-${process.pid}`, displayName: 'OpenAI Settings Demo' }),
  });
  assert.equal(account.response.status, 201, JSON.stringify(account.body));
  const accountId = account.body.data?.id;
  assert.ok(accountId, 'account seed did not return account id');

  spawnProcess(npm, ['--workspace', 'apps/web', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)], {
    env: { ...process.env, VITE_API_MODE: 'live', VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: actualApiUrl },
  });
  await waitFor(async () => (await fetch(`${webUrl}/settings`)).ok, 'Vite frontend');

  const chrome = spawnProcess(chromePath, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeProfile}`, '--window-size=1440,900', 'about:blank']);
  await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
  const cdp = await createCdpClient(debugPort);
  resources.cdp = cdp;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  for (const pair of cookie.split('; ')) {
    const [name, ...valueParts] = pair.split('=');
    await cdp.send('Network.setCookie', { name, value: valueParts.join('='), url: `${webUrl}/` });
  }
  await cdp.send('Page.navigate', { url: `${webUrl}/settings` });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'settings route');
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector("[data-settings-page]"))'), 'Settings page');
  await waitFor(async () => await evaluate(cdp, `localStorage.getItem('xianyu.activeAccountId') === ${JSON.stringify(accountId)}`), 'Settings first account selection');
  await evaluate(cdp, `(() => { const tab = Array.from(document.querySelectorAll('.settings-tabs button')).find((button) => button.textContent?.includes('OpenAI API')); tab?.click(); return true; })()`);
  await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector("[data-openai-panel]"))'), 'OpenAI settings panel');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('尚未配置主/备模型'), 'OpenAI empty state');

  const primarySecret = 'sk-e2e-primary-secret-20260921';
  const backupSecret = 'sk-e2e-backup-secret-20260921';
  await saveConfigFromUi(cdp, 'primary', { provider: 'primary-v1', baseUrl: primary.baseUrl, model: primary.model, apiKey: primarySecret });
  await saveConfigFromUi(cdp, 'backup', { provider: 'backup', baseUrl: backup.baseUrl, model: backup.model, apiKey: backupSecret });

  const savedConfigs = await requestJson(actualApiUrl, `/api/v1/settings/openai?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  assert.equal(savedConfigs.response.status, 200, JSON.stringify(savedConfigs.body));
  const savedPrimary = apiViewByRole(savedConfigs.body, 'primary');
  const savedBackup = apiViewByRole(savedConfigs.body, 'backup');
  assert.ok(savedPrimary?.id && savedBackup?.id, 'primary and backup configs were not persisted');
  assert.equal(savedPrimary.provider, 'primary-v1');
  assert.equal(savedBackup.provider, 'backup');
  assert.equal(savedPrimary.model, primary.model);
  assert.equal(savedBackup.model, backup.model);
  assert.equal(savedPrimary.status, 'active');
  assert.equal(savedBackup.status, 'active');
  assert.equal(savedPrimary.apiKeyConfigured, true);
  assert.equal(savedBackup.apiKeyConfigured, true);
  assert.equal(savedPrimary.canReveal, false);
  assert.equal(savedBackup.canReveal, false);
  assertNoSecret(savedConfigs.body, primarySecret, 'OpenAI settings API');
  assertNoSecret(savedConfigs.body, backupSecret, 'OpenAI settings API');
  assert.ok(savedPrimary.fingerprint && savedPrimary.fingerprint !== primarySecret, 'primary fingerprint missing');
  assert.ok(savedBackup.fingerprint && savedBackup.fingerprint !== backupSecret, 'backup fingerprint missing');

  // Each persisted config must query its own provider. Opening the backup
  // dropdown must not replace the primary card's provider-owned options.
  // Touch the provider field with the same value first so the assertion always
  // starts from an explicitly invalidated lazy-load cache after save/reload.
  await setCardField(cdp, 'primary', 'Provider', 'primary-v1');
  const primaryModelCallsBefore = primary.state.requests.filter((request) => request.path === '/v1/models').length;
  await openModelOptions(cdp, 'primary');
  await waitFor(async () => (await modelOptionValues(cdp, 'primary')).includes(primary.model), 'primary provider models');
  const primaryModelCallsAfter = primary.state.requests.filter((request) => request.path === '/v1/models').length;
  assert.ok(primaryModelCallsAfter - primaryModelCallsBefore <= 1, 'primary dropdown triggered duplicate provider probes');
  const primaryOptions = await modelOptionValues(cdp, 'primary');
  assert.ok(primaryOptions.includes(primary.model), `primary model missing from primary card: ${JSON.stringify(primaryOptions)}`);
  assert.equal(primaryOptions.includes(backup.model), false, 'primary card exposed backup provider model');
  await setCardField(cdp, 'backup', 'Provider', 'backup');
  const backupModelCallsBefore = backup.state.requests.filter((request) => request.path === '/v1/models').length;
  await openModelOptions(cdp, 'backup');
  await waitFor(async () => (await modelOptionValues(cdp, 'backup')).includes(backup.model), 'backup provider models');
  const backupModelCallsAfter = backup.state.requests.filter((request) => request.path === '/v1/models').length;
  assert.ok(backupModelCallsAfter - backupModelCallsBefore <= 1, 'backup dropdown triggered duplicate provider probes');
  const backupOptions = await modelOptionValues(cdp, 'backup');
  assert.ok(backupOptions.includes(backup.model), `backup model missing from backup card: ${JSON.stringify(backupOptions)}`);
  assert.equal(backupOptions.includes(primary.model), false, 'backup card exposed primary provider model');
  assert.deepEqual(await modelOptionValues(cdp, 'primary'), primaryOptions, 'opening backup changed primary model options');

  const browserSecretLeak = await evaluate(cdp, `(() => {
      const text = document.body.innerText;
      const values = Array.from(document.querySelectorAll('input,textarea')).map((input) => input.value);
    return {
      href: location.href,
      body: text.includes(${JSON.stringify(primarySecret)}) || text.includes(${JSON.stringify(backupSecret)}),
      url: location.href.includes(${JSON.stringify(primarySecret)}) || location.href.includes(${JSON.stringify(backupSecret)}),
      localStorage: Object.values(localStorage).some((value) => value.includes(${JSON.stringify(primarySecret)}) || value.includes(${JSON.stringify(backupSecret)})),
      inputs: values.some((value) => value.includes(${JSON.stringify(primarySecret)}) || value.includes(${JSON.stringify(backupSecret)})),
    };
  })()`);
  assert.deepEqual(browserSecretLeak, { href: browserSecretLeak.href, body: false, url: false, localStorage: false, inputs: false });
  const maskedKeyEcho = await evaluate(cdp, `(() => {
      const read = (role) => {
        const card = document.querySelector('[data-openai-config="' + role + '"]');
        const label = Array.from(card?.querySelectorAll('label') ?? []).find((node) => node.textContent?.trim().startsWith('API Key'));
        return label?.querySelector('input')?.value ?? '';
      };
      return { primary: read('primary'), backup: read('backup') };
    })()`);
  assert.ok(maskedKeyEcho.primary.includes(savedPrimary.apiKeyHint), 'primary API key hint is not echoed in the UI');
  assert.ok(maskedKeyEcho.backup.includes(savedBackup.apiKeyHint), 'backup API key hint is not echoed in the UI');
  assert.ok(maskedKeyEcho.primary.includes('••••') || maskedKeyEcho.primary.includes('****'), 'primary API key hint is not masked');
  assert.ok(maskedKeyEcho.backup.includes('••••') || maskedKeyEcho.backup.includes('****'), 'backup API key hint is not masked');

  const primarySuccessDesktop = await captureViewport(cdp, 1440, 900, 'settings-openai-primary-success-desktop-1440x900.png');
  const primarySuccessMobile = await captureViewport(cdp, 390, 844, 'settings-openai-primary-success-mobile-390x844.png', 320);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  const mobileBottomReachability = await evaluate(cdp, `(() => {
    const main = document.querySelector('main.settings-main');
    const target = main && main.scrollHeight > main.clientHeight ? main : document.scrollingElement;
    target?.scrollTo(0, target?.scrollHeight ?? 0);
    const nav = document.querySelector('.settings-mobile-bottom');
    const backup = document.querySelector('[data-openai-config="backup"]');
    const actions = backup?.querySelector('.card-actions');
    const navHeight = nav?.getBoundingClientRect().height ?? 0;
    const actionsRect = actions?.getBoundingClientRect();
    return { actionsBottom: actionsRect?.bottom ?? 0, viewportBottom: window.innerHeight - navHeight, navHeight };
  })()`);
  assert.ok(mobileBottomReachability.actionsBottom <= mobileBottomReachability.viewportBottom, `mobile backup actions are hidden behind bottom nav: ${JSON.stringify(mobileBottomReachability)}`);

  const conversation = await runtime.store.createConversation({ adminId, accountId, buyerRef: 'buyer-openai-e2e', buyerDisplayName: 'Buyer E2E', itemRef: 'item-openai-e2e', itemTitle: 'OpenAI E2E 商品', externalConversationRef: `openai-e2e-${process.pid}` });
  async function runAgent(label) {
    const inbound = await runtime.store.createMessage({ adminId, conversationId: conversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: `请介绍配置链路 ${label}`, source: 'system', externalMessageRef: `openai-e2e-${label}-${Date.now()}.PNM`, traceId: `openai-e2e-${label}` });
    return runtime.autoReply.processInbound({ adminId, conversationId: conversation.id, inboundMessageId: inbound.message.id, senderName: 'Buyer E2E', requestId: `openai-e2e-${label}`, traceId: `openai-e2e-${label}` });
  }

  const firstRun = await runAgent('primary-v1');
  assert.equal(firstRun.run.status, 'persisted', JSON.stringify(firstRun.run));
  assert.match(firstRun.outboundMessage?.bodyText ?? '', /PRIMARY_V1_REPLY/);
  assert.ok(primary.state.requests.some((request) => request.path === '/v1/responses'), 'primary provider was not called first');
  assert.equal(backup.state.requests.filter((request) => request.path === '/v1/responses').length, 0, 'backup called during healthy primary request');

  await setCardField(cdp, 'primary', 'Base URL', primaryV2.baseUrl);
  // Existing configs load provider model options from the persisted config id;
  // keep the selected model stable while proving a live Base URL update.
  await chooseModel(cdp, 'primary', primary.model);
  await clickCardButton(cdp, 'primary', '测试连通性');
  try {
    await waitFor(async () => String(await evaluate(cdp, `document.querySelector('[data-openai-config="primary"]')?.innerText ?? ''`)).includes('测试通过'), 'updated primary connectivity test');
  } catch (error) {
    const diagnostics = await evaluate(cdp, `document.querySelector('[data-openai-config="primary"]')?.innerText ?? ''`);
    throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}`);
  }
  await clickCardButton(cdp, 'primary', '保存');
  await waitFor(async () => String(await evaluate(cdp, 'document.body.innerText')).includes('当前 API 配置已保存'), 'updated primary save');
  const updatedConfigs = await requestJson(actualApiUrl, `/api/v1/settings/openai?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
  const updatedPrimary = apiViewByRole(updatedConfigs.body, 'primary');
  assert.equal(updatedPrimary.baseUrl, primaryV2.baseUrl);
  assert.equal(updatedPrimary.model, primary.model);
  assert.equal(updatedPrimary.version, savedPrimary.version + 1);
  assertNoSecret(updatedConfigs.body, primarySecret, 'updated OpenAI settings API');

  const secondRun = await runAgent('primary-v2');
  assert.equal(secondRun.run.status, 'persisted', JSON.stringify(secondRun.run));
  assert.match(secondRun.outboundMessage?.bodyText ?? '', /PRIMARY_V2_REPLY/);
  assert.ok(primaryV2.state.requests.some((request) => request.path === '/v1/responses'), 'updated primary provider was not consumed without restart');

  primaryV2.state.failing = true;
  const thirdRun = await runAgent('fallback');
  assert.equal(thirdRun.run.status, 'persisted', JSON.stringify(thirdRun.run));
  assert.match(thirdRun.outboundMessage?.bodyText ?? '', /BACKUP_REPLY/);
  assert.ok(primaryV2.state.requests.filter((request) => request.path === '/v1/responses').length >= 2, 'failed primary was not attempted');
  assert.ok(backup.state.requests.some((request) => request.path === '/v1/responses'), 'backup provider was not called after primary failure');

  const fallbackAudit = Array.isArray(runtime.store.audits) ? runtime.store.audits.find((event) => {
    const payload = JSON.stringify(event.payload ?? '');
    return payload.includes('fallback') || payload.includes('primary-v2') || payload.includes('backup');
  }) : undefined;
  if (!fallbackAudit) console.warn('[settings-openai-e2e] fallback audit record not exposed by current runtime store');

  const fallbackDesktop = await captureViewport(cdp, 1440, 900, 'settings-openai-fallback-desktop-1440x900.png');
  const fallbackMobile = await captureViewport(cdp, 390, 844, 'settings-openai-fallback-mobile-390x844.png', 320);

  let restart = { status: 'skipped', reason: 'E2E_DATABASE_URL/DATABASE_URL not set; in-memory store cannot prove restart persistence' };
  if (databaseUrl) {
    await runtime.close();
    runtime = createApp(runtimeConfig);
    resources.runtime = runtime;
    await runtime.listen();

    // A service restart must keep the encrypted config rows and let the
    // browser rehydrate the cards from PostgreSQL. Connectivity is an
    // ephemeral probe result, so the fresh UI must ask the operator to test
    // again before showing a healthy state.
    primaryV2.state.failing = false;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${webUrl}/settings` });
    await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', 'settings route after API restart');
    await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector("[data-settings-page]"))'), 'Settings page after API restart');
    await evaluate(cdp, `(() => { const tab = Array.from(document.querySelectorAll('.settings-tabs button')).find((button) => button.textContent?.includes('OpenAI API')); tab?.click(); return true; })()`);
    await waitFor(async () => await evaluate(cdp, 'Boolean(document.querySelector("[data-openai-panel]"))'), 'OpenAI settings panel after API restart');
    await waitFor(async () => await evaluate(cdp, `(() => { const card = document.querySelector('[data-openai-config="primary"]'); const fields = Array.from(card?.querySelectorAll('input,select') ?? []).map((input) => input.value); return fields[0] === 'primary-v1' && fields[1] === ${JSON.stringify(primaryV2.baseUrl)} && fields[3] === ${JSON.stringify(primary.model)}; })()`), 'persisted primary fields after API restart');
    await waitFor(async () => await evaluate(cdp, `(() => { const card = document.querySelector('[data-openai-config="backup"]'); const fields = Array.from(card?.querySelectorAll('input,select') ?? []).map((input) => input.value); return fields[0] === 'backup' && fields[1] === ${JSON.stringify(backup.baseUrl)} && fields[3] === ${JSON.stringify(backup.model)}; })()`), 'persisted backup fields after API restart');
    const requiresConnectivityRetest = async (role) => {
      const text = String(await evaluate(cdp, `document.querySelector('[data-openai-config="${role}"]')?.innerText ?? ''`));
      return !text.includes('测试通过') && !text.includes('备用可用') && (text.includes('待测试') || text.includes('待配置'));
    };
    try {
      await waitFor(() => requiresConnectivityRetest('primary'), 'primary requires connectivity retest after API restart');
      await waitFor(() => requiresConnectivityRetest('backup'), 'backup requires connectivity retest after API restart');
    } catch (error) {
      const diagnostics = await evaluate(cdp, `({ primary: document.querySelector('[data-openai-config="primary"]')?.innerText ?? '', backup: document.querySelector('[data-openai-config="backup"]')?.innerText ?? '', body: document.body.innerText.slice(0, 1200) })`);
      throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}`);
    }

    const restartConfigs = await requestJson(actualApiUrl, `/api/v1/settings/openai?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } });
    assert.equal(restartConfigs.response.status, 200, JSON.stringify(restartConfigs.body));
    const restartPrimary = apiViewByRole(restartConfigs.body, 'primary');
    const restartBackup = apiViewByRole(restartConfigs.body, 'backup');
    assert.equal(restartPrimary?.id, savedPrimary.id, 'primary config id changed after service restart');
    assert.equal(restartBackup?.id, savedBackup.id, 'backup config id changed after service restart');
    assert.equal(restartPrimary?.baseUrl, primaryV2.baseUrl, 'updated primary config was not reloaded after service restart');
    assert.equal(restartPrimary?.lastConnectivity ?? 'unknown', 'unknown', 'connectivity must require a fresh probe after service restart');
    assert.equal(restartBackup?.lastConnectivity ?? 'unknown', 'unknown', 'backup connectivity must require a fresh probe after service restart');

    const statusBeforeConnectivityTest = await evaluate(cdp, `document.querySelector('[data-openai-config="primary"]')?.innerText ?? ''`);
    const primaryControlsAfterRestart = await evaluate(cdp, `(() => { const card = document.querySelector('[data-openai-config="primary"]'); return { fields: Array.from(card?.querySelectorAll('input,select') ?? []).map((input) => ({ value: input.value, type: input.type, disabled: input.disabled })), buttons: Array.from(card?.querySelectorAll('button') ?? []).map((button) => ({ text: button.textContent?.trim(), disabled: button.disabled })) }; })()`);
    assert.equal(primaryControlsAfterRestart.buttons.find((button) => button.text === '测试连通性')?.disabled, false, JSON.stringify(primaryControlsAfterRestart));
    await clickCardButton(cdp, 'primary', '测试连通性');
    try {
      await waitFor(async () => String(await evaluate(cdp, `document.querySelector('[data-openai-config="primary"]')?.innerText ?? ''`)).includes('测试通过'), 'primary connectivity retest after API restart');
    } catch (error) {
      const diagnostics = await evaluate(cdp, `({ card: document.querySelector('[data-openai-config="primary"]')?.innerText ?? '', body: document.body.innerText.slice(0, 1600) })`);
      throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}`);
    }
    const statusAfterConnectivityTest = await evaluate(cdp, `document.querySelector('[data-openai-config="primary"]')?.innerText ?? ''`);

    // Keep the post-restart Agent assertion deterministic: the persisted
    // primary remains configured, but this fixture forces it down so the
    // already-persisted backup must be consumed.
    primaryV2.state.failing = true;
    const restartConversation = await runtime.store.createConversation({ adminId, accountId, buyerRef: 'buyer-openai-restart', buyerDisplayName: 'Buyer E2E', itemRef: 'item-openai-e2e', itemTitle: 'OpenAI E2E 商品', externalConversationRef: `openai-restart-${process.pid}` });
    const restartInbound = await runtime.store.createMessage({ adminId, conversationId: restartConversation.id, direction: 'inbound', senderRole: 'buyer', bodyType: 'text', bodyText: '重启后验证备用配置', source: 'system', externalMessageRef: `openai-restart-${Date.now()}.PNM`, traceId: 'openai-restart' });
    const restartRun = await runtime.autoReply.processInbound({ adminId, conversationId: restartConversation.id, inboundMessageId: restartInbound.message.id, senderName: 'Buyer E2E', requestId: 'openai-restart', traceId: 'openai-restart' });
    assert.equal(restartRun.run.status, 'persisted', JSON.stringify(restartRun.run));
    assert.match(restartRun.outboundMessage?.bodyText ?? '', /BACKUP_REPLY/);
    restart = { status: 'passed', provider: 'backup', output: restartRun.outboundMessage?.bodyText, uiBeforeConnectivityTest: statusBeforeConnectivityTest, uiAfterConnectivityTest: statusAfterConnectivityTest };
  }

  console.log(JSON.stringify({
    apiStorage: databaseUrl ? 'postgres' : 'memory',
    accountId,
    configs: { primary: { id: savedPrimary.id, version: savedPrimary.version }, backup: { id: savedBackup.id, version: savedBackup.version }, updatedPrimaryVersion: updatedPrimary.version },
    agentConsumption: { first: firstRun.outboundMessage?.bodyText, updated: secondRun.outboundMessage?.bodyText, fallback: thirdRun.outboundMessage?.bodyText, primaryRequests: primary.state.requests.length, updatedPrimaryRequests: primaryV2.state.requests.length, backupRequests: backup.state.requests.length },
    fallbackAudit: Boolean(fallbackAudit),
    secretRedaction: browserSecretLeak,
    restart,
    screenshots: { primarySuccessDesktop, primarySuccessMobile, fallbackDesktop, fallbackMobile },
  }, null, 2));
}

try {
  await run();
} finally {
  try { resources.cdp?.socket.close(); } catch { /* already closed */ }
  if (resources.runtime) {
    try {
      resources.runtime.server.closeAllConnections?.();
      resources.runtime.server.closeIdleConnections?.();
      await resources.runtime.close();
    } catch (error) {
      console.warn(`[settings-openai-e2e] runtime cleanup failed: ${error.message}`);
    }
  }
  for (const provider of resources.providers.reverse()) {
    try { await provider.close(); } catch (error) { console.warn(`[settings-openai-e2e] provider cleanup failed: ${error.message}`); }
  }
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
