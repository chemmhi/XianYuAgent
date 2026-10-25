import { Pool } from 'pg';
import { loadConfig } from '../dist/config.js';
import { createApp } from '../dist/app.js';

// Dry-run by default. The exact UUID must be supplied; never sweep all accounts.
const accountId = process.argv.find(arg => arg.startsWith('--account-id='))?.slice('--account-id='.length);
const apply = process.argv.includes('--apply');
const imOwnerUrl = process.argv.find(arg => arg.startsWith('--im-owner-url='))?.slice('--im-owner-url='.length);
if (!accountId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) throw new Error('An exact --account-id=<UUID> is required');
const config = loadConfig();
if (!config.databaseUrl || config.allowInMemory) throw new Error('A persistent DATABASE_URL is required');
if (apply && !imOwnerUrl) throw new Error('--apply requires --im-owner-url=<running API URL> so live IM state is drained');
const pool = new Pool({ connectionString: config.databaseUrl });
let runtime;
try {
  const result = await pool.query(`select a.id,a.status,a.deletion_started_at,
      array(select distinct s.admin_id::text from auth.account_scopes s where s.account_id=a.id and s.scope='manage') managers,
      exists(select 1 from auth.account_scopes s where s.account_id=a.id and s.status='active') active_scope
    from accounts.accounts a where a.id=$1`, [accountId]);
  const account = result.rows[0];
  if (!account) { console.log(JSON.stringify({ alreadyRemoved: true })); }
  else {
    if (account.status !== 'disabled' || (account.active_scope && !account.deletion_started_at)) throw new Error('Only an already deleted or interrupted-deletion account may be purged');
    if (account.managers.length !== 1) throw new Error('Exactly one historical manager is required');
    const counts = await pool.query(`select
      (select count(*)::int from products.products where account_id=$1) products,
      (select count(*)::int from orders.orders where account_id=$1) orders,
      (select count(*)::int from messages.messages where account_id=$1) messages`, [accountId]);
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', accountId, status: account.status, counts: counts.rows[0] }));
    if (apply) {
      runtime = createApp({ ...config, host: '127.0.0.1', port: 0, modelProviderFailoverV2: false }, { imOwnerUrl, verificationRecoveryOwner: false });
      await runtime.accounts.delete({ adminId: account.managers[0], accountId, requestId: 'legacy-account-purge', traceId: 'legacy-account-purge' });
      const remaining = await pool.query('select 1 from accounts.accounts where id=$1', [accountId]);
      if (remaining.rowCount) throw new Error('Account purge did not finish');
      console.log(JSON.stringify({ deleted: true, identityReleased: true }));
    }
  }
} finally {
  await runtime?.close();
  await pool.end();
}
