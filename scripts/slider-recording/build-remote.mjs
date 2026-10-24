import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2]);
const probeMode = process.argv[3] ?? 'production';
const isBrowserProbe = ['browser','endpoint'].includes(probeMode);
const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const result = await build({
  entryPoints: [join(project, `scripts/slider-recording/${isBrowserProbe ? 'tencent-browser-probe-entry.mjs' : 'tencent-probe-entry.mjs'}`)], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node24', packages: 'external',
  plugins: [{ name: 'existing-container-dependencies', setup(builder) {
    builder.onResolve({ filter: /^patchright$/ }, () => ({ path: '/app/node_modules/patchright/index.mjs', external: true }));
    builder.onResolve({ filter: /^ws$/ }, () => ({ path: '/app/node_modules/ws/wrapper.mjs', external: true }));
    builder.onResolve({ filter: /^\/app\// }, (args) => ({ path: args.path, external: true }));
  } }],
});
const suffix = isBrowserProbe ? `-${probeMode}` : '';
const script = `set -eu\ncd /home/ubuntu/xianyu-agent-prod\n${probeMode === 'production' ? 'docker compose -f compose.prod.yml exec -T postgres pg_dump -U xianyu -d xianyu_agent --schema=auth --schema=accounts > /tmp/xianyu-slider-recording-20261023-db-before.sql\n' : ''}docker compose -f compose.prod.yml exec -T -e XIANYU_RECORD_DIR=/tmp/xianyu-slider-recording-20261023${suffix} ${probeMode==='endpoint'?'-e XIANYU_PROBE_STRATEGY=endpoint ':''}api xvfb-run --auto-servernum --server-args='-screen 0 1440x900x24 -nolisten tcp' node --input-type=module <<'RECORDED_DIAGNOSTIC_NODE'\n${result.outputFiles[0].text}\nRECORDED_DIAGNOSTIC_NODE\n`;
mkdirSync(root, { recursive: true });
writeFileSync(join(root, `tencent-probe${suffix}.sh`), script);
console.log(JSON.stringify({ script: join(root, `tencent-probe${suffix}.sh`), bytes: Buffer.byteLength(script) }));
