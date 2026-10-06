import { readFile, readlink, unlink } from 'node:fs/promises';
import { hostname as osHostname } from 'node:os';
import { join, resolve } from 'node:path';
import type { XianyuVerificationBrowserFactory, XianyuVerificationContext, XianyuVerificationLaunchOptions } from './xianyu-browser-port.js';

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
      await cleanupStaleChromiumSingletonLocks(options.profileDir);
      const context = await chromium.launchPersistentContext(options.profileDir, {
        channel: options.executablePath ? undefined : 'chrome',
        ...(options.executablePath ? { executablePath: options.executablePath } : {}),
        headless: options.headless,
        ...(options.userAgent ? { userAgent: options.userAgent } : {}),
        viewport: { width: 1440, height: 900 },
        locale: 'zh-CN',
        args: [
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
          ...(!options.headless && options.hideWindow ? ['--start-minimized', '--window-position=-32000,-32000'] : []),
        ],
      });
      return context as unknown as XianyuVerificationContext;
    },
  };
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

async function isStaleChromiumSingleton(lock: { host: string; pid: number }, profileDir: string): Promise<boolean> {
  if (lock.host !== osHostname()) return true;
  if (!isProcessAlive(lock.pid)) return true;
  const commandLine = await readProcessCommandLine(lock.pid);
  // If procfs is unavailable, keep the lock conservatively. A live process
  // with an unreadable command line may still be the profile owner.
  if (!commandLine) return false;
  return !commandLine.includes(profileDir);
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
  try {
    return (await readFile(`/proc/${pid}/cmdline`, 'utf8')).replace(/\0/g, ' ');
  } catch {
    return '';
  }
}
