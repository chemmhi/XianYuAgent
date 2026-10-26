import type { Frame, Locator } from 'patchright';
import type { VerificationRegionBox } from './verification-safe-region.js';
import { VERIFICATION_CSS_PROPERTIES, VERIFICATION_DIAGNOSTIC_TAGS } from './verification-render-diagnostics.js';

interface Rect { x: number; y: number; width: number; height: number }
interface Observation { revision: number; slider: Element; observer: MutationObserver; bindingsStale?: boolean; lastChange?: 'STYLE' | 'CLASS' | 'STRUCTURE' | 'TEXT' | 'ATTRIBUTE'; attributeDiagnosis?: string; prepareTelemetry?: () => void; animationsCurrent?: () => boolean }
interface BrowserState { __verificationInputObservations?: WeakMap<Element, Observation> }
interface InputSnapshotPart {
  region: Locator; selector?: string; revision: number; root: Rect; slider: Rect; crop: VerificationRegionBox;
  url: string; viewport: number[]; metrics: number[];
}
export interface VerificationInputSnapshot { revision: string; parts: InputSnapshotPart[] }

/** Each document contributes its own node/geometry/occlusion fence. No
 * cross-origin parent state is guessed from the child document. */
export async function verificationInputSnapshot(frame: Frame, region: Locator, selector: string, crop: VerificationRegionBox): Promise<VerificationInputSnapshot | undefined> {
  const parts: InputSnapshotPart[] = []; let target = region;
  for (let current: Frame | null = frame; current; current = current.parentFrame()) {
    const part = await inputSnapshotPart(target, current === frame ? selector : undefined, crop);
    if (!part) return undefined; parts.push(part);
    if (current.parentFrame()) target = await current.frameElement() as unknown as Locator;
  }
  return { revision: JSON.stringify(parts.map(({ revision, url, viewport, metrics, root, slider }) => ({ revision, url, viewport, metrics, root, slider }))), parts };
}
async function inputSnapshotPart(region: Locator, selector: string | undefined, crop: VerificationRegionBox): Promise<InputSnapshotPart | undefined> {
  const box = await region.boundingBox(); if (!box) return undefined;
  const value = await region.evaluate((root, { selector, box, crop, cssProperties, diagnosticTags }) => {
    const slider = selector ? document.querySelector(selector) : root; if (!slider || !root.contains(slider)) return undefined;
    const state = globalThis as typeof globalThis & BrowserState;
    state.__verificationInputObservations ??= new WeakMap();
    let observation = state.__verificationInputObservations.get(root);
    if (!observation || observation.slider !== slider || observation.bindingsStale) {
      observation?.observer.disconnect();
      // Capture exact existing native nodes. A matching descendant added or
      // revealed later never inherits this exemption, nor does an arbitrary
      // class/style change on a native node.
      const moving = new Map<Element, { properties: string[]; stable: Array<[string, string, string]> }>();
      for (const element of slider.querySelectorAll('#nc_1_n1z,.btn_slide,#scratch-captcha-btn,.scratch-captcha-slider .button,.nc_bg,[id^="nc_"][id$="__bg"],.nc_scale')) {
        const handle = element.matches('#nc_1_n1z,.btn_slide,#scratch-captcha-btn,.scratch-captcha-slider .button');
        if (!handle && element.matches('.nc_scale') && (element.childElementCount || element.textContent?.trim())) continue;
        const style = (element as HTMLElement).style, properties = handle ? ['left', 'transform'] : ['width'];
        moving.set(element, { properties, stable: Array.from(style).filter(property => !properties.includes(property)).map(property => [property, style.getPropertyValue(property), style.getPropertyPriority(property)]) });
      }
      // Reset controls receive tracking only, never native motion exemptions.
      const refresh = new Set<Element>();
      if (slider.matches('.nc-container')) for (const element of slider.querySelectorAll('#nc_1_refresh1,.nc_wrapper > .errloading,.nc_iconfont.btn_refresh')) {
        if (!element.closest('.nc-container')?.isSameNode(slider)) continue;
        refresh.add(element);
        if (element.matches('.errloading')) for (const child of element.querySelectorAll('.nc-lang-cnt[data-nc-lang="SLIDE"],.nc_iconfont.icon_warn,.nc-errcode')) refresh.add(child);
      }
      // A new safely parsed frame may bind native replacement controls. Keep
      // the revision monotonic so this cannot validate any previously sent frame.
      const record: Observation = { revision: observation?.revision ?? 0, lastChange: observation?.lastChange,
        attributeDiagnosis: observation?.attributeDiagnosis, slider, observer: undefined as unknown as MutationObserver };
      // The real NC mousedown adds APLUS tracking to its existing handle.
      // Arm exactly one such write immediately before native down, after
      // hover. Compare all document styles, pseudo styles and element boxes:
      // CSS attribute selectors must not reveal or repaint other content.
      let telemetry: { nodes: Element[]; paint: string; animations: Animation[]; expires: number } | undefined;
      let armFailure: 'NODES' | undefined;
      // Bind the existing native instruction and its existing animation at
      // snapshot creation. Later matching nodes/animations cannot inherit it.
      const shimmerNode = slider.querySelector('.scale_text.slidetounlock > span[data-nc-lang="SLIDE"]');
      const shimmerParent = shimmerNode?.parentElement;
      const shimmerAnimations = shimmerNode?.getAnimations() ?? [];
      const shimmerAnimation = shimmerAnimations.length === 1 && shimmerAnimations[0] instanceof CSSAnimation ? shimmerAnimations[0] : undefined;
      const shimmerEffect = shimmerAnimation?.effect instanceof KeyframeEffect ? shimmerAnimation.effect : undefined;
      const shimmerText = shimmerNode?.textContent, shimmerClass = shimmerParent?.getAttribute('class');
      const shimmerGradient = shimmerNode ? getComputedStyle(shimmerNode).backgroundImage : '';
      let shimmerDefinition: string | undefined;
      const rendering = { definition() {
          if (!shimmerNode || !shimmerParent || !shimmerAnimation || !shimmerEffect || !shimmerText?.trim()
            || !slider.matches('.nc-container') || !shimmerParent.matches('.scale_text.slidetounlock') || !slider.contains(shimmerParent)
            || shimmerNode.parentElement !== shimmerParent || shimmerParent.getAttribute('class') !== shimmerClass
            || shimmerNode.getAttribute('data-nc-lang') !== 'SLIDE' || shimmerNode.textContent !== shimmerText
            || !/^(?:-webkit-)?(?:linear-gradient|gradient)\(/.test(shimmerGradient) || getComputedStyle(shimmerNode).backgroundImage !== shimmerGradient
            || shimmerAnimation.animationName !== 'slidetounlock' || shimmerAnimation.effect !== shimmerEffect || shimmerEffect.target !== shimmerNode
            || shimmerAnimation.timeline !== document.timeline || typeof shimmerAnimation.startTime !== 'number' || !Number.isFinite(shimmerAnimation.startTime)
            || shimmerAnimation.playbackRate !== 1 || shimmerAnimation.playState !== 'running' || shimmerAnimation.pending
            || shimmerNode.getAnimations().length !== 1 || shimmerNode.getAnimations()[0] !== shimmerAnimation) return undefined;
          const timing = shimmerEffect.getTiming(), keyframes = shimmerEffect.getKeyframes();
          if (timing.duration !== 3000 || timing.iterations !== Infinity || timing.delay !== 0 || timing.endDelay !== 0
            || timing.iterationStart !== 0 || timing.direction !== 'normal' || timing.fill !== 'none'
            || !['linear', 'ease'].includes(timing.easing ?? '') || keyframes.length !== 2) return undefined;
          for (let index = 0; index < 2; index++) {
            const key = keyframes[index] as ComputedKeyframe & { backgroundPosition?: string; backgroundPositionX?: string; backgroundPositionY?: string };
            if (key.offset !== index || key.computedOffset !== index || !['ease', 'linear'].includes(key.easing)
              || !['auto', 'replace'].includes(key.composite)
              || Object.keys(key).some(property => !['offset', 'computedOffset', 'easing', 'composite', 'backgroundPosition', 'backgroundPositionX', 'backgroundPositionY'].includes(property))) return undefined;
            const x = index ? '200px' : '-200px';
            if (key.backgroundPosition ? ![`${x} 0px`, `${x} 0%`, `${x} 0`].includes(key.backgroundPosition)
              : key.backgroundPositionX !== x || !['0px', '0%', '0'].includes(key.backgroundPositionY ?? '')) return undefined;
          }
          return JSON.stringify([shimmerAnimation.startTime, shimmerAnimation.playbackRate, timing, keyframes]);
        }, paint(nodes: Element[]) {
          const normalizeShimmer = !!shimmerDefinition && this.definition() === shimmerDefinition;
          return JSON.stringify(nodes.map(element => {
          const rect = element.getBoundingClientRect();
          return [[rect.x, rect.y, rect.width, rect.height], ...[undefined, '::before', '::after'].map(pseudo => {
            const style = getComputedStyle(element, pseudo); return Array.from(style).map(property => normalizeShimmer && !pseudo && element === shimmerNode && property === 'background-position'
              ? '<native-shimmer-position>' : style.getPropertyValue(property));
          })];
        })); }, role(target: Element) {
          const native = moving.get(target);
          return refresh.has(target) ? 'REFRESH' : native ? native.properties.includes('left') ? 'HANDLE' : 'PROGRESS'
            : target === slider ? 'SLIDER' : target === root ? 'ROOT' : target.contains(root) ? 'ANCESTOR'
              : diagnosticTags.includes(target.tagName) ? `TAG_${target.tagName}` : 'OTHER';
        }, difference(before: string, after: string, nodes: Element[]) {
          const a = JSON.parse(before) as Array<Array<number[] | string[]>>, b = JSON.parse(after) as Array<Array<number[] | string[]>>;
          for (let i = 0; i < a.length; i++) {
            const role = this.role(nodes[i]);
            if (JSON.stringify(a[i][0]) !== JSON.stringify(b[i][0])) return `RECT_${role}`;
            for (let p = 1; p <= 3; p++) if (JSON.stringify(a[i][p]) !== JSON.stringify(b[i][p])) {
              const index = a[i][p].findIndex((value, index) => value !== b[i][p][index]);
              const property = getComputedStyle(nodes[i], [undefined, undefined, '::before', '::after'][p]).item(index);
              const category = cssProperties.includes(property) ? property.toUpperCase().replace(/-/g, '_')
                : !property.startsWith('--') && index >= 0 && index <= 1023 ? `OTHER_INDEX_${index}` : 'OTHER';
              const animation = nodes[i].getAnimations().length ? 'RUNNING' : 'NONE';
              return `${p === 1 ? 'STYLE' : 'PSEUDO'}_PROPERTY_${category}_NODE_${role}_ANIMATION_${animation}`;
            }
          }
          return 'UNREADABLE';
        } };
      const nativeAnimationDefinition = rendering.definition();
      record.animationsCurrent = () => {
        const animations = document.getAnimations();
        return animations.length === 0 || animations.length === 1 && animations[0] === shimmerAnimation
          && !!nativeAnimationDefinition && rendering.definition() === nativeAnimationDefinition;
      };
      record.prepareTelemetry = () => {
        const nodes = Array.from(document.querySelectorAll('*'));
        armFailure = undefined;
        if (nodes.length > 256) { telemetry = undefined; armFailure = 'NODES'; return; }
        shimmerDefinition = rendering.definition();
        telemetry = { nodes, paint: rendering.paint(nodes), animations: document.getAnimations(), expires: performance.now() + 500 };
      };
      record.observer = new MutationObserver(records => {
        for (const mutation of records) {
          let telemetryFailure: string | undefined;
          if (mutation.type === 'attributes' && mutation.attributeName === 'data-spm-anchor-id'
            && (moving.get(mutation.target as Element)?.properties.includes('left') || refresh.has(mutation.target as Element))) {
            if (!telemetry) telemetryFailure = armFailure ?? 'UNARMED';
            else {
              const guard = telemetry; telemetry = undefined;
              const nodes = Array.from(document.querySelectorAll('*'));
              try {
                if (performance.now() > guard.expires) telemetryFailure = 'LATE';
                else if (nodes.length !== guard.nodes.length || !nodes.every((node, index) => node === guard.nodes[index])) telemetryFailure = 'NODES';
                else {
                  const after = rendering.paint(nodes), animations = document.getAnimations();
                  if (after !== guard.paint) telemetryFailure = rendering.difference(guard.paint, after, nodes);
                  else if (animations.length !== guard.animations.length || !animations.every((animation, index) => animation === guard.animations[index])) telemetryFailure = 'ANIMATION';
                  else continue;
                }
              } catch { telemetryFailure = 'UNREADABLE'; }
            }
          }
          // Native drag updates the handle/progress styles for every move.
          // Structure/text, identity, ancestors and external styles remain
          // security relevant and trigger full safe-region parsing.
          if (mutation.type === 'attributes' && mutation.attributeName === 'style' && moving.has(mutation.target as Element)) {
            const target = mutation.target as HTMLElement, allowed = moving.get(target)!, style = target.style;
            const stable = Array.from(style).filter(property => !allowed.properties.includes(property)).map(property => [property, style.getPropertyValue(property), style.getPropertyPriority(property)]);
            const nativeMotionOnly = allowed.properties.every(property => {
              const value = style.getPropertyValue(property);
              if (!value || property === 'transform' && value === 'none') return true;
              if (property === 'transform') return /^translateX\(-?\d+(?:\.\d+)?px\)$/.test(value)
                || /^translate(?:3d)?\(-?\d+(?:\.\d+)?px,\s*0px(?:,\s*0px)?\)$/.test(value);
              return /^-?\d+(?:\.\d+)?px$/.test(value);
            });
            const box = target.getBoundingClientRect(), track = (target.parentElement?.closest('.nc_scale') ?? slider).getBoundingClientRect();
            if (nativeMotionOnly && JSON.stringify(stable) === JSON.stringify(allowed.stable)
              && box.left >= track.left - 1 && box.top >= track.top - 1 && box.right <= track.right + 1 && box.bottom <= track.bottom + 1) continue;
          }
          record.lastChange = mutation.type === 'childList' ? 'STRUCTURE' : mutation.type === 'characterData' ? 'TEXT'
            : mutation.attributeName === 'style' ? 'STYLE' : mutation.attributeName === 'class' ? 'CLASS' : 'ATTRIBUTE';
          // Diagnosis is a finite vocabulary, never an attribute value, DOM
          // identifier or arbitrary attribute name. It does not grant input.
          record.attributeDiagnosis = undefined;
          if (record.lastChange === 'ATTRIBUTE') {
            const attributes: Record<string, string> = { 'data-spm-anchor-id': 'SPM_ANCHOR_ID', 'data-aplus-ae': 'APLUS_AE', 'aria-grabbed': 'ARIA_GRABBED', 'aria-valuenow': 'ARIA_VALUENOW', 'aria-label': 'ARIA_LABEL', tabindex: 'TABINDEX', disabled: 'DISABLED', draggable: 'DRAGGABLE', title: 'TITLE', id: 'ID' };
            const target = mutation.target as Element, native = moving.get(target);
            const role = refresh.has(target) ? 'REFRESH' : native ? native.properties.includes('left') ? 'HANDLE' : 'PROGRESS'
              : target === slider ? 'SLIDER' : target === root ? 'ROOT' : target.contains(root) ? 'ANCESTOR' : 'OTHER';
            record.attributeDiagnosis = `${attributes[mutation.attributeName ?? ''] ?? 'OTHER'}_${role}${telemetryFailure ? `_GUARD_${telemetryFailure}` : ''}`;
          }
          record.revision++; record.bindingsStale = true; break;
        }
      });
      record.observer.observe(document.documentElement, { subtree: true, attributes: true, childList: true, characterData: true });
      observation = record; state.__verificationInputObservations.set(root, record);
    }
    const r = root.getBoundingClientRect(), s = slider.getBoundingClientRect();
    const sx = box.width / Math.max(1, r.width), sy = box.height / Math.max(1, r.height);
    const element = root as HTMLElement;
    return { revision: observation.revision, root: { x: r.x, y: r.y, width: r.width, height: r.height }, slider: { x: s.x, y: s.y, width: s.width, height: s.height },
      url: location.href, viewport: [innerWidth, innerHeight, scrollX, scrollY], metrics: [element.clientLeft, element.clientTop, element.clientWidth, element.clientHeight],
      crop: { x: r.x + (crop.x - box.x) / sx, y: r.y + (crop.y - box.y) / sy, width: crop.width / sx, height: crop.height / sy } };
  }, { selector, box, crop, cssProperties: VERIFICATION_CSS_PROPERTIES, diagnosticTags: [...VERIFICATION_DIAGNOSTIC_TAGS] as string[] }).catch(() => undefined);
  // Bind the actual node, not a re-resolving Locator. A detached/replaced root
  // must fail immediately instead of waiting the default 30s for a selector.
  const original = value && typeof region.elementHandle === 'function'
    ? await region.elementHandle({ timeout: 500 }).catch(() => undefined) : region;
  return value && original ? { region: original as unknown as Locator, selector, ...value } : undefined;
}

/** One browser round-trip checks the original nodes, geometry, document
 * changes and actual overlay ownership before each native input dispatch. */
export async function verificationInputSnapshotFailure(snapshot: VerificationInputSnapshot, prepareTelemetry = false): Promise<string | undefined> {
  for (const [index, part] of snapshot.parts.entries()) {
    const reason = await inputSnapshotPartFailure(part, prepareTelemetry && index === 0);
    if (reason) return `${reason}${index ? '_PARENT' : ''}`;
  }
}
async function inputSnapshotPartFailure(part: InputSnapshotPart, prepareTelemetry: boolean): Promise<string | undefined> {
  const { region, ...expected } = part;
  return region.evaluate((root, { expected, prepareTelemetry }) => {
    const state = globalThis as typeof globalThis & BrowserState, observation = state.__verificationInputObservations?.get(root);
    const slider = expected.selector ? document.querySelector(expected.selector) : root;
    if (!root.isConnected || !observation || !slider || observation.slider !== slider || !root.contains(slider)) return 'VERIFICATION_FRAME_STALE_CONTEXT';
    if (observation.revision !== expected.revision) return `VERIFICATION_FRAME_STALE_DOM_${observation.lastChange ?? 'ATTRIBUTE'}${observation.attributeDiagnosis ? `_${observation.attributeDiagnosis}` : ''}`;
    if (!observation.animationsCurrent?.()) return 'VERIFICATION_FRAME_STALE_DOM_STYLE';
    const element = root as HTMLElement;
    if (location.href !== expected.url) return 'VERIFICATION_FRAME_STALE_DOCUMENT';
    if (JSON.stringify([innerWidth, innerHeight, scrollX, scrollY]) !== JSON.stringify(expected.viewport)
      || JSON.stringify([element.clientLeft, element.clientTop, element.clientWidth, element.clientHeight]) !== JSON.stringify(expected.metrics)) return 'VERIFICATION_FRAME_STALE_GEOMETRY';
    const r = root.getBoundingClientRect(), s = slider.getBoundingClientRect();
    if ([r.x - expected.root.x, r.y - expected.root.y, r.width - expected.root.width, r.height - expected.root.height,
      s.x - expected.slider.x, s.y - expected.slider.y, s.width - expected.slider.width, s.height - expected.slider.height].some(delta => Math.abs(delta) > .1)) return 'VERIFICATION_FRAME_STALE_GEOMETRY';
    // CSSOM changes do not notify MutationObserver. Recheck the same visible
    // challenge-only content rules, and frame ancestor transforms, in this
    // single document RPC before capture/send/input can reuse parsed bounds.
    for (let ancestor: Element | null = root; ancestor; ancestor = ancestor.parentElement) {
      const value = getComputedStyle(ancestor).transform;
      if (value !== 'none') {
        const matrix = new DOMMatrixReadOnly(value);
        if (!matrix.is2D || Math.abs(matrix.b) > .0001 || Math.abs(matrix.c) > .0001 || matrix.a <= 0 || matrix.d <= 0) return 'VERIFICATION_FRAME_STALE_GEOMETRY';
      }
    }
    if (expected.selector) {
      const privateSelectors = '[data-private],[data-sensitive],.conversation,.message-list,.chat-messages';
      if (root.matches(privateSelectors) || root.querySelector(`textarea,input:not([type="hidden"]),[contenteditable="true"],video,audio,${privateSelectors}`)) return 'VERIFICATION_FRAME_STALE_DOM_STYLE';
      const elements = [root, ...root.querySelectorAll('*')];
      if (elements.length > 500) return 'VERIFICATION_FRAME_STALE_DOM_STYLE';
      for (const element of elements) {
        const style = getComputedStyle(element), rect = element.getBoundingClientRect();
        if (style.visibility === 'hidden' || style.display === 'none' || rect.width <= 0 || rect.height <= 0 || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH'].includes(element.tagName)) continue;
        const text = Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent ?? '').join('').trim();
        const errorCode = element.matches('.nc-errcode') && element.closest('.nc-container .errloading') && /^\((?:error:)?\d{1,4}\)$/.test(text);
        if (text && !errorCode && !/验证|滑|拖|安全|重试|刷新|拼图|请|闲鱼|阿里|反馈|帮助|网络|出错|错误|失败|成功|完成|通过|加载|检测|异常|松开|再试|哎哟|captcha|verif|secur|retry|refresh|slide|drag|loading|help|error|failed|success/i.test(text)
          && !/^[\s\p{P}\p{S}\p{Co}]+$/u.test(text)) return 'VERIFICATION_FRAME_STALE_DOM_STYLE';
        if (['BUTTON', 'A', 'INPUT'].includes(element.tagName) && !element.matches('#nc_1_refresh1,.btn_refresh,.errloading,[class*="captcha-refresh"],[id*="captcha-refresh"]')
          && !element.closest('.nc-container,#nocaptcha,.nc_wrapper,.scratch-captcha,.scratch-captcha-slider')
          && !/重试|刷新|反馈|帮助|retry|refresh|help/i.test(element.textContent ?? '')) return 'VERIFICATION_FRAME_STALE_DOM_STYLE';
        const pseudos = ['::before', '::after'].map(pseudo => getComputedStyle(element, pseudo));
        const paintedPseudo = pseudos.some(style => style.display !== 'none' && (style.backgroundImage !== 'none' || !['none', 'normal', '""', "''"].includes(style.content)));
        const painted = element.matches('button,a,img,canvas,svg,#nc_1_n1t,.nc_scale,.slider-track,.track')
          || element.matches('.nc-container,#nocaptcha,.scratch-captcha,.scratch-captcha-slider') && rect.width <= 640 && rect.height <= 480
          || style.backgroundImage !== 'none' || paintedPseudo;
        if (painted) {
          if (rect.width > 640 || rect.height > 480 || paintedPseudo && pseudos.some(style => style.transform !== 'none'
            || [style.left, style.top, style.right, style.bottom].some(offset => Number.parseFloat(offset) < 0)
            || Number.parseFloat(style.width) > rect.width || Number.parseFloat(style.height) > rect.height
            || Number.parseFloat(style.left) + Number.parseFloat(style.width) > rect.width || Number.parseFloat(style.top) + Number.parseFloat(style.height) > rect.height)) return 'VERIFICATION_FRAME_STALE_GEOMETRY';
          if (rect.left < expected.crop.x - 1 || rect.top < expected.crop.y - 1 || rect.right > expected.crop.x + expected.crop.width + 1 || rect.bottom > expected.crop.y + expected.crop.height + 1) return 'VERIFICATION_FRAME_STALE_GEOMETRY';
        }
        for (const node of element.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
          const range = document.createRange(); range.selectNodeContents(node); const bounds = range.getBoundingClientRect();
          if (bounds.width > 0 && bounds.height > 0 && (bounds.left < expected.crop.x - 1 || bounds.top < expected.crop.y - 1 || bounds.right > expected.crop.x + expected.crop.width + 1 || bounds.bottom > expected.crop.y + expected.crop.height + 1)) return 'VERIFICATION_FRAME_STALE_GEOMETRY';
        }
      }
    }
    const crop = expected.crop;
    for (const element of document.querySelectorAll('*')) {
      if (root.contains(element)) continue;
      if (element.contains(root)) {
        if (['::before', '::after'].some(pseudo => { const style = getComputedStyle(element, pseudo); return style.display !== 'none' && (style.backgroundImage !== 'none' || !['none', 'normal', '""', "''"].includes(style.content)); })) return 'VERIFICATION_FRAME_STALE_OCCLUDED';
        continue;
      }
      const style = getComputedStyle(element), box = element.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      if (expected.selector && box.width > 0 && box.height > 0 && element.matches('#nc_1_refresh1,.btn_refresh,.errloading,[class*="captcha-refresh"],[id*="captcha-refresh"]')) return 'VERIFICATION_FRAME_STALE_DOM_STYLE';
      const x = Math.max(crop.x, box.left), y = Math.max(crop.y, box.top), right = Math.min(crop.x + crop.width, box.right), bottom = Math.min(crop.y + crop.height, box.bottom);
      if (right <= x || bottom <= y) continue;
      const hit = document.elementFromPoint((x + right) / 2, (y + bottom) / 2);
      if (!hit || !root.contains(hit) || style.pointerEvents === 'none' && (element.matches('img,canvas,svg,video,iframe,object,embed') || element.textContent?.trim() || style.backgroundImage !== 'none' || !['rgba(0, 0, 0, 0)', 'transparent'].includes(style.backgroundColor)
        || ['::before', '::after'].some(pseudo => { const style = getComputedStyle(element, pseudo); return style.backgroundImage !== 'none' || !['none', 'normal', '""', "''"].includes(style.content); }))) return 'VERIFICATION_FRAME_STALE_OCCLUDED';
    }
    if (prepareTelemetry) observation.prepareTelemetry?.();
    return undefined;
  }, { expected, prepareTelemetry }).catch(() => 'VERIFICATION_FRAME_STALE_CONTEXT');
}
