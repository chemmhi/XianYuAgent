set -eu
cd /home/ubuntu/xianyu-agent-prod
docker compose -f compose.prod.yml exec -T api node --input-type=module <<'NODE'
import fs from 'node:fs';
const root='/tmp/xianyu-slider-recording-20261023';
const list=fs.existsSync(root)?fs.readdirSync(root):[];
for(const name of list.filter(name=>name.endsWith('.ndjson'))){const rows=fs.readFileSync(`${root}/${name}`,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);console.log(JSON.stringify({name,count:rows.length,last:rows.slice(-5).map(e=>({utc:e.utc,type:e.type,method:e.data.method,scope:e.data.scope,error:e.data.error?.message})),errors:rows.filter(e=>e.type.startsWith('recording.')).length}));}
console.log(JSON.stringify({files:list}));
NODE
