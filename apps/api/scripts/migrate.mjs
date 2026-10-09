import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://xianyu:xianyu_dev_only@127.0.0.1:5432/xianyu_agent';
const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  let ready = false;
  for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
    try { await pool.query('select 1'); ready = true; } catch (error) { if (attempt === 29) throw error; await new Promise((resolve) => setTimeout(resolve, 1000)); }
  }
  for (const file of files) {
    if (file === '051_auto_reply_quarantine_retention.sql') {
      const invalidIndex = await pool.query(`
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_index i on i.indexrelid = c.oid
        where n.nspname = 'messages'
          and c.relname = 'auto_reply_inbound_quarantine_created_idx'
          and not i.indisvalid
        limit 1
      `);
      if ((invalidIndex.rowCount ?? 0) > 0) {
        await pool.query('drop index concurrently if exists messages.auto_reply_inbound_quarantine_created_idx');
        console.log('dropped invalid migration index: auto_reply_inbound_quarantine_created_idx');
      }
    }
    await pool.query(await readFile(join(migrationsDir, file), 'utf8'));
    console.log(`migration applied: ${file}`);
  }
} finally {
  await pool.end();
}
