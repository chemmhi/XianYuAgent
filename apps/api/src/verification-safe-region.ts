import type { Frame, Locator } from 'patchright';

const SAFE_OUTERS = '#nocaptcha,.nc_wrapper,[id^="nc_"][id$="_wrapper"],.scratch-captcha,.captcha-wrapper,.captcha-container,#captcha-container,#baxia-dialog-content,.baxia-dialog-content';
const REQUIRED_CONTROLS = '#nc_1_refresh1,.btn_refresh,.errloading,[class*="captcha-refresh"],[id*="captcha-refresh"]';
/** Known NC reset controls, always scoped to an already identified NC container. */
export const VERIFICATION_NC_REFRESH_CONTROLS = '#nc_1_refresh1,.nc_wrapper > .errloading,.nc_iconfont.btn_refresh';
export interface VerificationRegionBox { x: number; y: number; width: number; height: number }
export type VerificationRegionKind = 'challenge_document' | 'challenge_container' | 'slider_component';

function dedicatedPunish(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password
      && ['www.goofish.com', 'h5api.m.goofish.com', 'punish.goofish.com', 'captcha.goofish.com'].includes(url.hostname)
      && (/^\/(?:_____tmd_____\/)?punish\/?$/.test(url.pathname)
        || /^\/{1,2}h5\/mtop\.[a-z0-9.]+\/[0-9]+(?:\.[0-9]+)*\/_____tmd_____\/punish\/?$/.test(url.pathname));
  } catch { return false; }
}

/** A larger ROI needs both a known boundary and a challenge-only DOM. */
async function challengeOnly(candidate: Locator): Promise<boolean> {
  return candidate.evaluate((root, requiredControls) => {
    if (root.matches('[data-private],[data-sensitive],.conversation,.message-list,.chat-messages') || root.querySelector('textarea,input:not([type="hidden"]),[contenteditable="true"],video,audio,[data-private],[data-sensitive],.conversation,.message-list,.chat-messages')) return false;
    const elements = [root, ...root.querySelectorAll('*')];
    if (elements.length > 500) return false;
    for (const element of elements) {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      if (style.visibility === 'hidden' || style.display === 'none' || rect.width <= 0 || rect.height <= 0 || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH'].includes(element.tagName)) continue;
      const text = Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent ?? '').join('').trim();
      if (element.matches('.nc-errcode') && element.closest('.nc-container .errloading') && /^\((?:error:)?\d{1,4}\)$/.test(text)) continue;
      if (text && !/验证|滑|拖|安全|重试|刷新|拼图|请|闲鱼|阿里|反馈|帮助|网络|出错|错误|失败|成功|完成|通过|加载|检测|异常|松开|再试|哎哟|captcha|verif|secur|retry|refresh|slide|drag|loading|help|error|failed|success/i.test(text)
        && !/^[\s\p{P}\p{S}\p{Co}]+$/u.test(text)) return false;
      if (['BUTTON', 'A', 'INPUT'].includes(element.tagName) && !element.matches(requiredControls)
        && !element.closest('.nc-container,#nocaptcha,.nc_wrapper,.scratch-captcha,.scratch-captcha-slider')
        && !/重试|刷新|反馈|帮助|retry|refresh|help/i.test(element.textContent ?? '')) return false;
    }
    return true;
  }, REQUIRED_CONTROLS).catch(() => false);
}

async function regionBox(candidate: Locator): Promise<VerificationRegionBox | undefined> {
  const box = await candidate.boundingBox();
  if (!box) return undefined;
  // Keep an already bounded native component intact. A full-width layout
  // wrapper instead uses only verified, painted challenge content.
  const painted = await candidate.evaluate(root => {
    const boxes: DOMRect[] = [];
    const parent = root.getBoundingClientRect();
    for (const element of [root, ...root.querySelectorAll('*')]) {
      const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
      if (style.visibility === 'hidden' || style.display === 'none' || bounds.width <= 0 || bounds.height <= 0 || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(element.tagName)) continue;
      const before = getComputedStyle(element, '::before'), after = getComputedStyle(element, '::after');
      const pseudo = [before, after].some(style => style.display !== 'none' && (style.backgroundImage !== 'none' || !['none', 'normal', '""', "''"].includes(style.content)));
      if (element.matches('button,a,img,canvas,svg,#nc_1_n1t,.nc_scale,.slider-track,.track')
        || element.matches('.nc-container,#nocaptcha,.scratch-captcha,.scratch-captcha-slider') && bounds.width <= 640 && bounds.height <= 480
        || style.backgroundImage !== 'none' || pseudo) {
        // A known oversized painting cannot simply disappear from the crop.
        // Pseudo-element geometry is conservatively bounded by its parent;
        // transformed/overflowing pseudo content is unsupported.
        if (bounds.width > 640 || bounds.height > 480 || pseudo && [before, after].some(style => style.transform !== 'none'
          || [style.left, style.top, style.right, style.bottom].some(offset => Number.parseFloat(offset) < 0)
          || Number.parseFloat(style.width) > bounds.width || Number.parseFloat(style.height) > bounds.height
          || Number.parseFloat(style.left) + Number.parseFloat(style.width) > bounds.width || Number.parseFloat(style.top) + Number.parseFloat(style.height) > bounds.height)) return undefined;
        if (bounds.left < parent.left - 1 || bounds.top < parent.top - 1 || bounds.right > parent.right + 1 || bounds.bottom > parent.bottom + 1) return undefined;
        boxes.push(bounds);
      }
      for (const node of element.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        const range = document.createRange(); range.selectNodeContents(node); const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (rect.left < parent.left - 1 || rect.top < parent.top - 1 || rect.right > parent.right + 1 || rect.bottom > parent.bottom + 1)) return undefined;
        if (rect.width > 0 && rect.height > 0) boxes.push(rect);
      }
    }
    if (!boxes.length) return undefined;
    const left = Math.max(parent.left, Math.min(...boxes.map(rect => rect.left)) - 8);
    const top = Math.max(parent.top, Math.min(...boxes.map(rect => rect.top)) - 8);
    const right = Math.min(parent.right, Math.max(...boxes.map(rect => rect.right)) + 8);
    const bottom = Math.min(parent.bottom, Math.max(...boxes.map(rect => rect.bottom)) + 8);
    return { left, top, width: right - left, height: bottom - top, parent: { left: parent.left, top: parent.top, width: parent.width, height: parent.height } };
  }).catch(() => undefined);
  if (!painted || painted.width < 40 || painted.height < 15 || painted.width > 640 || painted.height > 480) return undefined;
  if (box.width <= 640 && box.height <= 480) return box;
  const sx = box.width / Math.max(1, painted.parent.width), sy = box.height / Math.max(1, painted.parent.height);
  return { x: box.x + (painted.left - painted.parent.left) * sx, y: box.y + (painted.top - painted.parent.top) * sy, width: painted.width * sx, height: painted.height * sy };
}

async function missingRequiredUi(candidate: Locator): Promise<boolean> {
  return candidate.evaluate((root, controls) => {
    const required = Array.from(document.querySelectorAll(controls));
    if (required.some(element => !root.contains(element) && element.getBoundingClientRect().width > 0)) return true;
    for (const element of document.querySelectorAll('*')) {
      if (root.contains(element) || element.contains(root)) continue;
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden') continue;
      if (element.matches('img,canvas,svg') || style.backgroundImage !== 'none'
        || ['::before', '::after'].some(pseudo => { const style = getComputedStyle(element, pseudo); return style.backgroundImage !== 'none' || !['none', 'normal', '""', "''"].includes(style.content); })) return true;
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode; const parent = node.parentElement;
      if (!parent || root.contains(parent) || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) continue;
      if (/验证|滑块|拖动|重试|刷新|captcha|verif|retry|refresh/i.test(node.textContent ?? '')
        && parent.getBoundingClientRect().width > 0 && getComputedStyle(parent).display !== 'none') return true;
    }
    return false;
  }, REQUIRED_CONTROLS).catch(() => true);
}


export async function verificationSafeRegion(frame: Frame, slider: Locator): Promise<{ locator: Locator; kind: VerificationRegionKind; box: VerificationRegionBox } | undefined> {
  const ancestors = await slider.locator('xpath=ancestor-or-self::*').all();
  const candidates: Locator[] = [];
  for (const ancestor of ancestors) if (await ancestor.evaluate((element, selectors) => element.matches(selectors), SAFE_OUTERS).catch(() => false)) candidates.push(ancestor);
  // Largest explicitly named component first; never expand to an unnamed
  // business-page ancestor merely because it contains the slider.
  if (dedicatedPunish(frame.url())) {
    const body = frame.locator('body');
    const bodyBox = await body.boundingBox();
    if (bodyBox && bodyBox.width >= 80 && bodyBox.height >= 80 && await missingRequiredUi(slider) && await challengeOnly(body)) { const box = await regionBox(body); if (!box) return undefined; if (box.width >= 80 && box.height >= 80) return { locator: body, kind: 'challenge_document', box }; }
  }
  for (const candidate of candidates) {
    if (await challengeOnly(candidate) && !await missingRequiredUi(candidate)) { const box = await regionBox(candidate); return box ? { locator: candidate, kind: 'challenge_container', box } : undefined; }
  }
  // A self-contained slider remains supported only when it is complete.
  const incomplete = await missingRequiredUi(slider);
  if (incomplete || !await challengeOnly(slider)) return undefined;
  const box = await regionBox(slider);
  return box ? { locator: slider, kind: 'slider_component', box } : undefined;
}

/** A top-page screenshot is composited: iframe trust alone does not prove
 * ownership of pixels covered by an unrelated parent/sibling overlay. */
export async function verificationPixelsOwned(frame: Frame, region: Locator, crop: VerificationRegionBox): Promise<boolean> {
  let target = region;
  for (let current: Frame | null = frame; current; current = current.parentFrame()) {
    const box = await target.boundingBox(); if (!box) return false;
    const safe = await target.evaluate((root, input) => {
      const rect = root.getBoundingClientRect();
      const sx = input.box.width / Math.max(1, rect.width), sy = input.box.height / Math.max(1, rect.height);
      const left = rect.left + (input.crop.x - input.box.x) / sx, top = rect.top + (input.crop.y - input.box.y) / sy;
      const right = left + input.crop.width / sx, bottom = top + input.crop.height / sy;
      for (const element of document.querySelectorAll('*')) {
        if (root.contains(element)) continue;
        if (element.contains(root)) {
          // Ancestor backgrounds sit behind the child, but their generated
          // overlays may be composited above it without receiving pointers.
          if (['::before', '::after'].some(pseudo => { const style = getComputedStyle(element, pseudo); return style.display !== 'none' && (style.backgroundImage !== 'none' || !['none', 'normal', '""', "''"].includes(style.content)); })) return false;
          continue;
        }
        const style = getComputedStyle(element), r = element.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
        const x = Math.max(left, r.left), y = Math.max(top, r.top), endX = Math.min(right, r.right), endY = Math.min(bottom, r.bottom);
        if (endX <= x || endY <= y) continue;
        const hit = document.elementFromPoint((x + endX) / 2, (y + endY) / 2);
        // Outside painted content with pointer-events:none is equally private.
        if (!hit || !root.contains(hit) || style.pointerEvents === 'none' && (element.matches('img,canvas,svg,video,iframe,object,embed') || element.textContent?.trim() || style.backgroundImage !== 'none' || !['rgba(0, 0, 0, 0)', 'transparent'].includes(style.backgroundColor)
          || ['::before', '::after'].some(pseudo => { const style = getComputedStyle(element, pseudo); return style.backgroundImage !== 'none' || !['none', 'normal', '""', "''"].includes(style.content); }))) return false;
      }
      return true;
    }, { box, crop }).catch(() => false);
    if (!safe) return false;
    if (current.parentFrame()) target = await current.frameElement() as unknown as Locator;
  }
  return true;
}

/** Locators report top-page coordinates, but an iframe clips its own children. */
export async function verificationFrameBounds(frame: Frame, topViewport: { width: number; height: number }) {
  let bounds = { x: 0, y: 0, width: topViewport.width, height: topViewport.height };
  for (let current: Frame | null = frame; current?.parentFrame(); current = current.parentFrame()) {
    const element = await current.frameElement(); const box = await element.boundingBox();
    if (!box) return undefined;
    const axisAligned = await element.evaluate(root => {
      for (let node: Element | null = root as Element; node; node = node.parentElement) {
        const value = getComputedStyle(node).transform;
        if (value === 'none') continue;
        const matrix = new DOMMatrixReadOnly(value);
        if (!matrix.is2D || Math.abs(matrix.b) > .0001 || Math.abs(matrix.c) > .0001 || matrix.a <= 0 || matrix.d <= 0) return false;
      }
      return true;
    }).catch(() => false);
    if (!axisAligned) return undefined;
    const metrics = await element.evaluate(node => { const element = node as HTMLElement; return { left: element.clientLeft, top: element.clientTop, width: element.clientWidth, height: element.clientHeight, outerWidth: element.offsetWidth, outerHeight: element.offsetHeight }; });
    const sx = box.width / Math.max(1, metrics.outerWidth), sy = box.height / Math.max(1, metrics.outerHeight);
    const x = Math.max(bounds.x, box.x + metrics.left * sx), y = Math.max(bounds.y, box.y + metrics.top * sy);
    bounds = { x, y, width: Math.min(bounds.x + bounds.width, box.x + (metrics.left + metrics.width) * sx) - x,
      height: Math.min(bounds.y + bounds.height, box.y + (metrics.top + metrics.height) * sy) - y };
    if (bounds.width <= 0 || bounds.height <= 0) return undefined;
  }
  return bounds;
}
