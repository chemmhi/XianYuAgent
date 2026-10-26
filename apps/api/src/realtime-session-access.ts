/** A realtime connection must recheck authorization without refreshing session idle time. */
export function realtimeSessionAccess(checkAccess: () => Promise<boolean>, onDenied: () => void, intervalMs = 1000): { check: () => Promise<boolean>; current: () => boolean; stop: () => void } {
  let stopped = false;
  let approvedAt = 0;
  let checkingHeartbeat = false;
  function stop() { stopped = true; clearInterval(timer); }
  async function check(): Promise<boolean> {
    if (stopped) return false;
    try { if (await checkAccess()) { approvedAt = Date.now(); return !stopped; } } catch { /* Database/auth failures deny further frames. */ }
    if (!stopped) { stop(); onDenied(); }
    return false;
  }
  const timer = setInterval(() => {
    if (checkingHeartbeat || stopped) return;
    checkingHeartbeat = true;
    void check().finally(() => { checkingHeartbeat = false; });
  }, intervalMs);
  timer.unref();
  return { check, current: () => !stopped && Date.now() - approvedAt < intervalMs, stop };
}
