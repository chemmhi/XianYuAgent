import { Pool } from 'pg';
import { loadConfig } from '../dist/config.js';
import { createApp } from '../dist/app.js';

// Dry-run by default. Deployment explicitly opts into the deleted-only sweep.
const accountId = process.argv.find(arg => arg.startsWith('--account-id='))?.slice('--account-id='.length);
const allDeleted = process.argv.includes('--all-deleted');
const apply = process.argv.includes('--apply');
const imOwnerUrl = process.argv.find(arg => arg.startsWith('--im-owner-url='))?.slice('--im-owner-url='.length);
if (Boolean(accountId) === allDeleted || (accountId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId))) throw new Error('Choose exactly one of --account-id=<UUID> or --all-deleted');
const config = loadConfig();
if (!config.databaseUrl || config.allowInMemory) throw new Error('A persistent DATABASE_URL is required');
if (apply && !imOwnerUrl) throw new Error('--apply requires --im-owner-url=<running API URL> so live IM state is drained');
const pool = new Pool({ connectionString: config.databaseUrl });
let runtime;
try {
  const result = await pool.query(`select a.id,a.status,a.deletion_started_at,
      array(select distinct s.admin_id::text from auth.account_scopes s where s.account_id=a.id and s.scope='manage') managers,
      exists(select 1 from auth.account_scopes s where s.account_id=a.id and s.status='active') active_scope
    from accounts.accounts a where a.id=$1::uuid or ($1::uuid is null and a.status='disabled'
      and not exists(select 1 from auth.account_scopes active where active.account_id=a.id and active.status='active'))
    order by a.id`, [accountId ?? null]);
  const candidates = result.rows;
  // Validate the snapshot before applying any destructive change.
  for (const account of candidates) {
    if (account.status !== 'disabled' || account.active_scope) throw new Error('Only a disabled account with no active authorization may be purged');
    if (account.managers.length !== 1) throw new Error('Exactly one historical manager is required');
  }
  let purgedCount = 0;
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', candidateCount: candidates.length }));
  if (apply && candidates.length) runtime = createApp({ ...config, host: '127.0.0.1', port: 0, modelProviderFailoverV2: false }, { imOwnerUrl, verificationRecoveryOwner: false });
  for (const account of candidates) {
    const counts = await pool.query(`select
      (select count(*)::int from products.products where account_id=$1) products,
      (select count(*)::int from orders.orders where account_id=$1) orders,
      (select count(*)::int from messages.messages where account_id=$1) messages`, [account.id]);
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', accountId: account.id, status: account.status, counts: counts.rows[0] }));
    if (apply) {
      await runtime.accounts.delete({ adminId: account.managers[0], accountId: account.id, onlyPreviouslyDeleted: true, requestId: 'legacy-account-purge', traceId: 'legacy-account-purge' });
      const remaining = await pool.query('select 1 from accounts.accounts where id=$1', [account.id]);
      if (remaining.rowCount) throw new Error('Account purge did not finish');
      purgedCount++;
    }
  }
  console.log(JSON.stringify({ deleted: apply, identityReleased: apply, purgedCount, candidateCount: candidates.length }));
} finally {
  await runtime?.close();
  await pool.end();
}
