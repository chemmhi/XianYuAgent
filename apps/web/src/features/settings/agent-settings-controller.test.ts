import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutoReplyAgentSettingsApi } from './api';
import type { AutoReplyAgentConfigVM } from './types';

// Drive hook renders and effect cleanup explicitly so late network responses
// can be released in the dangerous A -> B -> A order without timing sleeps.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, effects: [] as Array<() => void>, cleanups: [] as Array<() => void> }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useCallback: (callback: unknown, deps: unknown[]) => {
    const index = hooks.index++;
    const previous = hooks.slots[index] as { callback: unknown; deps: unknown[] } | undefined;
    if (previous && deps.every((value, i) => value === previous.deps[i])) return previous.callback;
    hooks.slots[index] = { callback, deps }; return callback;
  },
  useEffect: (effect: () => (() => void), deps: unknown[]) => {
    const index = hooks.index++;
    const previous = hooks.slots[index] as unknown[] | undefined;
    if (previous && deps.every((value, i) => value === previous[i])) return;
    hooks.effects.push(() => { hooks.cleanups[index]?.(); hooks.cleanups[index] = effect(); });
    hooks.slots[index] = deps;
  },
}));
import { useAutoReplyAgentSettingsController } from './agent-settings-controller';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const config = (accountId: string, prompt = accountId) => ({ accountId, systemPrompt: prompt, configVersion: 1 }) as AutoReplyAgentConfigVM;

describe('auto reply settings request isolation', () => {
  beforeEach(() => { hooks.slots = []; hooks.effects = []; hooks.cleanups = []; hooks.index = 0; });
  function render(api: AutoReplyAgentSettingsApi, accountId: string) {
    hooks.index = 0;
    const result = useAutoReplyAgentSettingsController(api, accountId);
    hooks.effects.splice(0).forEach(effect => effect());
    return result;
  }
  it('ignores an A save that resolves after B has loaded', async () => {
    const pending = deferred<AutoReplyAgentConfigVM>();
    const api = { get: vi.fn(async (id: string) => config(id)), update: vi.fn((_input: Parameters<AutoReplyAgentSettingsApi['update']>[0]) => pending.promise) };
    render(api, 'A'); await Promise.resolve();
    const saving = render(api, 'A').update({ expectedVersion: 1, patch: { systemPrompt: 'secret-A' } });
    render(api, 'B'); await Promise.resolve();
    pending.resolve(config('A', 'secret-A')); await saving;
    expect(render(api, 'B').state.data?.accountId).toBe('B');
    expect(render(api, 'B').state.data?.systemPrompt).toBe('B');
    expect(api.update.mock.calls[0][0]).toMatchObject({ accountId: 'A' });
  });
  it('does not expose a late A failure as B feedback', async () => {
    const pending = deferred<AutoReplyAgentConfigVM>();
    const api = { get: vi.fn(async (id: string) => config(id)), update: vi.fn((_input: Parameters<AutoReplyAgentSettingsApi['update']>[0]) => pending.promise) };
    render(api, 'A'); await Promise.resolve();
    const saving = render(api, 'A').update({ expectedVersion: 1, patch: {} }).catch(() => undefined);
    render(api, 'B'); await Promise.resolve();
    pending.reject(new Error('A private failure')); await saving;
    expect(render(api, 'B').state.error).toBeNull();
    expect(render(api, 'B').state.data?.accountId).toBe('B');
  });
  it('invalidates older writes even after switching back to the same account', async () => {
    const pending = deferred<AutoReplyAgentConfigVM>();
    const api = { get: vi.fn(async (id: string) => config(id, 'fresh')), update: vi.fn((_input: Parameters<AutoReplyAgentSettingsApi['update']>[0]) => pending.promise) };
    render(api, 'A'); await Promise.resolve();
    const saving = render(api, 'A').update({ expectedVersion: 1, patch: {} });
    render(api, 'B'); await Promise.resolve();
    render(api, 'A'); await Promise.resolve();
    pending.resolve(config('A', 'stale')); await saving;
    expect(render(api, 'A').state.data?.systemPrompt).toBe('fresh');
  });
  it('hides the previous account read failure on the first B render', async () => {
    const pendingB = deferred<AutoReplyAgentConfigVM>();
    const api = { get: vi.fn((id: string) => id === 'A' ? Promise.reject(new Error('private A error')) : pendingB.promise), update: vi.fn() };
    render(api, 'A'); await Promise.resolve();
    expect(render(api, 'A').state.error).toBe('private A error');
    const firstB = render(api, 'B');
    expect(firstB.state).toEqual({ phase: 'loading', data: null, error: null });
    pendingB.resolve(config('B')); await Promise.resolve();
    expect(render(api, 'B').state.data?.accountId).toBe('B');
  });

});
