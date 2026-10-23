set -eu
umask 077
cd /home/ubuntu/xianyu-agent-prod
# Preserve every diagnostic file before removing only the exact /tmp paths.
docker exec xianyu-agent-prod-api-1 tar -C /tmp -czf - xianyu-slider-recording-20261023 xianyu-slider-recording-20261023-browser xianyu-slider-recording-20261023-endpoint xianyu-slider-browser-probe-profile-20261023 > /home/ubuntu/xianyu-slider-recording-20261023-restoration.tar.gz
chmod 600 /home/ubuntu/xianyu-slider-recording-20261023-restoration.tar.gz
sha256sum /home/ubuntu/xianyu-slider-recording-20261023-restoration.tar.gz
docker exec -i xianyu-agent-prod-api-1 node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const owned=['/tmp/xianyu-slider-recording-20261023','/tmp/xianyu-slider-recording-20261023-browser','/tmp/xianyu-slider-recording-20261023-endpoint','/tmp/xianyu-slider-browser-probe-profile-20261023'];
for(const target of owned){const absolute=path.resolve(target);if(!owned.includes(absolute)||path.dirname(absolute)!=='/tmp')throw new Error('Unsafe cleanup target');fs.rmSync(absolute,{recursive:true,force:false});console.log(JSON.stringify({removed: absolute}));}
NODE
git rev-parse HEAD
git diff --exit-code -- . ':!.env'
docker compose -f compose.prod.yml ps --format json
df -h /
