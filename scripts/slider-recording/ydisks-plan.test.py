import sys
import unittest
from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path

spec = spec_from_file_location('ydisks_plan', Path(__file__).with_name('ydisks-plan.py'))
planner = module_from_spec(spec)
spec.loader.exec_module(planner)
source = sys.argv.pop(1)


class UpstreamContractTests(unittest.TestCase):
    def test_pinned_source_preserves_distance_overshoot_vertical_span_and_phase_order(self):
        for seed in [1, 20261024, 20261025]:
            with self.subTest(seed=seed):
                geometry = {'button': {'x': 23, 'y': 100, 'width': 42, 'height': 30},
                            'track': {'x': 21, 'y': 98, 'width': 300, 'height': 34}, 'distance': 256, 'verticalSpan': 17}
                plan = planner.build_plan(source, geometry, seed)
                self.assertTrue(257.5 <= plan['calculatedDistance'] <= 258.5)
                points = plan['trajectory']
                self.assertTrue(4 <= points[-1][0] - plan['calculatedDistance'] <= 20)
                self.assertTrue(all(a[0] <= b[0] for a, b in zip(points, points[1:])))
                self.assertAlmostEqual(max(p[1] for p in points) - min(p[1] for p in points), 17, places=5)
                self.assertTrue(.55 <= plan['targetDuration'] <= 1.05)
                self.assertTrue(all(p[2] <= .015 for p in points))
                self.assertEqual([e['type'] for e in plan['events'] if e['type'] in ['down', 'up', 'domClick']], ['down', 'up', 'domClick'])
                self.assertEqual([e['type'] for e in plan['preparationEvents']], ['move', 'wheel', 'wait'])


if __name__ == '__main__':
    unittest.main()
