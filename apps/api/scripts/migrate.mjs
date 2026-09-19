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
    await pool.query(await readFile(join(migrationsDir, file), 'utf8'));
    console.log(`migration applied: ${file}`);
  }
} finally {
  await pool.end();
}
