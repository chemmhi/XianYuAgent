import { execFile } from 'node:child_process';
import { readFile, readlink, unlink } from 'node:fs/promises';
import { hostname as osHostname } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { XianyuVerificationBrowserFactory, XianyuVerificationContext, XianyuVerificationLaunchOptions } from './xianyu-browser-port.js';

const execFileAsync = promisify(execFile);

/**
 * The only browser-library adapter used by verification.
 *
 * Patchright is loaded lazily so normal API startup and non-verification paths
 * do not eagerly load a browser runtime. No CDP fallback belongs here.
 */
export function createPatchrightVerificationBrowserFactory(): XianyuVerificationBrowserFactory {
  return {
    async launchPersistentContext(options: XianyuVerificationLaunchOptions): Promise<XianyuVerificationContext> {
      const { chromium } = await import('patchright');
      const ydisks = options.sliderStrategy === 'ydisks';
      await cleanupStaleChromiumSingletonLocks(options.profileDir);
      if (await isChromiumProfileInUse(options.profileDir)) throw new Error('XIANYU_VERIFICATION_PROFILE_BUSY');
      const context = await chromium.launchPersistentContext(options.profileDir, {
        channel: options.executablePath ? undefined : 'chrome',
        ...(options.executablePath ? { executablePath: options.executablePath } : {}),
        headless: options.headless,
        ...(options.userAgent ? { userAgent: options.userAgent } : {}),
        viewport: ydisks ? null : { width: 1440, height: 900 },
        ...(ydisks ? { colorScheme: 'light' as const } : {}),
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        args: [...(ydisks ? [
          '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
          '--no-first-run', '--start-maximized', '--window-size=1920,1080',
          '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding', '--lang=zh-CN', '--disable-blink-features=AutomationControlled',
          '--no-default-browser-check', '--disable-popup-blocking', '--disable-search-engine-choice-screen',
          '--password-store=basic', '--use-mock-keychain',
          ...(process.platform === 'linux' ? ['--use-angle=swiftshader'] : []),
        ] : [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=AutomationControlled',
          '--disable-popup-blocking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-extensions',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--no-first-run',
          '--no-default-browser-check',
          '--window-size=1440,900',
          '--lang=zh-CN',
        ]),
          `--xianyu-verification-owner=${process.pid}`,
          ...(!ydisks && !options.headless && options.hideWindow ? ['--start-minimized', '--window-position=-32000,-32000'] : []),
        ],
      });
      return wrapPatchrightContext(context, options.profileDir);
    },
  };
}

/**
 * Persistent contexts own the Chrome process they launch. Patchright normally
 * closes it through BrowserContext.close(), but an explicit browser close is
 * needed as a second idempotent guard when Chrome has handed the profile to a
 * singleton process. Without it, the next test run can append another tab to
 * the still-running Chrome process.
 */
function wrapPatchrightContext(context: {
  pages(): readonly { close(): Promise<void> }[];
  browser?(): { close(): Promise<void> } | null | undefined;
  close(): Promise<void>;
}, profileDir: string): XianyuVerificationContext {
  const originalClose = context.close.bind(context);
  const browser = context.browser?.();
  let closeTask: Promise<void> | undefined;
  context.close = async () => {
    if (!closeTask) {
      closeTask = (async () => {
        let pages: readonly { close(): Promise<void> }[] = [];
        try {
          pages = context.pages();
        } catch {
          pages = [];
        }
        for (const page of pages) await page.close().catch(() => undefined);
        const ownsBrowser = await isOwnedChromiumProfileProcess(profileDir);
        await originalClose().catch(() => undefined);
        if (ownsBrowser) await browser?.close().catch(() => undefined);
      })();
    }
    await closeTask;
  };
  return context as unknown as XianyuVerificationContext;
}

async function isOwnedChromiumProfileProcess(profileDir: string): Promise<boolean> {
  let target: string;
  try {
    target = await readlink(join(resolve(profileDir), 'SingletonLock'));
  } catch {
    return false;
  }
  const parsed = parseChromiumSingletonTarget(target);
  if (!parsed || parsed.host.toLowerCase() !== osHostname().toLowerCase() || !isProcessAlive(parsed.pid)) return false;
  const commandLine = await readProcessCommandLine(parsed.pid);
  if (!commandLine) return false;
  const normalizedCommandLine = commandLine.replaceAll('/', '\\').toLowerCase();
  const normalizedProfileDir = resolve(profileDir).replaceAll('/', '\\').replace(/[\\]+$/u, '').toLowerCase();
  return normalizedCommandLine.includes(normalizedProfileDir) && normalizedCommandLine.includes(`--xianyu-verification-owner=${process.pid}`.toLowerCase());
}

const CHROMIUM_SINGLETON_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'] as const;

/**
 * A persistent profile can outlive the container that created its Chromium
 * singleton symlink. Remove only a lock proven to belong to a dead or
 * different process; an active Chromium process keeps the profile untouched.
 */
export async function cleanupStaleChromiumSingletonLocks(profileDir: string): Promise<string[]> {
  const lockPath = join(resolve(profileDir), 'SingletonLock');
  let target: string;
  try {
    target = await readlink(lockPath);
  } catch {
    return [];
  }
  const parsed = parseChromiumSingletonTarget(target);
  if (!parsed || !(await isStaleChromiumSingleton(parsed, resolve(profileDir)))) return [];
  const removed: string[] = [];
  for (const file of CHROMIUM_SINGLETON_FILES) {
    const path = join(resolve(profileDir), file);
    try {
      await unlink(path);
      removed.push(file);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ENOENT') throw error;
    }
  }
  return removed;
}

function parseChromiumSingletonTarget(target: string): { host: string; pid: number } | undefined {
  const match = target.match(/^(.+)-(\d+)$/u);
  if (!match) return undefined;
  const pid = Number(match[2]);
  return Number.isSafeInteger(pid) && pid > 0 ? { host: match[1], pid } : undefined;
}

export async function isStaleChromiumSingleton(
  lock: { host: string; pid: number },
  profileDir: string,
  dependencies: {
    host?: string;
    isProcessAlive?: (pid: number) => boolean;
    readProcessCommandLine?: (pid: number) => Promise<string>;
  } = {},
): Promise<boolean> {
  const host = dependencies.host ?? osHostname();
  const processAlive = dependencies.isProcessAlive ?? isProcessAlive;
  const readCommandLine = dependencies.readProcessCommandLine ?? readProcessCommandLine;
  if (lock.host.toLowerCase() !== host.toLowerCase()) return true;
  if (!processAlive(lock.pid)) return true;
  const commandLine = await readCommandLine(lock.pid);
  // If procfs is unavailable, keep the lock conservatively. A live process
  // with an unreadable command line may still be the profile owner.
  if (!commandLine) return false;
  const normalizedCommandLine = commandLine.replaceAll('/', '\\').toLowerCase();
  const normalizedProfileDir = resolve(profileDir).replaceAll('/', '\\').replace(/[\\]+$/u, '').toLowerCase();
  return !normalizedCommandLine.includes(normalizedProfileDir);
}

async function isChromiumProfileInUse(profileDir: string): Promise<boolean> {
  const lockPath = join(resolve(profileDir), 'SingletonLock');
  let target: string;
  try {
    target = await readlink(lockPath);
  } catch {
    return false;
  }
  const parsed = parseChromiumSingletonTarget(target);
  return Boolean(parsed && !(await isStaleChromiumSingleton(parsed, resolve(profileDir))));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code === 'EPERM';
  }
}

async function readProcessCommandLine(pid: number): Promise<string> {
  if (process.platform === 'win32') {
    try {
      const script = `$p = Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\"; if ($p) { $p.CommandLine }`;
      const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 256 * 1024,
      });
      return result.stdout.trim();
    } catch {
      return '';
    }
  }
  try {
    return (await readFile(`/proc/${pid}/cmdline`, 'utf8')).replace(/\0/g, ' ');
  } catch {
    return '';
  }
}
