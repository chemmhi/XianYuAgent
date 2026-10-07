import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export type XianyuBrowserPlatform = 'Windows' | 'Linux' | 'macOS' | 'Android' | 'Unknown';

export interface XianyuBrowserIdentity {
  userAgent: string;
  chromeVersion: string;
  chromeMajor: string;
  platform: XianyuBrowserPlatform;
  secChUa: string;
  secChUaPlatform: string;
  navigatorPlatform: string;
  imOs: string;
}

const DEFAULT_CHROME_VERSION = resolveDefaultChromeVersion();
const DEFAULT_XIANYU_USER_AGENT = process.platform === 'linux'
  ? `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${DEFAULT_CHROME_VERSION} Safari/537.36`
  : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${DEFAULT_CHROME_VERSION} Safari/537.36`;

export const XIANYU_USER_AGENT = process.env.XIANYU_BROWSER_USER_AGENT?.trim() || DEFAULT_XIANYU_USER_AGENT;

/**
 * Keep request headers and the verification browser on the same Chrome build.
 * A hard-coded production version drifts as google-chrome-stable updates,
 * which makes BX see a browser fingerprint that disagrees with the HTTP layer.
 */
export function resolveDefaultChromeVersion(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = normalizeChromeVersion(env.XIANYU_BROWSER_CHROME_VERSION);
  if (explicit) return explicit;

  const executableCandidates = [
    env.XIANYU_VERIFICATION_BROWSER_EXECUTABLE,
    ...(process.platform === 'linux' ? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'] : []),
    ...(process.platform === 'win32' ? [
      env.LOCALAPPDATA ? `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
      env.PROGRAMFILES ? `${env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
      env['PROGRAMFILES(X86)'] ? `${env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
    ] : []),
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()));

  for (const executable of executableCandidates) {
    if (!existsSync(executable)) continue;
    try {
      const output = execFileSync(executable, ['--version'], {
        encoding: 'utf8',
        timeout: 2_000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const detected = normalizeChromeVersion(output);
      if (detected) return detected;
    } catch {
      // A missing or sandboxed binary should not prevent API startup.
    }
  }

  return process.platform === 'linux' ? '155.0.0.0' : '154.0.0.0';
}

export function xianyuBrowserIdentity(userAgent = XIANYU_USER_AGENT): XianyuBrowserIdentity {
  const chromeVersion = xianyuChromeVersion(userAgent);
  const chromeMajor = chromeVersion.split('.')[0] || DEFAULT_CHROME_VERSION.split('.')[0] || '154';
  const platform = xianyuBrowserPlatform(userAgent);
  return {
    userAgent,
    chromeVersion,
    chromeMajor,
    platform,
    secChUa: `"Not(A:Brand";v="99", "Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}"`,
    secChUaPlatform: `"${platform === 'Unknown' ? 'Windows' : platform}"`,
    navigatorPlatform: xianyuNavigatorPlatform(userAgent),
    imOs: xianyuImOs(userAgent),
  };
}

export function xianyuChromeVersion(userAgent = XIANYU_USER_AGENT): string {
  return /Chrome\/([\d.]+)/i.exec(userAgent)?.[1] ?? DEFAULT_CHROME_VERSION;
}

export function xianyuSecChUa(userAgent = XIANYU_USER_AGENT): string {
  return xianyuBrowserIdentity(userAgent).secChUa;
}

export function xianyuSecChUaPlatform(userAgent = XIANYU_USER_AGENT): string {
  return xianyuBrowserIdentity(userAgent).secChUaPlatform;
}

export function xianyuNavigatorPlatform(userAgent = XIANYU_USER_AGENT): string {
  const platform = xianyuBrowserPlatform(userAgent);
  if (platform === 'Windows') return 'Win32';
  if (platform === 'Linux') return 'Linux x86_64';
  if (platform === 'macOS') return 'MacIntel';
  if (platform === 'Android') return 'Linux armv8l';
  return 'Win32';
}

export function xianyuImUserAgent(userAgent = XIANYU_USER_AGENT): string {
  const identity = xianyuBrowserIdentity(userAgent);
  return `${userAgent} DingTalk(2.1.5) OS(${identity.imOs}) Browser(Chrome/${identity.chromeMajor}) DingWeb/2.1.5`;
}

function xianyuBrowserPlatform(userAgent: string): XianyuBrowserPlatform {
  if (/Windows NT/i.test(userAgent)) return 'Windows';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/Mac OS X/i.test(userAgent)) return 'macOS';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return 'Unknown';
}

function xianyuImOs(userAgent: string): string {
  const platform = xianyuBrowserPlatform(userAgent);
  if (platform === 'Windows') return 'Windows/10';
  if (platform === 'macOS') return 'Mac OS X';
  if (platform === 'Android') return 'Android';
  if (platform === 'Linux') return 'Linux';
  return 'Windows/10';
}

function normalizeChromeVersion(value: string | undefined): string | undefined {
  const match = value?.match(/\b(\d+\.\d+\.\d+\.\d+)\b/u);
  return match?.[1];
}
