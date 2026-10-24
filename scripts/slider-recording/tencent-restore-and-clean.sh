set -eu
cd /home/ubuntu/xianyu-agent-prod
git rev-parse HEAD
git diff --exit-code -- . ':!.env'
docker compose -f compose.prod.yml ps --format json
docker compose -f compose.prod.yml exec -T api node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const paths=['/tmp/xianyu-slider-recording-20261023','/tmp/xianyu-slider-recording-20261023-browser','/tmp/xianyu-slider-recording-20261023-endpoint','/tmp/xianyu-slider-browser-probe-profile-20261023'];
// Retain evidence until the local archive has been verified. This stage only
// inventories the exact diagnostic paths and verifies no diagnostic Node runs.
const processes=[];
for(const pid of fs.readdirSync('/proc').filter(name=>/^\d+$/.test(name))){try{const command=fs.readFileSync(`/proc/${pid}/cmdline`,'utf8');if(command.includes('node')&&command.includes('--input-type=module'))processes.push({pid,command});}catch{}}
console.log(JSON.stringify({paths:paths.map(p=>({path:path.resolve(p),exists:fs.existsSync(p)})),processes,productionSourceUntouched:true}));
NODE
