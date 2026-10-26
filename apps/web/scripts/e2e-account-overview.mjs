import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { chromium } from 'patchright';
import { fixture } from '../../api/scripts/invite-registration/test-support.mjs';

// Real application, HTTP, session/CSRF, and an isolated PostgreSQL database.
// No external account, CAPTCHA, real message, or real publish operation.
const f = await fixture('postgres', { XIANYU_VERIFICATION_REMOTE_ENABLED: 'true', XIANYU_VERIFICATION_NATIVE_ENABLED: 'true' });
const evidence = join(tmpdir(), 'xianyu-account-overview-20261026');
let vite, browser, activePage;
const wait = async (read, check, label) => {
  const until = Date.now() + 15_000;
  while (Date.now() < until) { const value = await read(); if (check(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error(`Timed out: ${label}`);
};
try {
  const admin = await f.actor('overview-ui@example.com');
  const primary = await f.runtime.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'overview-primary', displayName: '逐星智能' });
  const secondary = await f.runtime.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'overview-secondary', displayName: '第二个账号名称很长用于检查窄屏显示完整而不被截断ABCDEFGHIJKLMNOPQRSTUVWXYZ' });
  await f.runtime.store.recordAccountDegraded({ adminId: admin.id, accountId: primary.id, source: 'im' });
  await f.runtime.store.setAccountTransport({ adminId: admin.id, accountId: primary.id, status: 'connected' });
  await f.runtime.store.recordAccountRisk({ adminId: admin.id, accountId: secondary.id, source: 'im_listener', code: 'RGV587' });
  for (const account of [primary, secondary]) await f.runtime.autoReplyAgentSettings.update({ adminId: admin.id, accountId: account.id,
    expectedVersion: 0, patch: { enabled: true }, requestId: 'overview-e2e', traceId: 'overview-e2e' });
  process.env.VITE_API_MODE = 'live'; process.env.VITE_API_PROXY_TARGET = f.origin;
  vite = await createServer({ root: join(import.meta.dirname, '..'), server: { host: '127.0.0.1', port: 0 } }); await vite.listen();
  const web = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(admin.cookie.split('; ').map(pair => { const i = pair.indexOf('='); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: web }; }));
  await context.addInitScript(id => localStorage.setItem('xianyu.activeAccountId', id), primary.id);
  const page = await context.newPage(), errors = []; activePage = page; page.on('pageerror', error => errors.push(error.message));
  const accountRow = name => page.getByRole('table', { name: '账号列表' }).getByRole('row').filter({ hasText: name });
  await page.goto(web + '/accounts'); await accountRow('逐星智能').waitFor();
  assert.match(await accountRow('逐星智能').innerText(), /部分功能异常/);
  assert.match(await accountRow('逐星智能').innerText(), /消息已连接/);
  assert.match(await accountRow('逐星智能').innerText(), /已启用/);
  assert.equal(await page.getByRole('columnheader').count(), 6);
  assert.equal(await page.getByRole('columnheader', { name: '凭证引用' }).count(), 0);
  const current = page.getByTestId('current-account-card');
  assert.match(await current.innerText(), /逐星智能/); assert.doesNotMatch(await current.innerText(), /账号上下文/);
  const nav = page.getByRole('navigation', { name: '主导航' });
  await nav.getByRole('button', { name: '设置', exact: false }).click();
  const toggle = page.getByRole('checkbox', { name: '启用自动回复 Agent' }); await toggle.waitFor(); assert.equal(await toggle.isChecked(), true);
  await toggle.uncheck(); await page.getByRole('button', { name: '保存自动回复 Agent 配置', exact: true }).click();
  await wait(() => f.runtime.store.getAutoReplyAgentConfig(admin.id, primary.id), data => data?.enabled === false, 'persist disabled config');
  await nav.getByRole('button', { name: '账号管理', exact: false }).click();
  await wait(() => accountRow('逐星智能').innerText(), text => text.includes('未启用'), 'list follows saved off switch');
  await nav.getByRole('button', { name: '设置', exact: false }).click(); await toggle.waitFor(); assert.equal(await toggle.isChecked(), false);
  await toggle.check(); await page.getByRole('button', { name: '保存自动回复 Agent 配置', exact: true }).click();
  await wait(() => f.runtime.store.getAutoReplyAgentConfig(admin.id, primary.id), data => data?.enabled === true, 'persist enabled config');
  await nav.getByRole('button', { name: '账号管理', exact: false }).click();
  await wait(() => accountRow('逐星智能').innerText(), text => text.includes('已启用'), 'list follows saved on switch');
  await page.getByRole('searchbox', { name: '搜索账号' }).fill('第二个'); await accountRow('第二个账号').waitFor();
  assert.match(await current.innerText(), /逐星智能/, 'filtering does not change the current account card');
  await page.getByRole('searchbox', { name: '搜索账号' }).fill(''); await accountRow('逐星智能').waitFor();
  await accountRow('第二个账号').getByTestId('account-switch').click();
  await wait(() => current.innerText(), text => text.includes(secondary.displayName), 'current account switched');
  for (const close of await page.getByRole('button', { name: '关闭提示', exact: true }).all()) await close.click();
  await mkdir(evidence, { recursive: true }); const geometry = [];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const row = accountRow('第二个账号');
    const action = await row.locator('.accounts-domain-row-actions').evaluate(element => {
      const buttons = Array.from(element.querySelectorAll('button')), boxes = buttons.map(button => button.getBoundingClientRect());
      return { buttons: buttons.map(b => b.textContent), tops: boxes.map(b => b.top), height: element.getBoundingClientRect().height,
        overflow: element.scrollWidth - element.clientWidth, widths: boxes.map(b => b.width) };
    });
    assert.equal(action.buttons.length, 4); assert.ok(Math.max(...action.tops) - Math.min(...action.tops) < 1);
    assert.equal(action.overflow, 0); assert.ok(action.height <= 33);
    const card = await current.evaluate(element => ({ overflow: element.scrollWidth - element.clientWidth, name: element.querySelector('.accounts-current-name').textContent }));
    assert.equal(card.overflow, 0); assert.equal(card.name, secondary.displayName);
    const nameCell = await row.locator('.accounts-domain-account-cell').evaluate(element => {
      const name = element.querySelector('strong'), cell = element.getBoundingClientRect();
      return { overflow: element.scrollWidth - element.clientWidth, width: name.clientWidth, clipped: name.scrollWidth > name.clientWidth,
        right: name.getBoundingClientRect().right, cellRight: cell.right };
    });
    assert.equal(nameCell.overflow, 0); assert.ok(nameCell.width > 0 && nameCell.clipped); assert.ok(nameCell.right <= nameCell.cellRight + 1);
    if (width === 390) {
      assert.ok((await page.getByRole('searchbox', { name: '搜索账号' }).boundingBox()).width >= 200);
      for (const filter of ['账号状态筛选', '消息连接筛选']) assert.ok((await page.getByRole('combobox', { name: filter }).boundingBox()).width >= 120);
    }
    const authorize = row.getByRole('button', { name: '授权', exact: true });
    await authorize.scrollIntoViewIfNeeded();
    const reachability = await authorize.evaluate(element => {
      const button = element.getBoundingClientRect(), scroll = element.closest('.accounts-domain-table-scroll');
      return { scrollHeight: scroll.clientHeight, buttonTop: button.top, buttonBottom: button.bottom, viewport: innerHeight,
        pageOverflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert.ok(reachability.scrollHeight > 80, 'the list must have a usable visible scroll region');
    assert.ok(reachability.buttonTop >= 0 && reachability.buttonBottom <= height, 'row actions are reachable within the viewport');
    assert.equal(reachability.pageOverflow, 0, 'only the table may scroll horizontally');
    await page.screenshot({ path: join(evidence, `accounts-${width}.png`), fullPage: true });
    geometry.push({ width, action, card, nameCell, reachability });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await accountRow('逐星智能').getByTestId('account-switch').click();
  await wait(() => current.innerText(), text => text.includes(primary.displayName), 'restore primary account');
  await page.screenshot({ path: join(evidence, 'accounts-final.png') });
  await nav.getByRole('button', { name: '商品管理', exact: false }).click(); await page.getByTestId('publish-product').click();
  const description = page.getByRole('textbox', { name: '商品描述', exact: true }); await description.waitFor();
  const composer = page.getByTestId('product-publish-composer');
  const style = async label => {
    await description.evaluate(element => Promise.all(element.closest('.product-publish-composer').getAnimations().map(animation => animation.finished)));
    const view = await description.evaluate(element => { const s = getComputedStyle(element), outer = getComputedStyle(element.closest('.product-publish-composer'));return { border: s.borderWidth, shadow: s.boxShadow, outline: s.outlineWidth, outerBorder: outer.borderWidth, outerColor: outer.borderColor, outerShadow: outer.boxShadow }; });
    assert.equal(view.border, '0px', label); assert.equal(view.shadow, 'none', label); assert.equal(view.outerBorder, '1px', label); return { label, ...view };
  };
  const borders = [await style('idle')]; await description.hover(); borders.push(await style('hover'));
  await description.focus(); borders.push(await style('focus')); assert.notEqual(borders.at(-1).outerShadow, 'none');
  await description.fill('测试商品描述'); assert.equal(await description.inputValue(), '测试商品描述');
  await page.screenshot({ path: join(evidence, 'product-description-normal.png') });
  await page.getByRole('button', { name: '发布到闲鱼', exact: true }).click();
  await wait(() => composer.getAttribute('data-invalid'), value => value === 'true', 'missing attachment error');
  await description.focus(); borders.push(await style('invalid focus'));
  assert.equal(await description.getAttribute('aria-invalid'), 'true');
  await page.screenshot({ path: join(evidence, 'product-description-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await description.scrollIntoViewIfNeeded();
  borders.push(await style('mobile invalid focus')); await page.screenshot({ path: join(evidence, 'product-description-mobile.png') });
  // Native disabled CSS, paired with the component's disabled-prop regression.
  await description.evaluate(element => { element.disabled = true; });
  try { assert.equal(await description.isDisabled(), true); borders.push(await style('disabled invalid')); }
  finally { await description.evaluate(element => { element.disabled = false; }); }
  await page.getByRole('button', { name: '关闭发布商品', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await nav.getByRole('button', { name: '账号管理', exact: false }).click();
  await page.getByRole('button', { name: '添加闲鱼账号', exact: true }).click();
  await page.getByRole('tab', { name: /手动输入 Cookie/ }).click();
  const cookieInput = page.getByRole('textbox', { name: '完整 Cookie' }); await cookieInput.waitFor();
  await cookieInput.focus();
  const unrelatedTextarea = await cookieInput.evaluate(element => ({ border: getComputedStyle(element).borderWidth, focus: document.activeElement === element }));
  assert.equal(unrelatedTextarea.border, '1px', 'the shared textarea keeps its own border outside the composer');
  assert.equal(unrelatedTextarea.focus, true);
  await page.getByRole('button', { name: '关闭登录弹窗', exact: true }).click();
  assert.equal(errors.length, 0, errors.join('\n'));
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ status: 'PASS', scope: 'real React/HTTP/isolated PostgreSQL; no external publish or CAPTCHA', geometry, borders, unrelatedTextarea }, null, 2));
  console.log('Account overview settings roundtrip, four actions, current card, and single-border composer PASS');
  console.log(`Evidence: ${evidence}`);
} catch (error) {
  await mkdir(evidence, { recursive: true });
  if (activePage) { await activePage.screenshot({ path: join(evidence, 'failure.png') }); await writeFile(join(evidence, 'failure.txt'), await activePage.locator('body').innerText()); }
  throw error;
} finally { await browser?.close(); await vite?.close(); await f.close(); }
