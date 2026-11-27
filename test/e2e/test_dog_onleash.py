"""E2E tests for on-leash dog behavior: follow, settle, bounds."""

from __future__ import annotations

import math
import unittest

from harness import GameSession


def _wrap(angle: float) -> float:
    while angle > math.pi:
        angle -= 2 * math.pi
    while angle <= -math.pi:
        angle += 2 * math.pi
    return angle


class DogOnLeashTests(unittest.TestCase):
    def test_onleash_follow_speed_and_gait_phase(self):
        with GameSession() as gs:
            gs.set_leash(True)
            s0 = gs.snapshot()
            gs.set_keys(right=True)
            gs.step_frames(120)
            s1 = gs.snapshot()

            d0 = s0["dog"]
            d1 = s1["dog"]
            self.assertGreater(d1["x"] - d0["x"], 80, "dog did not follow +x")

            owner = s1["owner"]
            dist = math.hypot(d1["x"] - owner["x"], d1["y"] - owner["y"])
            self.assertLess(dist, 260, f"dog {dist:.1f}px from owner (leash too long)")

            self.assertGreater(
                abs(d1["gaitPhase"] - d0["gaitPhase"]), 1.0, "dog gaitPhase did not advance"
            )
            gs.assert_no_errors()

    def test_onleash_stop_no_90_degree_pivot(self):
        with GameSession() as gs:
            gs.set_leash(True)
            gs.set_keys(right=True)
            gs.step_frames(90)
            owner_angle = gs.snapshot()["owner"]["angle"]

            gs.set_keys()
            gs.step_frames(90)
            dog_angle = gs.snapshot()["dog"]["angle"]

            diff = abs(_wrap(dog_angle - owner_angle))
            self.assertLess(diff, 0.9, f"dog settled {diff:.3f} rad off owner heading")
            gs.assert_no_errors()

    def test_onleash_stays_in_world_bounds(self):
        with GameSession() as gs:
            gs.set_leash(True)
            world = gs.snapshot()["world"]
            gs.set_keys(right=True)
            gs.step_frames(120)
            dog = gs.snapshot()["dog"]
            self.assertGreaterEqual(dog["x"], 0)
            self.assertLessEqual(dog["x"], world["width"])
            self.assertGreaterEqual(dog["y"], 0)
            self.assertLessEqual(dog["y"], world["height"])
            gs.assert_no_errors()


if __name__ == "__main__":
    unittest.main()
