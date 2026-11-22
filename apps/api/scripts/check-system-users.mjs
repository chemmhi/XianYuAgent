import {xianyuSystemUserPool} from '../dist/xianyu-system-users.js';
const current=xianyuSystemUserPool().snapshot();
console.log(JSON.stringify(current,null,2));
if(!current.ready||current.lastError)process.exitCode=1;
