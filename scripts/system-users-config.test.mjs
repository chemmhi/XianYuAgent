import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
test('deployment initializes missing config exclusively and preserves edited, empty and invalid files',()=>{
  const directory=mkdtempSync(join(tmpdir(),'system-pool-deploy-'));
  const bash=process.env.BASH_PATH??(process.platform==='win32'?resolve(execFileSync('git',['--exec-path'],{encoding:'utf8'}).trim(),'../../../bin/bash.exe'):'bash');
  const source=join(directory,'apps/api/config');mkdirSync(source,{recursive:true});
  writeFileSync(join(source,'xianyu-system-users.example.json'),'Using operator-owned data');
  const run=()=>execFileSync(bash,[join(root,'scripts/initialize-runtime-config.sh'),directory],{encoding:'utf8'});
  try{
    run();
    const target=join(directory,'runtime-config/xianyu-system-users.json');
    assert.equal(readFileSync(target,'utf8'),'Using operator-owned data');
    for(const content of ['{"version":1,"userIds":["1400","2400"]}','', '{invalid']){writeFileSync(target,content);run();assert.equal(readFileSync(target,'utf8'),content);}
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('both containers share read-only directory and validate config before stopping production writers',()=>{
  for(const file of ['compose.prod.yml','docker-compose.yml']){
    const content=readFileSync(join(root,file),'utf8');
    assert.equal((content.match(/XIANYU_SYSTEM_USERS_FILE: \/app\/runtime-config\/xianyu-system-users.json/g)??[]).length,2);
    assert.equal((content.match(/\.\/runtime-config:\/app\/runtime-config:ro/g)??[]).length,2);
  }
  const deploy=readFileSync(join(root,'scripts/deploy-production.sh'),'utf8');
  assert.ok(deploy.indexOf('bash scripts/initialize-runtime-config.sh')<deploy.indexOf('docker compose -f "$COMPOSE_FILE" run'));
  assert.ok(deploy.indexOf('node scripts/check-system-users.mjs')<deploy.indexOf('docker compose -f "$COMPOSE_FILE" stop -t 120 api worker'));
});
