import { describe, expect, it, vi } from 'vitest';
import { createSessionBoundary } from './session-boundary';

describe('session boundary', () => {
  it('expires once and aborts the old session requests', () => {
    const boundary = createSessionBoundary(); const listener = vi.fn();
    boundary.subscribe(listener); const old = boundary.signal();
    boundary.expire(boundary.current()); boundary.expire(0);
    expect(listener).toHaveBeenCalledOnce(); expect(old.aborted).toBe(true);
    expect(boundary.signal().aborted).toBe(false);
  });
  it('does not expire a new login when an older request fails late', () => {
    const boundary = createSessionBoundary(); const listener = vi.fn();
    const stop = boundary.subscribe(listener); const old = boundary.current();
    boundary.advance(); boundary.expire(old); expect(listener).not.toHaveBeenCalled();
    stop(); boundary.expire(boundary.current()); expect(listener).not.toHaveBeenCalled();
  });
});
