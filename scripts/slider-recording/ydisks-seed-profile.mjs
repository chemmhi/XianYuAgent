import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const target = '/browser-data/copied';
if (fs.existsSync(target)) throw Error('Refusing to overwrite an existing diagnostic profile');
fs.mkdirSync(target);
execFileSync('tar', ['-xzf', '/source-profile.tar.gz', '-C', target]);
const profile = `${target}/1d274de5-38b8-4c9b-83ed-d8ba803685ac`;
if (!fs.statSync(profile).isDirectory()) throw Error('Copied account profile missing');
const removed = [];
for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
  const path = `${profile}/${name}`;
  try { fs.lstatSync(path); fs.unlinkSync(path); removed.push(name); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
console.log(JSON.stringify({ profile, source: '/source-profile.tar.gz', removedCopiedLocks: removed }));
