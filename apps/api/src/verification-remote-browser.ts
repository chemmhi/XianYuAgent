import { randomUUID } from 'node:crypto';
import type { Page, Frame, Locator } from 'patchright';
import type { XianyuVerificationPage } from './xianyu-browser-port.js';

export interface VerificationGeometry { x: number; y: number; width: number; height: number }
export interface VerificationFrame {
  frameId: string; streamEpoch: number; geometryRevision: number; capturedAt: number;
  width: number; height: number; image: Buffer;
}
export interface VerificationPointer {
  type: 'down' | 'move' | 'up'; x: number; y: number; frameId: string;
  streamEpoch: number; geometryRevision: number; sequence: number;
}
interface LocatedChallenge { locator: Locator; geometry: VerificationGeometry; identity: string }
const CONTAINERS = ['.nc-container', '#nocaptcha', '.scratch-captcha', '.scratch-captcha-slider'];
const BUTTONS = '#nc_1_n1z,.btn_slide,#scratch-captcha-btn,.scratch-captcha-slider .button';

/** A restricted view of the existing page, never a second browser or a desktop. */
export class VerificationRemoteBrowser {
  private readonly page: Page;
  private streamEpoch = 1;
  private geometryRevision = 1;
  private identity = '';
  private closed = false;
  private pressed = false;
  private inputGeneration = 0;
  private lastSequence = 0;
  private readonly frames = new Map<string, { at: number; geometry: VerificationGeometry; identity: string }>();
  private tail: Promise<unknown> = Promise.resolve();
  private readonly navigation = (_frame: Frame) => this.invalidate();
  private readonly popup = (popup: Page) => { this.invalidate(); void popup.close().catch(() => undefined); };
  private readonly dialog = (dialog: { dismiss(): Promise<void> }) => { this.invalidate(); void dialog.dismiss().catch(() => undefined); };
  private readonly download = (download: { cancel(): Promise<void> }) => { this.invalidate(); void download.cancel().catch(() => undefined); };

  constructor(page: XianyuVerificationPage, private readonly options: {
    allowedOrigins?: readonly string[]; now?: () => number; beforeCapture?: () => Promise<void>;
  } = {}) {
    this.page = page as unknown as Page;
    this.page.on('framenavigated', this.navigation);
    this.page.on('popup', this.popup);
    this.page.on('dialog', this.dialog);
    this.page.on('download', this.download);
  }

  private now() { return this.options.now?.() ?? Date.now(); }
  private allowed(value: string) {
    try {
      const url = new URL(value);
      return this.options.allowedOrigins?.includes(url.origin)
        ?? (url.protocol === 'https:' && /(^|\.)goofish\.com$/i.test(url.hostname) && !url.port && !url.username && !url.password);
    } catch { return false; }
  }

  invalidate(): void {
    this.streamEpoch++; this.inputGeneration++; this.frames.clear(); this.identity = '';
    if (this.pressed) void this.queueRelease().catch(() => { this.closed = true; });
  }

  private async locate(): Promise<LocatedChallenge | undefined> {
    if (this.closed || !this.allowed(this.page.url())) return;
    const urls = this.page.frames().map(frame => frame.url());
    for (const frame of this.page.frames()) {
      if (!this.allowed(frame.url())) continue;
      for (const selector of CONTAINERS) {
        const locator = frame.locator(selector).first();
        if (!await locator.isVisible().catch(() => false) || !await locator.locator(BUTTONS).first().isVisible().catch(() => false)) continue;
        const box = await locator.boundingBox();
        if (!box || box.width < 40 || box.height < 15) continue;
        const viewport = await this.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        const geometry = { x: Math.max(0, box.x), y: Math.max(0, box.y),
          width: Math.min(box.x + box.width, viewport.width) - Math.max(0, box.x),
          height: Math.min(box.y + box.height, viewport.height) - Math.max(0, box.y) };
        if (geometry.width < 40 || geometry.height < 15 || geometry.width * geometry.height > 1_000_000) continue;
        const nodeId = await locator.evaluate(element => {
          const state = globalThis as typeof globalThis & { __verificationNodeIds?: WeakMap<Element, number>; __verificationNodeSequence?: number };
          state.__verificationNodeIds ??= new WeakMap();
          let id = state.__verificationNodeIds.get(element);
          if (!id) { id = (state.__verificationNodeSequence ?? 0) + 1; state.__verificationNodeSequence = id; state.__verificationNodeIds.set(element, id); }
          return id;
        });
        return { locator, geometry, identity: JSON.stringify([this.page.url(), urls, selector, nodeId, geometry]) };
      }
    }
  }

  async capture(): Promise<VerificationFrame | undefined> {
    const startEpoch = this.streamEpoch;
    const before = await this.locate();
    if (!before) { this.invalidate(); return; }
    if (this.identity && this.identity !== before.identity) { this.invalidate(); this.geometryRevision++; return; }
    this.identity = before.identity;
    await this.options.beforeCapture?.();
    const image = await this.page.screenshot({ type: 'jpeg', quality: 65, clip: before.geometry, timeout: 2_000 }).catch(() => undefined);
    const after = await this.locate();
    if (!image || image.length > 250_000 || this.closed || startEpoch !== this.streamEpoch || before.identity !== after?.identity) {
      this.invalidate(); return;
    }
    const frameId = randomUUID(), capturedAt = this.now();
    this.frames.set(frameId, { at: capturedAt, geometry: before.geometry, identity: before.identity });
    for (const [id, frame] of this.frames) if (frame.at < capturedAt - 2_000) this.frames.delete(id);
    return { frameId, streamEpoch: this.streamEpoch, geometryRevision: this.geometryRevision,
      capturedAt, width: before.geometry.width, height: before.geometry.height, image };
  }

  /** Must be called after encoding, immediately before sending a captured frame. */
  async canSend(frame: VerificationFrame): Promise<boolean> {
    const located = await this.locate();
    const saved = this.frames.get(frame.frameId);
    if (!saved || frame.streamEpoch !== this.streamEpoch || frame.geometryRevision !== this.geometryRevision
      || !located || located.identity !== saved.identity || this.now() - saved.at > 2_000) {
      this.invalidate(); return false;
    }
    return true;
  }

  async pointer(input: VerificationPointer, admit: () => Promise<boolean>): Promise<void> {
    const inputGeneration = this.inputGeneration;
    const operation = this.tail.then(async () => {
      if (!Number.isSafeInteger(input.sequence) || input.sequence <= this.lastSequence) throw new Error('VERIFICATION_INPUT_SEQUENCE');
      if (!['down', 'move', 'up'].includes(input.type) || !Number.isFinite(input.x) || !Number.isFinite(input.y)
        || input.x < 0 || input.x > 1 || input.y < 0 || input.y > 1) throw new Error('VERIFICATION_INPUT_INVALID');
      const frame = this.frames.get(input.frameId);
      const valid = () => !this.closed && inputGeneration === this.inputGeneration && !!frame
        && this.frames.get(input.frameId) === frame && input.streamEpoch === this.streamEpoch
        && input.geometryRevision === this.geometryRevision && this.now() - frame.at <= 2_000;
      const check = async () => {
        if (!valid()) throw new Error('VERIFICATION_FRAME_STALE');
        if (!await admit()) throw new Error('VERIFICATION_CONTROL_EXPIRED');
        if (!valid()) throw new Error('VERIFICATION_FRAME_STALE');
        const located = await this.locate();
        if (!valid() || located?.identity !== frame!.identity) throw new Error('VERIFICATION_FRAME_STALE');
      };
      await check();
      this.lastSequence = input.sequence;
      if (input.type === 'down' && this.pressed) throw new Error('VERIFICATION_POINTER_PRESSED');
      if (input.type === 'up' && !this.pressed) return;
      const { x, y, width, height } = frame!.geometry;
      await check();
      if (!valid()) throw new Error('VERIFICATION_FRAME_STALE');
      await this.page.mouse.move(x + input.x * Math.max(0, width - 1), y + input.y * Math.max(0, height - 1));
      await check();
      if (!valid()) throw new Error('VERIFICATION_FRAME_STALE');
      if (input.type === 'down') { this.pressed = true; await this.page.mouse.down({ button: 'left' }); }
      if (input.type === 'up') { await this.page.mouse.up({ button: 'left' }); this.pressed = false; }
    });
    this.tail = operation.catch(async () => {
      if (this.pressed) try { await this.releaseNow(); } catch { this.closed = true; }
    });
    await operation;
  }

  async release(): Promise<void> {
    this.inputGeneration++;
    await this.queueRelease();
  }

  private async releaseNow(): Promise<void> {
    await this.page.mouse.up({ button: 'left' });
    this.pressed = false;
  }

  private queueRelease(): Promise<void> {
    const release = this.tail.then(() => this.releaseNow());
    this.tail = release.catch(() => { this.closed = true; });
    return release;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.invalidate();
    await this.release().catch(() => undefined);
    this.page.off('framenavigated', this.navigation); this.page.off('popup', this.popup);
    this.page.off('dialog', this.dialog); this.page.off('download', this.download);
  }
}
