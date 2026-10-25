import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthApi, AuthSessionView } from './api';
import { createSessionBoundary } from './session-boundary';

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, effects: [] as Array<() => void>, cleanups: [] as Array<() => void> }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.slots)) hooks.slots[index] = initial; return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next; }]; },
  useCallback: (callback: unknown, deps: unknown[]) => {
    const index = hooks.index++; const previous = hooks.slots[index] as { callback: unknown; deps: unknown[] } | undefined;
    if (previous && deps.every((value, i) => value === previous.deps[i])) return previous.callback;
    hooks.slots[index] = { callback, deps }; return callback;
  },
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    const index = hooks.index++; const previous = hooks.slots[index] as unknown[] | undefined;
    if (previous && deps.every((value, i) => value === previous[i])) return;
    hooks.effects.push(() => { hooks.cleanups[index]?.(); const cleanup = effect(); if (cleanup) hooks.cleanups[index] = cleanup; }); hooks.slots[index] = deps;
  },
}));
import { useAuthController } from './controller';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const session = (id: string): AuthSessionView => ({ authenticated: true, bootstrapRequired: false, admin: { id, email: id + '@example.com', displayName: id, role: 'user' } });
function api(overrides: Partial<AuthApi> = {}): AuthApi {
  return { getSession: vi.fn(async () => session('A')), login: vi.fn(async () => session('B')), logout: vi.fn(async () => undefined), register: vi.fn(async () => session('B')), bootstrap: vi.fn(async () => session('B')), ...overrides };
}
describe('authentication request generation', () => {
  beforeEach(() => { hooks.slots = []; hooks.index = 0; hooks.effects = []; hooks.cleanups = []; });
  function renderer(authApi: AuthApi) {
    const boundary = createSessionBoundary();
    return { boundary, render() { hooks.index = 0; const result = useAuthController(authApi, boundary); hooks.effects.splice(0).forEach(effect => effect()); return result; } };
  }
  it('does not let a late session refresh replace a newer successful login', async () => {
    const old = deferred<AuthSessionView>(); const test = renderer(api({ getSession: () => old.promise }));
    const controller = test.render(); await controller.login({ email: 'B@example.com', password: 'password' });
    old.resolve(session('A')); await Promise.resolve();
    expect(test.render().admin?.id).toBe('B');
  });
  it('does not let an older logout clear the next user session', async () => {
    const old = deferred<void>(); const test = renderer(api({ logout: () => old.promise }));
    test.render(); await Promise.resolve(); const controller = test.render(); const loggingOut = controller.logout();
    await controller.login({ email: 'B@example.com', password: 'password' }); old.resolve(); await loggingOut;
    expect(test.render().phase).toBe('authenticated'); expect(test.render().admin?.id).toBe('B');
  });
  it('ignores an older login response after the next login finishes', async () => {
    const old = deferred<AuthSessionView>(); const test = renderer(api({ login: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(session('C')) }));
    test.render(); await Promise.resolve(); const controller = test.render(); const loggingIn = controller.login({ email: 'B@example.com', password: 'password' });
    await controller.login({ email: 'C@example.com', password: 'password' }); old.resolve(session('B')); await loggingIn;
    expect(test.render().admin?.id).toBe('C');
  });
  it('clears private state on current session expiry', async () => {
    const test = renderer(api()); test.render(); await Promise.resolve(); expect(test.render().admin?.id).toBe('A');
    test.boundary.expire(test.boundary.current()); const current = test.render();
    expect(current.phase).toBe('login-required'); expect(current.admin).toBeNull(); expect(current.session?.authenticated).toBe(false);
  });
});
