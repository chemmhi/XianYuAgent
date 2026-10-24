import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function buildYdisksPlan(source, geometry, seed, scratch = false) {
  if (process.env.XIANYU_COPY_PLAN_BRIDGE) {
    const bridge = process.env.XIANYU_COPY_PLAN_BRIDGE;
    const id = randomUUID();
    const requestPath = join(bridge, `${id}.request.json`), responsePath = join(bridge, `${id}.response.json`);
    fs.writeFileSync(requestPath + '.tmp', JSON.stringify({ geometry, seed, scratch }));
    fs.renameSync(requestPath + '.tmp', requestPath);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (fs.existsSync(responsePath)) {
        const response = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
        if (response.error) throw Error(response.error);
        return response.plan;
      }
      await new Promise(accept => setTimeout(accept, 100));
    }
    throw Error('Upstream planner bridge timed out');
  }
  const child = execFile(process.env.XIANYU_COPY_PYTHON ?? 'python', ['-X', 'utf8', fileURLToPath(new URL('./ydisks-plan.py', import.meta.url))],
    { windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
  const completion = promisify((callback) => {
    let output = '', errors = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { errors += bytes; });
    child.once('error', callback);
    child.once('close', code => code === 0 ? callback(null, output) : callback(Error(`Upstream planner exited ${code}: ${errors}`)));
  })();
  child.stdin.end(JSON.stringify({ source, geometry, seed, scratch }));
  return JSON.parse(await completion);
}

// Relative waits outside the trajectory, cumulative monotonic deadlines inside
// it, matching upstream replay_trajectory rather than adding CDP RTT to delays.
export async function replayYdisksPlan(plan, { page, button, record = () => {}, clock = () => performance.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), stopWhen = () => false }) {
  async function bounded(promise, ms) {
    let timeout;
    try { return await Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error(`Detached control observation exceeded ${ms}ms`)), ms); })]); }
    finally { clearTimeout(timeout); }
  }
  let replayStarted;
  let pressed = false;
  try {
    for (const event of plan.events) {
      if (stopWhen()) { record('gesture.stopped.after.verdict', {}); break; }
      if (event.replayAtMs !== undefined) {
        replayStarted ??= clock();
        const remaining = replayStarted + event.replayAtMs - clock();
        if (remaining > 0) await sleep(remaining);
      } else if (event.gapMs > 0) await sleep(event.gapMs);
      record('gesture.dispatch', { actualAtMs: clock(), event });
      if (event.type === 'move') await page.mouse.move(event.x, event.y, event.steps ? { steps: event.steps } : {});
      else if (event.type === 'wheel') await page.mouse.wheel(event.dx, event.dy);
      else if (event.type === 'down') { await page.mouse.down(); pressed = true; }
      else if (event.type === 'up') { await page.mouse.up(); pressed = false; }
      else if (event.type === 'hover') await button.hover({ timeout: event.timeout });
      else if (event.type === 'getAttribute') await bounded(button.getAttribute(event.name, { timeout: event.timeout }), event.timeout ?? 3000).catch(error => record('gesture.style.unavailable', { error: String(error) }));
      else if (event.type === 'domClick') await bounded(button.evaluate(event.javascript, event.point), 2000).catch(error => record('gesture.click.unavailable', { error: String(error) }));
      else if (!['replayEnd', 'wait'].includes(event.type)) throw Error(`Unsupported upstream action: ${event.type}`);
    }
  } finally {
    if (pressed) await page.mouse.up();
  }
}
