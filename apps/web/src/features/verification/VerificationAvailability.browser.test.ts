import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, type Browser, type Page } from 'patchright';
import { basename, dirname, join, resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

// Real React and HTTP client against actual HTTP error responses. The platform
// and verification socket are controlled; no real account challenge is created.
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {VerificationProvider,useVerification} from '/src/features/verification/VerificationProvider.tsx';
import {createHttpClient} from '/src/api/http.ts';
import {session} from '/src/features/verification/test-fixtures.ts';import '/src/styles.css';
const key=new URLSearchParams(location.search).get('key');let sockets=0,round=0;
class Socket{static OPEN=1;readyState=1;constructor(){sockets++;document.documentElement.setAttribute('data-sockets',String(sockets));setTimeout(()=>this.onopen?.(),0);}send(){}close(){this.readyState=3;}}
window.WebSocket=Socket;
function Probe(){const ctx=useVerification();return React.createElement(React.Fragment,null,
 React.createElement('output',{'data-testid':'enabled'},String(ctx.enabled)),
 React.createElement('button',{onClick:()=>ctx.update(session({id:'round-'+(++round),state:'preparing',serverTime:Date.now(),createdAt:Date.now(),expiresAt:Date.now()+60000}))},'新增验证'))}
const http=createHttpClient({baseUrl:'/_availability/'+key});
const transport={...http,get:async path=>{try{return await http.get(path);}finally{setTimeout(()=>document.documentElement.setAttribute('data-http-settled','true'),0);}}};
createRoot(document.getElementById('root')).render(React.createElement(VerificationProvider,{transport},React.createElement(Probe)));
`;
let vite: ViteDevServer, browser: Browser, baseUrl = '', cacheDir = '', nextKey = 0;
const requests = new Map<string, number>();
beforeAll(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'xianyu-verification-availability-'));
  vite = await createServer({ configFile: false, root: resolve(import.meta.dirname, '../../..'), cacheDir,
    plugins: [react(), { name: 'verification-availability-test',
      resolveId(id) { if (id === '/__availability-entry.js') return id; },
      load(id) { if (id === '/__availability-entry.js') return entry; },
      configureServer(server) {
        server.middlewares.use('/_availability/', (request, response) => {
          const key = request.url!.split('/')[1], mode = key.split('--')[0], count = (requests.get(key) ?? 0) + 1;
          requests.set(key, count);
          const disabled = mode === 'disabled' || mode === 'disable-on-retry' && count > 1;
          const recovered = mode === 'recover' && count > 1 || mode === 'active';
          response.statusCode = recovered ? 200 : mode === 'missing' ? 404 : disabled || mode === 'outage' ? 503 : 500;
          response.setHeader('Content-Type', 'application/json');
          const reply = () => response.end(JSON.stringify(recovered ? { success: true, data: { sessions: [], serverTime: Date.now() } }
            : { success: false, error: { code: disabled ? 'VERIFICATION_DISABLED' : 'UPSTREAM_UNAVAILABLE', message: 'controlled availability response' } }));
          if (mode === 'recover' && count > 1) setTimeout(reply, 250); else reply();
        });
        server.middlewares.use('/__availability.html', async (request, response, next) => {
          try {
            const html = await server.transformIndexHtml(request.url ?? '/', '<div id="root"></div><script type="module" src="/__availability-entry.js"></script>');
            response.setHeader('Content-Type', 'text/html'); response.end(html);
          } catch (error) { next(error); }
        });
      },
    }], server: { host: '127.0.0.1', port: 0 } });
  await vite.listen(); baseUrl = vite.resolvedUrls!.local[0];
  browser = await chromium.launch({ channel: 'chrome', headless: true });
}, 30_000);
afterAll(async () => {
  await Promise.allSettled([browser?.close(), vite?.close()]);
  if (cacheDir) {
    const path = resolve(cacheDir);
    if (dirname(path) !== resolve(tmpdir()) || !basename(path).startsWith('xianyu-verification-availability-')) throw Error('Unsafe availability test cleanup');
    await rm(path, { recursive: true, force: true });
  }
});
async function pageFor(mode: string, viewport = { width: 1440, height: 900 }): Promise<{ page: Page; key: string }> {
  const page = await browser.newPage({ viewport }), key = `${mode}--${++nextKey}`;
  const response = page.waitForResponse(value => value.url().includes('/_availability/'));
  await page.goto(`${baseUrl}__availability.html?key=${key}`); await response;
  await page.locator('html[data-http-settled="true"]').waitFor();
  return { page, key };
}
it.each(['disabled', 'missing'])('silently hides an unavailable feature (%s) without opening a socket', async mode => {
  const { page, key } = await pageFor(mode);
  try {
    expect(await page.locator('.verification-entry').count()).toBe(0);
    expect(await page.locator('.verification-modal').count()).toBe(0);
    expect(await page.getByTestId('enabled').textContent()).toBe('false');
    expect(await page.locator('html').getAttribute('data-sockets')).toBeNull();
    expect(requests.get(key)).toBe(1);
  } finally { await page.close(); }
}, 30_000);
it.each([{ width: 1440, height: 900 }, { width: 390, height: 844 }])('keeps real 503 errors visible but dismissible at $width px', async viewport => {
  const { page } = await pageFor('outage', viewport);
  try {
    await page.getByText('验证状态暂不可用，请刷新后重试。', { exact: true }).waitFor();
    const geometry = await page.locator('.verification-entry').evaluate(element => {
      const box = element.getBoundingClientRect(), close = element.querySelector('.icon-button')!.getBoundingClientRect();
      return { left: box.left, right: box.right, width: innerWidth, closeWidth: close.width, closeHeight: close.height };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(geometry.width);
    expect(geometry.closeWidth).toBe(32); expect(geometry.closeHeight).toBe(32);
    await page.screenshot({ path: join(tmpdir(), `xianyu-verification-notice-${viewport.width}.png`) });
    await page.getByRole('button', { name: '关闭验证提示', exact: true }).click();
    await page.locator('.verification-entry').waitFor({ state: 'detached' });
    expect(await page.getByTestId('enabled').textContent()).toBe('false');
  } finally { await page.close(); }
}, 30_000);
it('retries once, disables the pending retry and clears the error after recovery', async () => {
  const { page, key } = await pageFor('recover');
  try {
    const retry = page.getByRole('button', { name: '重试连接', exact: true }); await retry.click();
    expect(await page.getByRole('button', { name: '连接中…', exact: true }).isEnabled()).toBe(false);
    await expect.poll(() => page.getByTestId('enabled').textContent()).toBe('true');
    expect(await page.locator('.verification-entry').count()).toBe(0); expect(requests.get(key)).toBe(2);
    expect(await page.locator('html').getAttribute('data-sockets')).toBe('1');
  } finally { await page.close(); }
}, 30_000);
it('clears a stale error if a retry reports the feature was disabled', async () => {
  const { page, key } = await pageFor('disable-on-retry');
  try {
    await page.getByRole('button', { name: '重试连接', exact: true }).click();
    await expect.poll(() => requests.get(key)).toBe(2);
    await page.locator('.verification-entry').waitFor({ state: 'detached' });
    expect(await page.getByTestId('enabled').textContent()).toBe('false');
    expect(await page.locator('html').getAttribute('data-sockets')).toBeNull();
  } finally { await page.close(); }
}, 30_000);
it('dismissing the entry retains its session and a new round is announced again', async () => {
  const { page } = await pageFor('active');
  try {
    await expect.poll(() => page.getByTestId('enabled').textContent()).toBe('true');
    await page.getByRole('button', { name: '新增验证', exact: true }).click();
    await page.getByRole('button', { name: '收起验证弹窗', exact: true }).click();
    await page.getByRole('button', { name: '关闭验证提示', exact: true }).click();
    expect(await page.locator('.verification-entry').count()).toBe(0);
    await page.getByRole('button', { name: '新增验证', exact: true }).click();
    await page.getByRole('button', { name: '收起验证弹窗', exact: true }).click();
    expect(await page.locator('.verification-entry').innerText()).toContain('2 个验证处理中');
  } finally { await page.close(); }
}, 30_000);
