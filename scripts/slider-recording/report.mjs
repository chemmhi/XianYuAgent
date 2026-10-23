import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const root = resolve(process.argv[2]);
const datasets = ['controlled-final', 'live-local', 'native-local', 'native-human', 'tencent-small/xianyu-slider-recording-20261023', 'tencent-browser-small/xianyu-slider-recording-20261023-browser', 'tencent-final/xianyu-slider-recording-20261023-endpoint',
  'upstream-local', 'upstream-existing-challenge', 'xianyu-session-preflight-20261023'];
const all = [];
for (const dataset of datasets) {
  const directory = join(root, dataset);
  if (!existsSync(directory)) continue;
  for (const name of readdirSync(directory).filter((name) => /^events-.*\.ndjson$/.test(name))) {
    for (const line of readFileSync(join(directory, name), 'utf8').trim().split('\n').filter(Boolean)) {
      const event = JSON.parse(line);
      all.push({ ...event, dataset, source: `${dataset}/${name}`, referenceRoot: dataset });
    }
  }
}
all.sort((a, b) => a.utc.localeCompare(b.utc) || a.pid - b.pid || a.sequence - b.sequence);
const requests = [];
for (const event of all.filter((e) => ['fetch.request', 'http.request', 'browser.request'].includes(e.type))) {
  const data = event.data;
  const id = data.requestId ?? data.id;
  const related = all.filter((row) => row.dataset === event.dataset && (row.data.requestId ?? row.data.id) === id && row !== event);
  let url;
  try { url = new URL(data.url, 'http://local-application'); } catch {}
  const decodedBodies = related.filter((row) => row.data.body?.path).map((row) => {
    const body=readFileSync(join(root,event.referenceRoot,row.data.body.path));
    const text=body.toString('utf8');
    let decoded;
    try{decoded=JSON.parse(text);}catch{
      if(/^(?:data=|[A-Za-z0-9_.%-]+=)/.test(text)&&!text.includes('\u0000')){const fields=[...new URLSearchParams(text)];decoded={form:fields.map(([name,value])=>{try{return {name,value,json:JSON.parse(value)};}catch{return {name,value};}})};}
    }
    return {type:row.type,raw:row.data.body,decoded};
  });
  requests.push({ dataset: event.dataset, utc: event.utc, protocol: event.type.split('.')[0], id, method: data.method, url: data.url,
    endpoint: url ? `${url.origin}${url.pathname}` : data.url, queryParameters: url ? [...url.searchParams] : [],
    input: data, intermediateAndOutput: related.map((row) => ({ utc: row.utc, type: row.type, data: row.data })), decodedBodies,
    source: event.source, referenceRoot: event.referenceRoot,
  });
}
const browserCalls = all.filter((event) => event.type === 'browser.call.input').map((event) => ({ ...event, output: all.find((row) => row.dataset === event.dataset && row.data.callId === event.data.callId && ['browser.call.output', 'browser.call.error'].includes(row.type)) }));
const fingerprints = [];
for (const event of all.filter((e) => e.type === 'browser.snapshot')) {
  const path = join(root, event.referenceRoot, event.data.path);
  if (existsSync(path)) fingerprints.push({ utc: event.utc, dataset: event.dataset, snapshot: relative(root, path).replaceAll('\\', '/'), ...JSON.parse(readFileSync(path, 'utf8')) });
}
const gaps = all.filter((event) => event.type.startsWith('recording.') || event.type === 'browser.response.body.unavailable' || event.type === 'browser.requestfailed');
for (const [name, value] of [['timeline.json', all], ['interfaces.json', requests], ['browser-operations.json', browserCalls], ['fingerprints-and-dom.json', fingerprints], ['capture-gaps.json', gaps]]) writeFileSync(join(root, name), `${JSON.stringify(value, null, 2)}\n`);
const counts = {};
for (const request of requests) { const key = `${request.dataset} ${request.method} ${request.endpoint}`; counts[key] = (counts[key] ?? 0) + 1; }
writeFileSync(join(root, 'interface-counts.json'), JSON.stringify(counts, null, 2));
const acceptance = JSON.parse(readFileSync(join(root, 'acceptance.json'), 'utf8'));
const md = `# 本地与腾讯云滑块记录（存在采集缺口）\n\n所有本地文件保留原始内容，不脱敏。\n\n- 源码与环境：manifest.json、baseline/、runtime-env.json、process-*.json、各子目录 process-*.json。\n- 时间线：timeline.json（${all.length} 条）；根目录 events-*.ndjson 另含准备、命令与 SSH 的完整原文。\n- 接口与参数：interfaces.json（${requests.length} 次），包含完整 URL、query、headers、请求/响应正文引用和关联输出。二进制原文位于对应数据集 blobs/，文件名为 SHA-256。\n- 浏览器操作：browser-operations.json（${browserCalls.length} 次），包括定位、矩形、鼠标、Cookie、页面求值的实际输入输出；slider.random 事件记录随机源输出。\n- 实际指纹、页面、Cookie 与 Storage：fingerprints-and-dom.json（${fingerprints.length} 个阶段），以及 browser-*/snapshot-*、network.har、trace.zip、profile-before/profile-after。\n- 浏览器人工操作与官方 IM：browser-actions.ndjson、production-browser-network.ndjson、production-cookie-login-responses.json、official-im-browser-network.ndjson，以及各 DOM/截图和原始 Cookie 文件。\n- 数据库初始状态：db-before.stdout.log（完整 pg_dump SQL）；腾讯云原始 auth/accounts 快照保存在服务器 /tmp/xianyu-slider-recording-20261023-db-before.sql，本地副本为 tencent-db-before-download.stdout.log。\n- 捕获缺口：capture-gaps.json（${gaps.length} 条）。这是实际限制清单，不能宣称“全部响应无缺失”。快速导航可能导致浏览器无法再次读取初始响应正文；仍保留 HAR、trace、最终 DOM、请求及对应错误。\n- 校验：在采集进程停止后执行 session.mjs seal，生成 integrity.json。采集进行中的文件不具有最终校验值。\n\n## 原样还原的范围\n\n本地 source、lockfile、Node/Chrome 二进制、配置、数据库、Cookie、profile、请求参数和鼠标调用均有原始留档。浏览器诊断会增加 I/O 和等待时间，操作的实际时间与计划时间一并记录。GitHub 外部对照不是验证通过证据。远端挑战、签名与凭证有时效，平台内部风控和网络时序不能冻结，不能保证未来重放得到相同外部响应。\n\n## 最终验收结论\n\n${acceptance.overall}：代码自动通过真实挑战=${acceptance.automaticChallengePassed}；人工结果计入验收=${acceptance.manualResultCountsTowardAcceptance}。人工成功单独保存在 native-human/，不构成代码成功。人工 Cookie/token 未向服务器回写；人工挑战前曾通过生产 Cookie 登录接口修改凭证记录。\n\n最后只读快照（${acceptance.lastObservedProduction.observedAt}）：账号 ${acceptance.lastObservedProduction.status}，transport ${acceptance.lastObservedProduction.transport}，token 存在=${acceptance.lastObservedProduction.hasToken}。不能认定账号已由代码恢复正常。\n\n本次不满足唯一验收标准。实际变更与清理见 ENVIRONMENT-AUDIT.md，机器结论见 acceptance.json。受控夹具和回归通过仅证明相应测试范围。capture-gaps.json、浏览器缓冲截断与缺失人工轨迹意味着无法无缺口 1:1 重现外部结果。\n`;
writeFileSync(join(root, 'README.md'), md);
console.log(JSON.stringify({ events: all.length, requests: requests.length, browserCalls: browserCalls.length, snapshots: fingerprints.length, captureGaps: gaps.length }));
