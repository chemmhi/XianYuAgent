import type { PoolClient } from 'pg';

// Ownership follows account_id and incoming foreign keys only. Never infer
// ownership from arbitrary business JSON or from the account's administrator.
const schemas = ['accounts', 'auth', 'products', 'orders', 'coupons', 'messages', 'execution', 'automation', 'workspace', 'observability', 'settings', 'public'];
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const tableName = (key: string) => key.split('.').map(quote).join('.');
type Edge = { child: string; parent: string; columns: string[]; references: string[] };

export interface AccountDeletionResources { accountId: string; productIds: string[]; loginSessionIds: string[] }
export type AccountDeletionCleanup = (resources: AccountDeletionResources) => Promise<void>;

export async function purgeAccountRows(client: PoolClient, accountId: string): Promise<void> {
  const metadata = await client.query(`select c.table_schema,c.table_name,c.column_name from information_schema.columns c
    join information_schema.tables t using(table_schema,table_name)
    where c.table_schema=any($1::text[]) and t.table_type='BASE TABLE'`, [schemas]);
  const columns = new Map<string, Set<string>>();
  for (const row of metadata.rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    if (!columns.has(key)) columns.set(key, new Set());
    columns.get(key)!.add(row.column_name);
  }
  const constraints = await client.query(`select cn.nspname||'.'||ct.relname child,pn.nspname||'.'||pt.relname parent,
    array_agg(ca.attname::text order by pair.ord) columns,array_agg(pa.attname::text order by pair.ord) as "references"
    from pg_constraint fk join pg_class ct on ct.oid=fk.conrelid join pg_namespace cn on cn.oid=ct.relnamespace
    join pg_class pt on pt.oid=fk.confrelid join pg_namespace pn on pn.oid=pt.relnamespace
    cross join lateral unnest(fk.conkey,fk.confkey) with ordinality pair(c,p,ord)
    join pg_attribute ca on ca.attrelid=ct.oid and ca.attnum=pair.c
    join pg_attribute pa on pa.attrelid=pt.oid and pa.attnum=pair.p
    where fk.contype='f' and cn.nspname=any($1::text[]) group by fk.oid,cn.nspname,ct.relname,pn.nspname,pt.relname`, [schemas]);
  const edges = constraints.rows as Edge[];
  const predicates = new Map<string, string>();
  const depths = new Map<string, number>();
  function predicate(key: string, stack: string[] = []): string {
    if (stack.includes(key)) throw new Error('ACCOUNT_PURGE_SCHEMA_CYCLE');
    if (predicates.has(key)) return predicates.get(key)!;
    const alias = `t${[...columns.keys()].indexOf(key)}`;
    const parts: string[] = [];
    let depth = 0;
    if (key === 'accounts.accounts') parts.push(`${alias}.id=$1::uuid`);
    else if (columns.get(key)?.has('account_id')) parts.push(`${alias}.account_id::text=$1::text`);
    for (const edge of edges.filter(edge => edge.child === key)) {
      // A shared administrator is never an ownership root.
      if (edge.parent === 'auth.admins' || edge.parent === key) continue;
      const parent = predicate(edge.parent, [...stack, key]);
      if (!parent) continue;
      const parentAlias = `t${[...columns.keys()].indexOf(edge.parent)}`;
      const joins = edge.columns.map((column, i) => `${parentAlias}.${quote(edge.references[i])}=${alias}.${quote(column)}`).join(' and ');
      parts.push(`exists(select 1 from ${tableName(edge.parent)} ${parentAlias} where ${joins} and (${parent}))`);
      depth = Math.max(depth, (depths.get(edge.parent) ?? 0) + 1);
    }
    const result = parts.map(part => `(${part})`).join(' or ');
    predicates.set(key, result); depths.set(key, depth);
    return result;
  }
  for (const key of columns.keys()) predicate(key);
  const ownedIds = new Set<string>([accountId]);
  const executionKeys = new Set<string>();
  // Capture bridge IDs before any parent is removed (audit targets, queue
  // aggregates and cached responses do not all have foreign keys).
  for (const [key, where] of predicates) {
    if (!where) continue;
    const alias = `t${[...columns.keys()].indexOf(key)}`;
    const rows = await client.query(`select to_jsonb(${alias}) data from ${tableName(key)} ${alias} where ${where} for update`, [accountId]);
    for (const { data } of rows.rows) {
      if (typeof data.id === 'string' && /^[0-9a-f-]{36}$/i.test(data.id)) ownedIds.add(data.id);
      if (typeof data.execution_key === 'string') executionKeys.add(data.execution_key);
    }
  }
  const ids = [...ownedIds];
  if (columns.has('execution.idempotency_records')) await client.query(`delete from execution.idempotency_records r
    where exists(select 1 from unnest($1::text[]) id where strpos(r.scope,id)>0 or strpos(r.response_envelope::text,id)>0)`, [ids]);
  if (columns.has('execution.outbox_jobs')) await client.query(`delete from execution.outbox_jobs r
    where exists(select 1 from unnest($1::text[]) id where r.aggregate_id::text=id or strpos(r.payload_json::text,id)>0)`, [ids]);
  if (columns.has('automation.execution_ledger')) await client.query(`delete from automation.execution_ledger
    where split_part(execution_key,':',2)=$1 or execution_key=any($2::text[])`, [accountId, [...executionKeys]]);
  if (columns.has('observability.audit_events')) await client.query(`delete from observability.audit_events where target_ref=any($1::text[]) or account_id=$2`, [ids, accountId]);
  for (const [key, where] of [...predicates].filter(([, where]) => where).sort((a, b) => depths.get(b[0])! - depths.get(a[0])!)) {
    await client.query(`delete from ${tableName(key)} t${[...columns.keys()].indexOf(key)} where ${where}`, [accountId]);
  }
}
