set -eu
cd /home/ubuntu/xianyu-agent-prod
docker compose -f compose.prod.yml exec -T postgres psql -U xianyu -d xianyu_agent -c 'TABLE accounts.accounts;'
docker compose -f compose.prod.yml exec -T api ps -eo pid,args
docker compose -f compose.prod.yml exec -T api google-chrome --version
docker compose -f compose.prod.yml exec -T api node --input-type=module <<'NODE'
import fs from 'node:fs';
import { XIANYU_USER_AGENT, xianyuBrowserIdentity } from '/app/dist/xianyu-browser-identity.js';
console.log(JSON.stringify({ identity: xianyuBrowserIdentity(XIANYU_USER_AGENT), inheritedEnvironment: process.env }, null, 2));
for (const pid of fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
  try {
    const command = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    if (command.includes('dist/index.js')) console.log(JSON.stringify({ pid, command, effectiveEnvironment: fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0') }));
  } catch {}
}
NODE
