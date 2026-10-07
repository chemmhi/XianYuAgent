import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveModelProviderRouting } from '../src/app.js';
import { ServiceError } from '../src/services.js';

const stored = {
  accountId: 'account-1',
  mode: 'manual_primary' as const,
  preferredRole: 'primary' as const,
  routingVersion: 3,
  configGeneration: 7,
  createdAt: '2026-10-07T00:00:00.000Z',
  updatedAt: '2026-10-07T00:01:00.000Z',
};

test('Store routing wins over a newer Redis mirror and repairs the mirror', async () => {
  const syncs: unknown[] = [];
  const settings = {
    getRouting: async () => stored,
  };
  const runtime = {
    readRoutingMirror: async () => ({ ...stored, routingVersion: 4, mode: 'manual_backup' as const, preferredRole: 'backup' as const }),
    syncRouting: async (input: { accountId: string; routing: unknown }) => { syncs.push(input); },
  };

  const result = await resolveModelProviderRouting(settings as never, runtime as never, 'admin-1', 'account-1', 7);
  assert.deepEqual(result, stored);
  assert.deepEqual(syncs, [{ accountId: 'account-1', routing: stored }]);
});

test('Store failure is not masked by a readable Redis mirror', async () => {
  const storeError = new ServiceError(503, 'MODEL_ROUTING_STATE_UNAVAILABLE', 'routing unavailable');
  const settings = {
    getRouting: async () => { throw storeError; },
  };
  const runtime = {
    readRoutingMirror: async () => ({ ...stored, routingVersion: 9 }),
    syncRouting: async () => undefined,
  };

  await assert.rejects(
    () => resolveModelProviderRouting(settings as never, runtime as never, 'admin-1', 'account-1', 7),
    (error: unknown) => error === storeError,
  );
});
