import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

loadEnvFile();
if (!process.env.DATABASE_URL) throw new Error('set DATABASE_URL or provide a root .env file');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const accountFilter = process.env.XIANYU_ACCOUNT_ID;
const params = accountFilter ? [accountFilter] : [];
const accountResult = await pool.query(`
  select a.id::text as account_id, c.cookie_header, c.access_token, c.device_id
  from accounts.accounts a
  join auth.account_credentials c on c.account_id=a.id
  where a.platform='xianyu' and a.status<>'disabled' and c.status='active'
    ${accountFilter ? 'and a.id=$1' : ''}
  order by c.updated_at desc
  limit 1
`, params);
const account = accountResult.rows[0];
if (!account?.cookie_header) throw new Error('no active Xianyu credential with cookie_header found');

if (!process.env.XIANYU_CONVERSATION_REF) {
  const conversationResult = await pool.query(`
    select external_conversation_ref
    from messages.conversations
    where account_id=$1 and external_conversation_ref is not null
    order by updated_at desc
    limit 1
  `, [account.account_id]);
  const conversationRef = conversationResult.rows[0]?.external_conversation_ref;
  if (conversationRef) process.env.XIANYU_CONVERSATION_REF = String(conversationRef);
}

process.env.XIANYU_COOKIE = String(account.cookie_header);
if (account.access_token) process.env.XIANYU_ACCESS_TOKEN = String(account.access_token);
if (account.device_id) process.env.XIANYU_DEVICE_ID = String(account.device_id);
console.log(JSON.stringify({
  source: 'postgres-read-only',
  accountId: tail(account.account_id),
  conversationRef: process.env.XIANYU_CONVERSATION_REF ? tail(process.env.XIANYU_CONVERSATION_REF) : undefined,
  note: 'cookie/accessToken/deviceId loaded in-process and never printed',
}));
await pool.end();
await import('./xianyu-im-gateway-probe.mjs');

function loadEnvFile() {
  if (process.env.DATABASE_URL) return;
  const candidates = [
    process.env.XIANYU_ENV_FILE,
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(process.cwd(), '../.env'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const contents = fs.readFileSync(file, 'utf8');
      for (const line of contents.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
        if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim();
      }
      if (process.env.DATABASE_URL) return;
    } catch {
      // Try the next conventional env-file location.
    }
  }
}

function tail(value) {
  const text = String(value ?? '');
  return text.length <= 8 ? text : `…${text.slice(-8)}`;
}
