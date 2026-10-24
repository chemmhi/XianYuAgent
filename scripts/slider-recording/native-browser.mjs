import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

// Diagnostic only: a task-owned native Chrome process with a fresh profile.
// This does not attach to the user's browser or change the production adapter.
export function useNativeChromeLaunch(chromium, store) {
  chromium.launchPersistentContext = async profile => {
    const allocator = createServer();
    await new Promise((resolve, reject) => allocator.once('error', reject).listen(0, '127.0.0.1', resolve));
    const port = allocator.address().port;
    await new Promise(resolve => allocator.close(resolve));
    const executable = process.env.XIANYU_COPY_CHROME_EXE;
    if (!executable) throw Error('Native Chrome executable required');
    const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
      '--no-default-browser-check', '--window-size=1440,900', '--lang=zh-CN',
      ...(process.env.XIANYU_COPY_PROXY ? [`--proxy-server=${process.env.XIANYU_COPY_PROXY}`] : []), 'about:blank'];
    store.event('native.launch.input', { executable, args, profile, port });
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', bytes => store.event('native.stdout', { body: store.blob(bytes) }));
    child.stderr.on('data', bytes => store.event('native.stderr', { body: store.blob(bytes) }));
    store.event('native.launch.output', { pid: child.pid, port });
    let browser;
    try {
      let ready = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) { ready = true; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!ready) throw Error('Native Chrome debugging endpoint unavailable');
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const context = browser.contexts()[0];
      if (!context) throw Error('Native Chrome context unavailable');
      const page = context.pages()[0] ?? await context.newPage();
      await page.setViewportSize({ width: 1440, height: 900 });
      let closing;
      context.close = () => closing ??= (async () => {
        try { await browser.close(); } finally { child.kill(); store.event('native.closed', { pid: child.pid }); }
      })();
      return context;
    } catch (error) {
      if (browser) await browser.close().catch(() => {});
      child.kill();
      throw error;
    }
  };
}
