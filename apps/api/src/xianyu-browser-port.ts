import type { XianyuBrowserCookie } from './xianyu-cookie-jar.js';
import type { XianyuSliderPage } from './xianyu-slider-port.js';

export type XianyuVerificationWaitUntil = 'domcontentloaded' | 'load' | 'networkidle';

export type XianyuVerificationCookie = XianyuBrowserCookie & {
  url?: string;
};

export interface XianyuVerificationPage extends XianyuSliderPage {
  goto(url: string, options?: { waitUntil?: XianyuVerificationWaitUntil; timeout?: number }): Promise<unknown>;
  evaluate<T, A = undefined>(pageFunction: (arg: A) => T | Promise<T>, arg?: A): Promise<T>;
  close(): Promise<void>;
  on?<E extends keyof XianyuVerificationPageEvents>(event: E, listener: (value: XianyuVerificationPageEvents[E]) => void): unknown;
  off?<E extends keyof XianyuVerificationPageEvents>(event: E, listener: (value: XianyuVerificationPageEvents[E]) => void): unknown;
}

export interface XianyuVerificationRequest {
  resourceType(): string;
}

export interface XianyuVerificationPageEvents {
  response: XianyuVerificationResponse;
  request: XianyuVerificationRequest;
  requestfinished: XianyuVerificationRequest;
  requestfailed: XianyuVerificationRequest;
}

export interface XianyuVerificationResponse {
  url(): string;
  json(): Promise<unknown>;
}

export interface XianyuVerificationContext {
  addInitScript(input: { content: string }): Promise<void>;
  addCookies(cookies: readonly XianyuVerificationCookie[]): Promise<void>;
  cookies(): Promise<XianyuBrowserCookie[]>;
  pages(): readonly XianyuVerificationPage[];
  newPage(): Promise<XianyuVerificationPage>;
  close(): Promise<void>;
}

export interface XianyuVerificationLaunchOptions {
  profileDir: string;
  headless: boolean;
  hideWindow: boolean;
  executablePath?: string;
  userAgent?: string;
  sliderStrategy?: 'ydisks';
}

export interface XianyuVerificationBrowserFactory {
  launchPersistentContext(options: XianyuVerificationLaunchOptions): Promise<XianyuVerificationContext>;
}
