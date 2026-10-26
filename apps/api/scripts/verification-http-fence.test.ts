import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createVerificationServiceFixture } from './verification-service-fixture.js';

for (const route of ['detail', 'list'] as const) for (const invalidation of ['logout', 'manage'] as const) {
  test(`HTTP ${route} rechecks ${invalidation} after asynchronous DTO construction`, async () => {
    const f = await createVerificationServiceFixture(); const runtime = f.runtime.verification!;
    let open!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { open = resolve; }), waiting = new Promise<void>(resolve => { entered = resolve; });
    const id = randomUUID(), now = Date.now();
    try {
      await runtime.coordinator.repository.create({ id, ownerId: 'controlled-fixture', subject: { adminId: f.admin.id, accountId: f.account.id },
        state: 'failed', mode: 'manual_only', version: 1, eventSequence: 1, createdAt: now, updatedAt: now, expiresAt: now + 60_000,
        readyAt: now, setupDeadline: now + 8_000, discoveryDeadline: now + 2_000, priorityConsumed: false, controlEpoch: 0, autoAttempts: 0, challengeGeneration: 1 });
      const url = `${f.baseUrl}/api/v1/verification-sessions${route === 'detail' ? `/${id}` : ''}`;
      const normal = await fetch(url, { headers: { cookie: f.cookie } }); assert.equal(normal.status, 200); await normal.json();
      const original = runtime.dto.bind(runtime); let arm = true;
      runtime.dto = async row => { const value = await original(row); if (arm) { arm = false; entered(); await gate; } return value; };
      const pending = fetch(url, { headers: { cookie: f.cookie } }); await waiting;
      await new Promise(resolve => setTimeout(resolve, 1_050));
      if (invalidation === 'logout') await f.runtime.store.revokeSession(f.session.id, 'controlled logout while DTO waited');
      else await f.runtime.store.revokeScope(f.admin.id, f.account.id, 'manage');
      open(); const response = await pending, body = await response.json() as any;
      if (invalidation === 'logout') { assert.equal(response.status, 401); assert.equal(body.data?.session, undefined); assert.equal(body.data?.sessions, undefined); }
      else if (route === 'detail') { assert.equal(response.status, 404); assert.equal(body.data?.session, undefined); }
      else { assert.equal(response.status, 200); assert.deepEqual(body.data.sessions, []); }
      assert.equal(JSON.stringify(body).includes(id), false, 'no stale authorized session DTO reaches HTTP output');
    } finally { open(); await f.close(); }
  });
}
