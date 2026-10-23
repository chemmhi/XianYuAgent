// Bounded diagnostic comparison of endpoint handling and the published
// upstream short overshoot trajectory. It does not alter the production solver.
export async function probeEndpointDrag(page, frame, recording) {
  const strategies = [
    { name: 'exact-endpoint-hold', ratio: 1, steps: 28, durationMs: 900, holdMs: 1000, curve: 'out' },
    { name: 'upstream-short-overshoot', ratio: 2.02, steps: 8, durationMs: 120, holdMs: 180, curve: 'accelerate' },
    { name: 'small-overshoot-hold', ratio: 1.05, steps: 32, durationMs: 1250, holdMs: 1700, curve: 'out' },
  ];
  const output = [];
  for (const strategy of strategies) {
    const button = frame.locator('#nc_1_n1z').first();
    const track = frame.locator('#nc_1_n1t').first();
    if (!await button.isVisible()) { recording.event('drag.probe.unavailable', { strategy }); break; }
    const buttonRect = await button.boundingBox(), trackRect = await track.boundingBox();
    if (!buttonRect || !trackRect) break;
    const distance = trackRect.x + trackRect.width - buttonRect.x - buttonRect.width;
    const startX=buttonRect.x+buttonRect.width/2,startY=buttonRect.y+buttonRect.height/2;
    const points=Array.from({length:strategy.steps},(_,index)=>{const t=(index+1)/strategy.steps;const progress=strategy.curve==='accelerate'?t**1.52:1-(1-t)**2;return {x:startX+distance*strategy.ratio*progress,y:startY+Math.sin(t*Math.PI)*0.8,atMs:strategy.durationMs*t};});
    recording.json(`drag-probe-${process.pid}-${strategy.name}-input.json`, { strategy, buttonRect, trackRect, distance, points, url:frame.url() });
    await page.mouse.move(startX-20,startY-2);await page.waitForTimeout(120);await page.mouse.move(startX,startY);await page.waitForTimeout(100);
    const start=performance.now();
    await page.mouse.down();
    try {
      for (const point of points) { const wait=point.atMs-(performance.now()-start);if(wait>0)await page.waitForTimeout(wait);await page.mouse.move(point.x,point.y); }
      await page.waitForTimeout(strategy.holdMs);
    } finally { await page.mouse.up(); }
    await page.waitForTimeout(2500);
    const cookies=await page.context().cookies();
    const state={strategy,url:frame.url(),html:await frame.content().catch(String),cookies,elapsedMs:performance.now()-start};
    recording.json(`drag-probe-${process.pid}-${strategy.name}-output.json`,state);
    output.push({name:strategy.name,hasX5sec:cookies.some(cookie=>cookie.name==='x5sec'),url:frame.url()});
    if(cookies.some(cookie=>cookie.name==='x5sec')) return {success:true,attempts:output};
    const retry=frame.locator('#nc_1_refresh1, .errloading, .nc-lang-cnt').first();
    try { await retry.click({timeout:1500}); await page.waitForTimeout(3000); }
    catch(error){recording.event('drag.probe.retry.failed',{error});break;}
  }
  return {success:false,attempts:output};
}
