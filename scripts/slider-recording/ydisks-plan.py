"""Execute pinned upstream pure code against an inert mouse/clock recording sink.

No upstream application imports, database access, browser library or network.
The original AST of simulate_slide and replay_trajectory is executed unchanged.
"""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import random
import sys
import types


def build_plan(source, geometry, seed, scratch=False):
    source = Path(source)
    spec = importlib.util.spec_from_file_location('utils.slider_ydisks', source / 'utils/slider_ydisks.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    sys.modules['utils'] = types.ModuleType('utils')
    sys.modules['utils.slider_ydisks'] = helper
    text = (source / 'utils/xianyu_slider_stealth.py').read_text(encoding='utf-8')
    tree = ast.parse(text)
    replay_node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'replay_trajectory')
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'XianyuSliderStealth')
    simulate_node = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == 'simulate_slide')
    script_node = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == '_get_stealth_script')
    features_node = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == '_get_random_browser_features')
    distance_node = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == 'calculate_slide_distance')
    random.seed(seed)
    events = []

    class Clock:
        now = 0.0
        replay_start = None

        def time(self):
            return self.now

        monotonic = time

        def sleep(self, seconds):
            self.now += seconds

    clock = Clock()

    def record(kind, **data):
        event = {'type': kind, **data, 'atMs': clock.now * 1000}
        if clock.replay_start is not None:
            event['replayAtMs'] = (clock.now - clock.replay_start) * 1000
        events.append(event)

    class Mouse:
        def move(self, x, y, steps=None):
            record('move', x=x, y=y, **({'steps': steps} if steps else {}))

        def down(self):
            record('down')

        def up(self):
            record('up')

        def wheel(self, dx, dy):
            record('wheel', dx=dx, dy=dy)

    class Button:
        def bounding_box(self):
            return geometry['button']

        def hover(self, **kwargs):
            record('hover', **kwargs)

        def get_attribute(self, name, **kwargs):
            record('getAttribute', name=name, **kwargs)
            return f"left: {geometry['distance']}px"

        def evaluate(self, javascript, point):
            record('domClick', javascript=javascript, point=point)

    log = types.SimpleNamespace(**{k: lambda *a, **kw: None for k in ['info', 'debug', 'warning', 'error']})
    scope = {'time': clock, 'random': random, 'logger': log, 'ElementHandle': object, 're': __import__('re')}
    module = ast.Module(body=[replay_node, simulate_node, script_node, features_node, distance_node], type_ignores=[])
    exec(compile(module, str(source / 'utils/xianyu_slider_stealth.py'), 'exec'), scope)
    original_replay = scope['replay_trajectory']

    def replay(*args, **kwargs):
        clock.replay_start = clock.now
        value = original_replay(*args, **kwargs)
        record('replayEnd')
        clock.replay_start = None
        return value

    scope['replay_trajectory'] = replay
    track = geometry.get('track', {'width': geometry['button']['width'] + geometry['distance'], 'height': geometry['verticalSpan'] * 2})
    instance = types.SimpleNamespace(pure_user_id='1903703477', page=types.SimpleNamespace(mouse=Mouse(),
                                     evaluate=lambda js: track['width'] - geometry['button']['width']),
                                     context=types.SimpleNamespace(cookies=lambda: []),
                                     is_scratch_captcha=lambda: scratch, current_trajectory_data={})
    calculated_distance = scope['calculate_slide_distance'](instance, Button(), types.SimpleNamespace(bounding_box=lambda: track))
    trajectory, target, planned = helper.build_ydisks_trajectory(calculated_distance, geometry['verticalSpan'])
    if not scope['simulate_slide'](instance, Button(), trajectory):
        raise RuntimeError('Upstream simulate_slide failed while constructing its action plan')
    previous = 0.0
    for event in events:
        event['gapMs'] = event['atMs'] - previous
        previous = event['atMs']
    gesture_events = events.copy()
    events.clear()
    clock.now = 0
    run_node = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == 'run')
    run_try = next(n for n in run_node.body if isinstance(n, ast.Try))
    prep_nodes = [n for n in run_try.body if 4516 <= n.lineno <= 4524]
    if len(prep_nodes) != 7:
        raise RuntimeError('Pinned upstream preparation AST changed')
    scope['self'] = instance
    exec(compile(ast.Module(body=prep_nodes, type_ignores=[]), '<upstream-page-preparation>', 'exec'), scope)
    record('wait')
    previous = 0.0
    for event in events:
        event['gapMs'] = event['atMs'] - previous
        previous = event['atMs']
    preparation_events = events.copy()
    features = scope['_get_random_browser_features'](None)
    init_node = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == 'init_browser')
    args_node = next(n for n in ast.walk(init_node) if isinstance(n, ast.Assign)
                     and any(isinstance(t, ast.Name) and t.id == 'launch_args' for t in n.targets))
    launch_args = eval(compile(ast.Expression(args_node.value), '<upstream-launch-args>', 'eval'), {'browser_features': features})
    ua_spec = importlib.util.spec_from_file_location('utils.user_agents', source / 'utils/user_agents.py')
    ua = importlib.util.module_from_spec(ua_spec)
    ua_spec.loader.exec_module(ua)
    sys.modules['utils.user_agents'] = ua
    fingerprint_commands = []
    cdp = types.SimpleNamespace(send=lambda method, params: fingerprint_commands.append({'method': method, 'params': params}))
    helper.apply_page_fingerprint_override(types.SimpleNamespace(new_cdp_session=lambda page: cdp), None)
    return {'sourceSha256': hashlib.sha256(text.encode()).hexdigest(), 'seed': seed,
            'geometry': geometry, 'calculatedDistance': calculated_distance, 'scratch': scratch, 'trajectory': trajectory,
            'targetDuration': target, 'plannedDuration': planned, 'events': gesture_events, 'preparationEvents': preparation_events,
            'stealthScript': scope['_get_stealth_script'](None, {}),
            'browserFeatures': features, 'launchArgs': launch_args, 'fingerprintCommands': fingerprint_commands}


if __name__ == '__main__':
    data = json.load(sys.stdin)
    print(json.dumps(build_plan(data['source'], data['geometry'], data['seed'], data.get('scratch', False))))
