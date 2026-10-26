import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './invite-registration/test-support.mjs';
import { ACCOUNT_MESSAGE_CONNECTION_SQL, messageConnectionStatus } from '../src/account-connection.ts';

for (const enabled of [true, false]) test(`account overview uses the settings default ${enabled} and persisted changes without exposing configuration`, async t => {
  const previous = process.env.AUTO_REPLY_AGENT_ENABLED;
  process.env.AUTO_REPLY_AGENT_ENABLED = String(enabled);
  t.after(() => { if (previous === undefined) delete process.env.AUTO_REPLY_AGENT_ENABLED; else process.env.AUTO_REPLY_AGENT_ENABLED = previous; });
  const f = await fixture('memory', { AUTO_REPLY_AGENT_ENABLED: String(enabled) }); t.after(() => f.close());
  const admin = await f.actor(`overview-${enabled}@example.com`);
  const account = await f.runtime.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: `overview-${enabled}`, displayName: '逐星智能' });
  const settings = await f.request(`/api/v1/settings/agent?accountId=${account.id}`, admin);
  const list = await f.request('/api/v1/accounts', admin);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.items[0].autoReplyEnabled, settings.body.data.enabled);
  assert.equal(list.body.data.items[0].autoReplyEnabled, enabled);
  await f.runtime.autoReplyAgentSettings.update({ adminId: admin.id, accountId: account.id, expectedVersion: 0, patch: { enabled: !enabled, systemPrompt: 'private-prompt-must-not-appear' }, requestId: 'overview', traceId: 'overview' });
  const detail = await f.request(`/api/v1/accounts/${account.id}`, admin);
  assert.equal(detail.body.data.autoReplyEnabled, !enabled);
  assert.doesNotMatch(JSON.stringify(detail.body), /private-prompt|systemPrompt|userPromptTemplate|configDigest/);
  const other = await f.actor(`overview-other-${enabled}@example.com`);
  assert.equal((await f.request('/api/v1/accounts', other)).body.data.total, 0);
  assert.equal((await f.request(`/api/v1/accounts/${account.id}`, other)).status, 404);
});

for (const kind of ['memory', 'postgres']) test(`${kind}: functional degradation does not hide a fresh message heartbeat in the list, detail, or filters`, async t => {
  const f = await fixture(kind); t.after(() => f.close());
  const admin = await f.actor('overview-connection@example.com');
  const account = await f.runtime.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'overview-connection' });
  await f.runtime.store.recordAccountDegraded({ adminId: admin.id, accountId: account.id, source: 'im' });
  await f.runtime.store.setAccountTransport({ adminId: admin.id, accountId: account.id, status: 'connected' });
  const list = await f.request('/api/v1/accounts?connectionStatus=online', admin);
  assert.equal(list.body.data.total, 1);
  assert.equal(list.body.data.items[0].status, 'degraded');
  assert.equal(list.body.data.items[0].connection.status, 'online');
  const detail = await f.request(`/api/v1/accounts/${account.id}`, admin);
  const connection = await f.request(`/api/v1/accounts/${account.id}/connection`, admin);
  assert.equal(detail.body.data.connection.status, connection.body.data.status);
  assert.equal((await f.request('/api/v1/accounts?connectionStatus=unknown', admin)).body.data.total, 0);
  const search = await f.request(`/api/v1/accounts?search=${encodeURIComponent(account.id)}`, admin);
  assert.equal(search.status, 200); assert.equal(search.body.data.total, 1);
  assert.equal(search.body.data.items[0].id, account.id);
});

test('message connection freshness and security states have explicit boundaries', () => {
  const now = Date.now(), recent = new Date(now - 1).toISOString();
  const cases = [
    [{ status: 'degraded', transportStatus: 'connected', transportSeenAt: recent }, 'online'],
    [{ status: 'pending', transportStatus: 'connected', transportSeenAt: recent }, 'online'],
    [{ status: 'disconnected', transportStatus: 'connected', transportSeenAt: recent }, 'online'],
    [{ status: 'connected', transportStatus: 'connected', transportSeenAt: new Date(now - 15_000).toISOString() }, 'offline'],
    [{ status: 'degraded', transportStatus: 'connected', transportSeenAt: new Date(now - 15_000).toISOString() }, 'unknown'],
    [{ status: 'degraded', transportStatus: 'connected', transportSeenAt: new Date(now + 1).toISOString() }, 'unknown'],
    [{ status: 'degraded', transportStatus: 'connected', transportSeenAt: 'invalid' }, 'unknown'],
    [{ status: 'degraded', transportStatus: 'failed' }, 'offline'],
    [{ status: 'degraded', transportStatus: 'connecting' }, 'connecting'],
    [{ status: 'pending' }, 'connecting'],
    [{ status: 'verification_required', transportStatus: 'connected', transportSeenAt: recent }, 'unknown'],
    [{ status: 'expired', transportStatus: 'connected', transportSeenAt: recent }, 'expired'],
    [{ status: 'disabled', transportStatus: 'connected', transportSeenAt: recent }, 'offline'],
  ];
  for (const [account, expected] of cases) assert.equal(messageConnectionStatus(account, now), expected, JSON.stringify(account));
});

test('PostgreSQL filtering expression agrees with the presenter across security, transport, and exact time boundaries', async t => {
  const f = await fixture('postgres'); t.after(() => f.close());
  const client = await f.db.pool.connect();
  try {
    await client.query('begin read only');
    const anchor = (await client.query('select now() as anchor')).rows[0].anchor.getTime();
    const rows = [];
    for (const status of ['pending', 'connected', 'disconnected', 'degraded', 'verification_required', 'expired', 'disabled']) {
      for (const transport of [null, 'connected', 'connecting', 'disconnected', 'failed']) {
        for (const age of [null, -1, 0, 14_999, 15_000, 15_001]) {
          rows.push({ key: String(rows.length), status, risk_episode: null, degraded_source: status === 'degraded' ? 'im' : null,
            transport_status: transport, transport_seen_at: age === null ? null : new Date(anchor - age).toISOString() });
        }
      }
    }
    const result = await client.query(`select a.key, ${ACCOUNT_MESSAGE_CONNECTION_SQL} as connection from jsonb_to_recordset($1::jsonb)
      as a(key text,status text,risk_episode text,degraded_source text,transport_status text,transport_seen_at timestamptz)`, [JSON.stringify(rows)]);
    for (const row of result.rows) {
      const account = rows[Number(row.key)];
      assert.equal(row.connection, messageConnectionStatus({ status: account.status, transportStatus: account.transport_status, transportSeenAt: account.transport_seen_at ?? undefined }, anchor), JSON.stringify(account));
    }
    assert.equal(result.rowCount, 210);
  } finally { await client.query('rollback'); client.release(); }
});

test('deletion tombstones remain listable without reading inaccessible settings', async t => {
  const f = await fixture(); t.after(() => f.close());
  const admin = await f.actor('overview-tombstone@example.com');
  const removing = await f.runtime.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'removing' });
  const active = await f.runtime.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'active' });
  await assert.rejects(f.runtime.store.deleteAccount(admin.id, removing.id, async () => { throw Error('controlled cleanup failure'); }));
  const list = await f.request('/api/v1/accounts?pageSize=1&page=1', admin);
  assert.equal(list.status, 200); assert.equal(list.body.data.total, 2); assert.equal(list.body.data.totalPages, 2);
  const second = await f.request('/api/v1/accounts?pageSize=1&page=2', admin);
  const items = [...list.body.data.items, ...second.body.data.items];
  assert.equal(items.find(row => row.id === removing.id).autoReplyEnabled, null);
  assert.equal(typeof items.find(row => row.id === active.id).autoReplyEnabled, 'boolean');
});

test('settings read failure fails the overview instead of silently claiming automatic replies are off', async t => {
  const f = await fixture(); t.after(() => f.close());
  const admin = await f.actor('overview-read-failure@example.com');
  await f.runtime.store.createAccount({ adminId: admin.id, platform: 'xianyu', sellerRef: 'read-failure' });
  f.runtime.store.listAutoReplyAgentEnabled = async () => { throw Error('controlled read failure'); };
  const result = await f.request('/api/v1/accounts', admin);
  assert.equal(result.status, 500); assert.equal(result.body.success, false);
});

for (const kind of ['memory', 'postgres']) test(`${kind}: enabled summaries batch settings and keep scope, expiry, false, and defaults`, async t => {
  const f = await fixture(kind); t.after(() => f.close());
  const admin = await f.actor(`overview-batch-${kind}@example.com`), other = await f.actor(`overview-batch-other-${kind}@example.com`);
  const create = (sellerRef, adminId = admin.id) => f.runtime.store.createAccount({ adminId, platform: 'xianyu', sellerRef });
  const [on, off, defaults, expired, disabled, foreign] = await Promise.all([
    create('on'), create('off'), create('default'), create('expired-scope'), create('disabled'), create('foreign', other.id),
  ]);
  for (const [account, enabled] of [[on, true], [off, false]]) await f.runtime.autoReplyAgentSettings.update({ adminId: admin.id, accountId: account.id,
    expectedVersion: 0, patch: { enabled }, requestId: 'batch', traceId: 'batch' });
  await f.runtime.store.updateAccount(admin.id, disabled.id, { status: 'disabled' });
  if (f.db) await f.db.pool.query("update auth.account_scopes set expires_at=now()-interval '1 second' where account_id=$1", [expired.id]);
  else (await f.runtime.store.listScopes(admin.id)).find(scope => scope.accountId === expired.id).expiresAt = new Date(Date.now() - 1000).toISOString();
  const defaultEnabled = (await f.runtime.autoReplyAgentSettings.get(admin.id, defaults.id)).enabled;
  f.runtime.store.getAutoReplyAgentConfig = async () => { throw Error('per-account settings read is forbidden in summaries'); };
  let batches = 0;
  const read = f.runtime.store.listAutoReplyAgentEnabled.bind(f.runtime.store);
  f.runtime.store.listAutoReplyAgentEnabled = async (...args) => { batches++; return read(...args); };
  const summary = await f.runtime.autoReplyAgentSettings.enabledForAccounts(admin.id, [on.id, on.id, off.id, defaults.id, expired.id, disabled.id, foreign.id]);
  assert.equal(batches, 1); assert.equal(summary.size, 3);
  assert.equal(summary.get(on.id), true); assert.equal(summary.get(off.id), false);
  assert.equal(summary.get(defaults.id), defaultEnabled);
  assert.equal(summary.has(expired.id), false); assert.equal(summary.has(disabled.id), false); assert.equal(summary.has(foreign.id), false);
  assert.equal((await f.runtime.autoReplyAgentSettings.enabledForAccounts(admin.id, [])).size, 0); assert.equal(batches, 1);
});
