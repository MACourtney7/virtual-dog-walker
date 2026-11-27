"""E2E tests for owner locomotion: spawn stability, cadence, turning, bounds."""

from __future__ import annotations

import math
import unittest

from harness import GameSession


def _wrap(angle: float) -> float:
    """Wrap an angle to the range (-pi, pi]."""
    while angle > math.pi:
        angle -= 2 * math.pi
    while angle <= -math.pi:
        angle += 2 * math.pi
    return angle


class OwnerLocomotionTests(unittest.TestCase):
    def test_spawn_stability_no_initial_slide(self):
        with GameSession() as gs:
            s0 = gs.snapshot()
            res = gs.step_frames(30)
            s1 = res["snapshot"]

            o0 = s0["owner"]
            o1 = s1["owner"]
            moved = math.hypot(o1["x"] - o0["x"], o1["y"] - o0["y"])
            self.assertLess(moved, 5.0, f"owner slid {moved:.2f}px from spawn")
            self.assertLess(res["maxFrameMs"], 50.0, "frame time spike at spawn")
            gs.assert_no_errors()

    def test_movement_and_walk_phase_cadence(self):
        with GameSession() as gs:
            s0 = gs.snapshot()
            gs.set_keys(right=True)
            gs.step_frames(90)
            s1 = gs.snapshot()

            o0 = s0["owner"]
            o1 = s1["owner"]
            self.assertGreater(o1["x"] - o0["x"], 100, "owner did not move +x")
            self.assertGreater(o1["speed"], 50, "owner speed too low")
            self.assertNotEqual(o1["gait"], "STAND", "owner gait stuck in STAND")
            self.assertGreater(
                abs(o1["walkPhase"] - o0["walkPhase"]), 2.0, "walkPhase did not advance"
            )
            gs.assert_no_errors()

    def test_smooth_90_degree_turn_while_moving(self):
        with GameSession() as gs:
            gs.set_keys(right=True)
            gs.step_frames(60)

            gs.set_keys(down=True)
            min_speed = float("inf")
            for _ in range(20):
                gs.step_frames(3)
                snap = gs.snapshot()
                min_speed = min(min_speed, snap["owner"]["speed"])

            self.assertGreater(min_speed, 0.0, "owner stopped during turn")
            final = gs.snapshot()["owner"]
            self.assertLess(
                abs(_wrap(final["angle"] - math.pi / 2)),
                0.35,
                f"final angle {final['angle']:.3f} not near pi/2",
            )
            gs.assert_no_errors()

    def test_obstacle_deflection_no_pinball_flip(self):
        with GameSession() as gs:
            gs.set_keys(right=True)
            prev_angle = gs.snapshot()["owner"]["angle"]
            for _ in range(180):
                gs.step_frames(1)
                angle = gs.snapshot()["owner"]["angle"]
                delta = abs(_wrap(angle - prev_angle))
                self.assertLess(delta, 1.2, f"heading flipped {delta:.3f} rad in one frame")
                prev_angle = angle
            gs.assert_no_errors()

    def test_world_boundary_clamping(self):
        with GameSession() as gs:
            world = gs.snapshot()["world"]
            gs.set_keys(left=True)
            for _ in range(600):
                gs.step_frames(1)
                owner = gs.snapshot()["owner"]
                self.assertGreaterEqual(owner["x"], 0)
                self.assertLessEqual(owner["x"], world["width"])
                self.assertGreaterEqual(owner["y"], 0)
                self.assertLessEqual(owner["y"], world["height"])
            gs.assert_no_errors()


if __name__ == "__main__":
    unittest.main()
