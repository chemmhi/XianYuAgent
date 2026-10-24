// Mirrors pinned utils/slider_ydisks.py: recover_after_failed_drag.
// Only visible platform retry controls may be clicked; never reload here.
export async function recoverYdisksControl(page, { clock = () => Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), record = () => {} } = {}) {
  const frames = () => page.frames();
  let retry;
  const deadline = clock() + 800;
  do {
    for (const selector of ['#nc_1_refresh1', '.nc_iconfont.btn_refresh', '.errloading', "[class*='refresh']"]) {
      for (const frame of frames()) {
        const element = frame.locator(selector).first();
        if (await element.isVisible().catch(() => false)) { retry = element; break; }
      }
      if (retry) break;
    }
    if (!retry) for (const frame of frames()) {
      const element = frame.locator('.nc-container').first();
      if (await element.isVisible().catch(() => false)) {
        const text = (await element.textContent().catch(() => '')).toLowerCase();
        if (['重试', '刷新', '失败', 'retry', 'refresh', 'failed'].some(s => text.includes(s))) { retry = element; break; }
      }
    }
    if (retry || clock() >= deadline) break;
    await sleep(150);
  } while (true);
  if (!retry) return undefined;
  try { await retry.click({ timeout: 2000 }); record('retry.clicked', {}); }
  catch (error) { record('retry.click.failed', { error: String(error) }); return undefined; }
  const resetDeadline = clock() + 4000;
  while (clock() < resetDeadline) {
    await sleep(300);
    for (const frame of frames()) {
      const button = frame.locator('#nc_1_n1z').first(), track = frame.locator('#nc_1_n1t').first();
      if (!await button.isVisible().catch(() => false) || !await track.isVisible().catch(() => false)) continue;
      const b = await button.boundingBox(), t = await track.boundingBox();
      if (b && t && Math.abs(b.x - t.x) <= 3) { record('retry.origin.confirmed', { button: b, track: t }); return { frame, button }; }
      break;
    }
  }
  return undefined;
}
