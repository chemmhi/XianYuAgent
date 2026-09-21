import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

import { PNG } from 'pngjs';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptRoot, '..', '..', '..');
const defaultOutputDir = join(repoRoot, 'docs', 'evidence', 'common-controls');
const defaultThreshold = 16;
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const metricSelectors = [
  { name: 'search', selector: '.ui-search-control' },
  { name: 'select', selector: '.ui-select-control' },
  { name: 'input', selector: '.ui-input' },
  { name: 'textarea', selector: '.ui-textarea' },
  { name: 'button', selector: '.ui-button' },
  { name: 'placeholder', selector: '.placeholder-cell' },
];

function parseArgs(argv) {
  const result = {
    baseline: '',
    baselineUrl: '',
    targetUrl: '',
    outputDir: defaultOutputDir,
    threshold: defaultThreshold,
    waitMs: 350,
    chromePath: process.env.CHROME_PATH ?? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    debugPort: 0,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--baseline') result.baseline = argv[++index] ?? '';
    else if (arg === '--baseline-url') result.baselineUrl = argv[++index] ?? '';
    else if (arg === '--target-url') result.targetUrl = argv[++index] ?? '';
    else if (arg === '--out-dir') result.outputDir = resolve(argv[++index] ?? defaultOutputDir);
    else if (arg === '--threshold') result.threshold = Number(argv[++index] ?? defaultThreshold);
    else if (arg === '--wait-ms') result.waitMs = Number(argv[++index] ?? 350);
    else if (arg === '--chrome-path') result.chromePath = argv[++index] ?? result.chromePath;
    else if (arg === '--debug-port') result.debugPort = Number(argv[++index] ?? 0);
    else if (arg === '--help' || arg === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function usage() {
  return [
    'Usage:',
    '  node apps/web/scripts/common-controls-visual-diff.mjs --baseline <design.html> --target-url <http://...>',
    '',
    'Options:',
    '  --baseline <file>       Local HTML design baseline. Served over a temporary HTTP server.',
    '  --baseline-url <url>    Existing baseline URL (alternative to --baseline).',
    '  --target-url <url>      Implementation page URL. The page must already be running.',
    `  --out-dir <dir>         Evidence output directory (default: ${defaultOutputDir}).`,
    `  --threshold <n>         Per-channel difference threshold (default: ${defaultThreshold}).`,
    '  --wait-ms <n>           Settling delay after page load (default: 350).',
    '  --debug-port <port>     Reuse an existing Chrome CDP port instead of launching Chrome.',
    '  --chrome-path <path>    Chrome executable path when launching a browser.',
  ].join('\n');
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitFor(check, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`${label} did not become ready${lastError ? `: ${lastError.message}` : ''}`);
}

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePromise(port));
    });
  });
}

async function serveHtml(filePath) {
  const absolutePath = resolve(filePath);
  const html = readFileSync(absolutePath);
  const port = await freePort();
  const server = createServer((request, response) => {
    if (request.url === '/' || request.url?.split('?')[0] === `/${encodeURIComponent(absolutePath.split(/[\\/]/).pop())}`) {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(html);
      return;
    }
    response.writeHead(404);
    response.end('Not found');
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolvePromise);
  });
  const fileName = encodeURIComponent(absolutePath.split(/[\\/]/).pop());
  return {
    url: `http://127.0.0.1:${port}/${fileName}`,
    close: () => new Promise((resolvePromise) => server.close(() => resolvePromise())),
  };
}

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: command.endsWith('.cmd'),
    ...options,
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[visual-diff:${command}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[visual-diff:${command}] ${chunk}`));
  return child;
}

async function createCdpClient(debugPort) {
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    if (!response.ok) return false;
    const pages = await response.json();
    return pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl) ?? false;
  }, 'Chrome DevTools Protocol');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve: resolvePromise, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, send };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'browser evaluation failed');
  }
  return result.result?.value;
}

async function navigate(cdp, url, waitMs) {
  await cdp.send('Page.navigate', { url });
  await waitFor(async () => String(await evaluate(cdp, 'document.readyState')) === 'complete', `page load: ${url}`);
  await waitFor(async () => Boolean(await evaluate(cdp, 'document.body')), `page body: ${url}`);
  await evaluate(cdp, `document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); document.fonts?.ready ?? Promise.resolve()`);
  await sleep(waitMs);
}

async function setViewport(cdp, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  await evaluate(cdp, 'window.scrollTo(0, 0)');
}

async function captureScreenshot(cdp, destination) {
  const screenshot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  writeFileSync(destination, Buffer.from(screenshot.data, 'base64'));
}

async function collectMetrics(cdp) {
  const selectors = JSON.stringify(metricSelectors);
  return evaluate(cdp, `(() => {
    const selectors = ${selectors};
    const properties = ['backgroundColor', 'borderColor', 'borderRadius', 'boxShadow', 'color', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'opacity', 'padding', 'minHeight', 'height'];
    return selectors.map(({ name, selector }) => ({
      name,
      selector,
      items: Array.from(document.querySelectorAll(selector)).slice(0, 20).map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const computed = Object.fromEntries(properties.map((property) => [property, style[property]]));
        return {
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          text: String(element.textContent ?? '').trim().slice(0, 80),
          computed,
        };
      }),
    }));
  })()`);
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function pngStats(filePath) {
  const image = PNG.sync.read(readFileSync(filePath));
  const channels = { r: 0, g: 0, b: 0, a: 0 };
  const pixelCount = image.width * image.height;
  for (let index = 0; index < image.data.length; index += 4) {
    channels.r += image.data[index];
    channels.g += image.data[index + 1];
    channels.b += image.data[index + 2];
    channels.a += image.data[index + 3];
  }
  return {
    width: image.width,
    height: image.height,
    averageRgba: {
      r: Number((channels.r / pixelCount).toFixed(4)),
      g: Number((channels.g / pixelCount).toFixed(4)),
      b: Number((channels.b / pixelCount).toFixed(4)),
      a: Number((channels.a / pixelCount).toFixed(4)),
    },
  };
}

export function comparePngFiles(baselinePath, implementationPath, diffPath, threshold = defaultThreshold) {
  const baseline = PNG.sync.read(readFileSync(baselinePath));
  const implementation = PNG.sync.read(readFileSync(implementationPath));
  const width = Math.max(baseline.width, implementation.width);
  const height = Math.max(baseline.height, implementation.height);
  const diff = new PNG({ width, height });
  let changedPixels = 0;
  let exactChangedPixels = 0;
  let sumAbsDiff = 0;
  let maxChannelDiff = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const outputIndex = (width * y + x) * 4;
      const inBaseline = x < baseline.width && y < baseline.height;
      const inImplementation = x < implementation.width && y < implementation.height;
      const baselineIndex = (baseline.width * y + x) * 4;
      const implementationIndex = (implementation.width * y + x) * 4;
      const baselineRgba = inBaseline ? [baseline.data[baselineIndex], baseline.data[baselineIndex + 1], baseline.data[baselineIndex + 2], baseline.data[baselineIndex + 3]] : [0, 0, 0, 0];
      const implementationRgba = inImplementation ? [implementation.data[implementationIndex], implementation.data[implementationIndex + 1], implementation.data[implementationIndex + 2], implementation.data[implementationIndex + 3]] : [0, 0, 0, 0];
      const channels = [0, 1, 2, 3].map((channel) => Math.abs(baselineRgba[channel] - implementationRgba[channel]));
      const maxDiff = Math.max(...channels);
      const exactChanged = maxDiff > 0;
      const changed = maxDiff > threshold || !inBaseline || !inImplementation;
      if (exactChanged) exactChangedPixels += 1;
      if (changed) {
        changedPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      sumAbsDiff += channels[0] + channels[1] + channels[2];
      maxChannelDiff = Math.max(maxChannelDiff, maxDiff);

      if (changed) {
        diff.data[outputIndex] = 255;
        diff.data[outputIndex + 1] = 38;
        diff.data[outputIndex + 2] = 38;
        diff.data[outputIndex + 3] = 220;
      } else {
        const shade = Math.round((implementationRgba[0] + implementationRgba[1] + implementationRgba[2]) / 3);
        diff.data[outputIndex] = shade;
        diff.data[outputIndex + 1] = shade;
        diff.data[outputIndex + 2] = shade;
        diff.data[outputIndex + 3] = 110;
      }
    }
  }

  mkdirSync(dirname(diffPath), { recursive: true });
  writeFileSync(diffPath, PNG.sync.write(diff));
  const comparedPixels = width * height;
  return {
    threshold,
    baseline: pngStats(baselinePath),
    implementation: pngStats(implementationPath),
    dimensionsMatch: baseline.width === implementation.width && baseline.height === implementation.height,
    changedPixels,
    changedPixelRatio: Number((changedPixels / comparedPixels).toFixed(8)),
    exactChangedPixels,
    exactChangedPixelRatio: Number((exactChangedPixels / comparedPixels).toFixed(8)),
    meanAbsRgbDiff: Number((sumAbsDiff / (comparedPixels * 3)).toFixed(6)),
    maxChannelDiff,
    diffBoundingBox: maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    diffPath,
  };
}

function formatMetric(metric) {
  const lines = [`### ${metric.name} \`${metric.selector}\``];
  if (!metric.items.length) {
    lines.push('- 未找到匹配节点。');
    return lines.join('\n');
  }
  lines.push('| # | rect | background | border | radius | font | padding | shadow |');
  lines.push('| ---: | --- | --- | --- | --- | --- | --- | --- |');
  for (const [index, item] of metric.items.entries()) {
    const style = item.computed;
    const rect = `${item.rect.width.toFixed(1)}×${item.rect.height.toFixed(1)} @ ${item.rect.x.toFixed(1)},${item.rect.y.toFixed(1)}`;
    const font = `${style.fontSize} / ${style.fontWeight}`;
    lines.push(`| ${index + 1} | ${rect} | ${style.backgroundColor} | ${style.borderColor} | ${style.borderRadius} | ${font} | ${style.padding} | ${style.boxShadow === 'none' ? 'none' : style.boxShadow} |`);
  }
  return lines.join('\n');
}

function relativeEvidencePath(filePath, outputDir) {
  const rel = relative(outputDir, filePath).replaceAll('\\', '/');
  return rel || filePath;
}

function renderMarkdown(evidence) {
  const lines = [
    '# Common Controls Visual Diff',
    '',
    `- 生成时间：${evidence.generatedAt}`,
    `- 基线：\`${evidence.baseline.url}\``,
    `- 实现：\`${evidence.implementation.url}\``,
    `- 浏览器：Chrome/CDP，deviceScaleFactor=1`,
    `- 固定视口：${viewports.map((viewport) => `\`${viewport.width}×${viewport.height}\``).join('、')}`,
    `- 像素差异阈值：每通道 > ${evidence.threshold}`,
    '',
    '## 截图差异',
    '',
    '| 视口 | 基线 | 实现 | 差异热图 | 尺寸 | changed (> threshold) | mean abs RGB | bbox |',
    '| --- | --- | --- | --- | --- | ---: | ---: | --- |',
  ];
  for (const viewport of evidence.viewports) {
    const diff = viewport.diff;
    lines.push(`| ${viewport.name} | [baseline](${relativeEvidencePath(viewport.screenshots.baseline, evidence.outputDir)}) | [implementation](${relativeEvidencePath(viewport.screenshots.implementation, evidence.outputDir)}) | [diff](${relativeEvidencePath(viewport.screenshots.diff, evidence.outputDir)}) | ${diff.baseline.width}×${diff.baseline.height} / ${diff.implementation.width}×${diff.implementation.height} | ${diff.changedPixels} (${(diff.changedPixelRatio * 100).toFixed(3)}%) | ${diff.meanAbsRgbDiff} | ${diff.diffBoundingBox ? `${diff.diffBoundingBox.width}×${diff.diffBoundingBox.height} @ ${diff.diffBoundingBox.x},${diff.diffBoundingBox.y}` : 'none'} |`);
  }
  lines.push('', '## DOM 样式指标', '');
  for (const viewport of evidence.viewports) {
    lines.push(`### ${viewport.name} · ${viewport.width}×${viewport.height}`, '');
    lines.push('#### 基线', '');
    lines.push(...viewport.metrics.baseline.map(formatMetric), '');
    lines.push('#### 实现', '');
    lines.push(...viewport.metrics.implementation.map(formatMetric), '');
  }
  lines.push('## 证据判定', '');
  const allDimensionsMatch = evidence.viewports.every((viewport) => viewport.diff.dimensionsMatch);
  const allScreenshotsPresent = evidence.viewports.every((viewport) => Object.values(viewport.screenshots).every((file) => Boolean(file)));
  lines.push(`- 固定尺寸截图：${allDimensionsMatch ? '通过' : '失败'}`);
  lines.push(`- 基线/实现/差异三件套：${allScreenshotsPresent ? '通过' : '失败'}`);
  lines.push('- 严格 1:1 视觉签核：需结合差异热图与 DOM 样式指标人工确认；脚本不会擅自把非零像素差异判定为通过。');
  lines.push('', '## 运行命令', '', '```powershell', `node apps/web/scripts/common-controls-visual-diff.mjs --baseline <design.html> --target-url <implementation-url> --out-dir ${evidence.outputDir}`, '```', '');
  return lines.join('\n');
}

export async function run(options) {
  if (options.help) {
    console.log(usage());
    return null;
  }
  if (!options.baseline && !options.baselineUrl) throw new Error('Provide --baseline or --baseline-url');
  if (!options.targetUrl) throw new Error('Provide --target-url');
  if (!Number.isFinite(options.threshold) || options.threshold < 0) throw new Error('--threshold must be a non-negative number');
  if (!Number.isFinite(options.waitMs) || options.waitMs < 0) throw new Error('--wait-ms must be a non-negative number');

  mkdirSync(options.outputDir, { recursive: true });
  const baselineServer = options.baseline ? await serveHtml(options.baseline) : null;
  const baselineUrl = options.baselineUrl || baselineServer.url;
  const children = [];
  const chromeProfile = join(tmpdir(), `xianyu-agent-common-controls-visual-diff-${process.pid}`);
  let debugPort = options.debugPort;
  let cdp;

  try {
    mkdirSync(chromeProfile, { recursive: true });
    if (!debugPort) {
      debugPort = await freePort();
      const chrome = spawnProcess(options.chromePath, [
        '--headless=new',
        '--disable-gpu',
        '--disable-extensions',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-allow-origins=*',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${chromeProfile}`,
        '--window-size=1440,900',
        'about:blank',
      ]);
      children.push(chrome);
      await waitFor(async () => chrome.exitCode === null && (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'local Chrome');
    }
    cdp = await createCdpClient(debugPort);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });

    const evidence = {
      generatedAt: new Date().toISOString(),
      outputDir: options.outputDir,
      threshold: options.threshold,
      baseline: { url: baselineUrl, file: options.baseline ? resolve(options.baseline) : null },
      implementation: { url: options.targetUrl },
      viewports: [],
    };

    for (const viewport of viewports) {
      await setViewport(cdp, viewport);
      const baselineMetrics = await (async () => {
        await navigate(cdp, baselineUrl, options.waitMs);
        return collectMetrics(cdp);
      })();
      const baselineScreenshot = join(options.outputDir, `controls-baseline-${viewport.name}-${viewport.width}x${viewport.height}.png`);
      await captureScreenshot(cdp, baselineScreenshot);

      await navigate(cdp, options.targetUrl, options.waitMs);
      const implementationMetrics = await collectMetrics(cdp);
      const implementationScreenshot = join(options.outputDir, `controls-implementation-${viewport.name}-${viewport.width}x${viewport.height}.png`);
      await captureScreenshot(cdp, implementationScreenshot);
      const diffScreenshot = join(options.outputDir, `controls-diff-${viewport.name}-${viewport.width}x${viewport.height}.png`);
      const diff = comparePngFiles(baselineScreenshot, implementationScreenshot, diffScreenshot, options.threshold);
      evidence.viewports.push({
        ...viewport,
        screenshots: { baseline: baselineScreenshot, implementation: implementationScreenshot, diff: diffScreenshot },
        hashes: { baseline: sha256(baselineScreenshot), implementation: sha256(implementationScreenshot), diff: sha256(diffScreenshot) },
        metrics: { baseline: baselineMetrics, implementation: implementationMetrics },
        diff,
      });
    }

    const evidenceJson = join(options.outputDir, 'evidence.json');
    const visualDiffMarkdown = join(options.outputDir, 'visual-diff.md');
    writeFileSync(evidenceJson, `${JSON.stringify(evidence, null, 2)}\n`);
    writeFileSync(visualDiffMarkdown, `${renderMarkdown(evidence)}\n`);
    console.log(JSON.stringify({ evidenceJson, visualDiffMarkdown, viewports: evidence.viewports.map((viewport) => ({ name: viewport.name, diff: viewport.diff })) }, null, 2));
    return evidence;
  } finally {
    cdp?.socket.close();
    for (const child of children.reverse()) {
      if (!child.killed && child.exitCode === null) {
        if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else child.kill('SIGTERM');
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
    try { rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (error) { console.warn(`Chrome temporary profile cleanup failed: ${error.message}`); }
    await baselineServer?.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
