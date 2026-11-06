import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

export async function passwordTestDatabase() {
  const value = process.env.PASSWORD_LOGIN_TEST_DATABASE_URL;
  if (!value) throw new Error('PASSWORD_LOGIN_TEST_DATABASE_URL is required');
  const url = new URL(value);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/xianyu_password_login_test') throw new Error('isolated local password-login test database required');
  const owner = new pg.Pool({ connectionString: url.href }), name = 'password_login_' + randomUUID().replaceAll('-', '');
  await owner.query('CREATE DATABASE ' + name); url.pathname = '/' + name;
  const pool = new pg.Pool({ connectionString: url.href });
  const close = async () => { await pool.end(); await owner.query('DROP DATABASE ' + name + ' WITH (FORCE)'); await owner.end(); };
  try {
    const directory = new URL('../migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter(f => f.endsWith('.sql')).sort()) await pool.query(await readFile(new URL(file, directory), 'utf8'));
    return { pool, url: url.href, close };
  } catch (error) { await close(); throw error; }
}
