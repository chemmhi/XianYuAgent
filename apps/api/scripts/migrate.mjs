import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
const pool = new pg.Pool({ connectionString: databaseUrl });
const onlineIndexes = {
  '051_auto_reply_quarantine_retention.sql': ['messages', 'auto_reply_inbound_quarantine_created_idx'],
  '072_audit_retention_index.sql': ['observability', 'audit_events_created_idx'],
  '073_audit_dedupe_index.sql': ['observability', 'audit_events_dedupe_idx'],
  '074_quarantine_dedupe_index.sql': ['messages', 'auto_reply_inbound_quarantine_dedupe_idx'],
};
try {
  let ready = false;
  for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
    try { await pool.query('select 1'); ready = true; } catch (error) { if (attempt === 29) throw error; await new Promise((resolve) => setTimeout(resolve, 1000)); }
  }
  for (const file of files) {
    if (onlineIndexes[file]) {
      const [schema, name] = onlineIndexes[file];
      const invalidIndex = await pool.query(`
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_index i on i.indexrelid = c.oid
        where n.nspname = $1
          and c.relname = $2
          and not i.indisvalid
        limit 1
      `, [schema, name]);
      if ((invalidIndex.rowCount ?? 0) > 0) {
        // Both identifiers come exclusively from the static allowlist above.
        await pool.query(`drop index concurrently if exists "${schema}"."${name}"`);
        console.log(`dropped invalid migration index: ${schema}.${name}`);
      }
    }
    await pool.query(await readFile(join(migrationsDir, file), 'utf8'));
    console.log(`migration applied: ${file}`);
  }
} finally {
  await pool.end();
}
