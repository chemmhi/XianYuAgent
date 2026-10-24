"""Build an index of original evidence, preserving raw values and failures."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit, parse_qsl

root = Path(os.environ['XIANYU_COPY_INPUT_DIR'])
directories = [root, *[p for p in root.iterdir() if p.is_dir()]]
interfaces, gaps, cases = {}, [], {}
total = indexed = 0
with (root / 'request-response-index.ndjson').open('w', encoding='utf-8') as output:
    for directory in directories:
        label = directory.relative_to(root).as_posix()
        for file in directory.glob('events-*.ndjson'):
            for line, raw in enumerate(file.open(encoding='utf-8'), 1):
                if not raw.strip():
                    continue
                try:
                    event = json.loads(raw)
                except Exception as error:
                    gaps.append({'eventFile': file.relative_to(root).as_posix(), 'line': line, 'error': str(error)})
                    continue
                total += 1
                kind, data = event['type'], event.get('data', {})
                pointer = {'eventFile': file.relative_to(root).as_posix(), 'line': line, 'recordingDirectory': label}
                if any(t in kind for t in ['recording.error', 'recording.incomplete', 'response.body.unavailable', 'profile.archive.error']):
                    gaps.append({**pointer, **event})
                if any(t in kind for t in ['request', 'response', 'ws.', 'browser.call.input', 'gesture.', 'native.fetch']):
                    entry = {**pointer, **event}
                    if data.get('url'):
                        url = urlsplit(data['url'])
                        entry['queryParameters'] = parse_qsl(url.query, keep_blank_values=True)
                        if kind.endswith('request'):
                            key = f"{data.get('method', 'GET')} {url.scheme}://{url.netloc}{url.path}"
                            interfaces[key] = interfaces.get(key, 0) + 1
                    output.write(json.dumps(entry, ensure_ascii=False) + '\n')
                    indexed += 1
                if not label.endswith('-challenge') and not (directory / 'native-judgment-1.json').exists():
                    continue
                state = cases.setdefault(label, {'label': label, 'actualDrags': 0, 'codes': [], 'pressedMs': []})
                if kind == 'gesture.dispatch':
                    if data['event']['type'] == 'down':
                        state['actualDrags'] += 1
                        state['_down'] = event['elapsedMs']
                    elif data['event']['type'] == 'up' and '_down' in state:
                        state['pressedMs'].append(event['elapsedMs'] - state['_down'])
                if 'initialDocumentTokenObserved' not in state and kind == 'browser.request' and data.get('resourceType') == 'document' and '/punish?' in data['url']:
                    names = [p.strip().split('=', 1)[0] for p in data.get('headers', {}).get('cookie', '').split(';') if '=' in p]
                    state['challengeRequestCookieNames'] = names
                    state['initialDocumentTokenObserved'] = '_m_h5_tk' in names


def save(name, value):
    (root / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


for label, state in cases.items():
    directory = root / label
    state.pop('_down', None)
    judgment_files = [*directory.glob('judgment-*.json'), *directory.glob('native-judgment-*.json')]
    state['codes'] = [json.loads(p.read_text(encoding='utf-8'))['body']['code'] for p in sorted(judgment_files)]
    result = directory / 'result.json'
    if result.exists():
        state['result'] = {k: v for k, v in json.loads(result.read_text(encoding='utf-8')).items() if k not in ['judgments', 'finalUrl']}
    else:
        state['interrupted'] = True


def production(label):
    raw = (root / f'{label}.stdout.log').read_text(encoding='utf-8')
    return json.JSONDecoder().raw_decode(raw[raw.index('{"observedAt"'):])[0]


before, after = production('production-before'), production('production-final-state')
changed = lambda a, b: [k for k in set(a) | set(b) if a.get(k) != b.get(k)]
comparison = {'before': before['observedAt'], 'after': after['observedAt'],
              'credentialChangedFields': changed(before['credential'], after['credential']),
              'accountChangedFields': changed(before['account'], after['account']),
              'status': after['account']['status'], 'transport': after['account']['transport_status'],
              'credentialStatus': after['credential']['status'], 'readOnlyBefore': before['readOnly'], 'readOnlyAfter': after['readOnly']}
save('production-close.json', after)
save('production-readonly-comparison.json', comparison)
outcomes = list(cases.values())
signed_codes = [code for c in outcomes if c.get('initialDocumentTokenObserved') for code in c['codes']]
native = json.loads((root / 'same-browser-ticket-check/account-verdict.json').read_text(encoding='utf-8'))
server_events = []
for raw in (root / 'server-existing-client-readonly.stdout.log').read_text(encoding='utf-8').splitlines():
    try:
        server_events.append(json.loads(raw))
    except ValueError:
        pass
registered = any(e.get('type') == 'ws.client.result' and e['data'].get('registered') and e['data'].get('userId') == '1903703477' for e in server_events)
acceptance = {'accountRestored': False, 'status': 'PENDING_PRODUCTION_WRITE', 'manual': False,
              'sourceCommit': '2490eb849738539e5dc1c07444084f4b54b03287', 'initialDocumentTokenObservedCodes': signed_codes,
              'rawCodeZeroResponses': sum(code == 0 for c in outcomes for code in c['codes']),
              'nativeBrowserAccountNormal': native.get('normal'), 'tencentExistingClientRegistered': registered,
              'conclusion': '原生浏览器发起挑战后自动 code=0，复用 profile 获取 Token/登录检查成功；腾讯云现有 IM 客户端注册 200 并 connected。生产旧凭证及健康状态尚未写回，等待用户解除生产只读限制。',
              'production': comparison, 'outcomes': outcomes}
save('acceptance.json', acceptance)
save('outcomes.json', outcomes)
save('interface-inventory.json', {'totalEvents': total, 'indexedEvents': indexed,
                                'interfaces': [{'interface': k, 'count': v} for k, v in interfaces.items()]})
gaps.extend([
    {'type': 'interrupted-observation', 'case': 'linux-ext4-complete-challenge', 'reason': '第三次 code=0 后 frame DOM 观测卡住；停止任务容器并保留原始事件和 profile，缺少最终结果，trace/HAR 可能不完整。'},
    {'type': 'early-source-versions', 'reason': '部分早期启动器未逐版本封存；已有命令、环境、实际请求、动作计划、执行 bundle 和源代码版本均保留，不承诺逐字节完整重放。'},
    {'type': 'remote-state', 'reason': '远端挑战时效、内部风控、网络时延不能冻结；未采集 TLS 加密报文，不能保证未来外部输出相同。'},
    {'type': 'native-observation-interrupted', 'case': 'same-browser-native-recovery', 'reason': '原生挑战首次 code=0 后，已失效 ElementHandle 属性观测卡住；停止任务容器，后续 same-browser-ticket-check 的 profile-before 归档保存了恢复验证前的持久化状态。'},
    {'type': 'native-input-sampling', 'reason': '原生恢复场景保存完整的动作计划、实际页面 API 调用和时间；未逐条采样 DOM pointer 的 isTrusted 与每次事件后的完整 DOM。'},
    {'type': 'system-image', 'reason': '保留浏览器、Node、Python、node_modules 和 Linux 运行镜像引用，但未保存整台 Windows 主机及图形驱动的可启动镜像。'},
])
save('capture-gaps.json', gaps)
print(json.dumps({'accountRestored': False, 'nativeBrowserAccountNormal': native.get('normal'), 'tencentExistingClientRegistered': registered,
                  'initialDocumentTokenObservedCodes': signed_codes, 'rawCodeZeroResponses': acceptance['rawCodeZeroResponses'],
                  'cases': len(outcomes), 'totalEvents': total, 'indexedEvents': indexed, 'interfaces': len(interfaces),
                  'captureGaps': len(gaps), 'credentialChangedFields': comparison['credentialChangedFields']}))
