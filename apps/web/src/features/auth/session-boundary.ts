/** One boundary per application instance; never carry request failures across logins. */
export function createSessionBoundary() {
  let generation = 0;
  let controller = new AbortController();
  const listeners = new Set<() => void>();
  function advance() { controller.abort(); controller = new AbortController(); return ++generation; }
  return {
    current: () => generation,
    signal: () => controller.signal,
    advance,
    expire(requestGeneration: number) {
      if (requestGeneration !== generation) return;
      advance();
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export type SessionBoundary = ReturnType<typeof createSessionBoundary>;
