"""E2E tests for the care loop: startup stability and need expiry."""

from __future__ import annotations

import unittest

import math

from harness import GameSession


class CareLoopTests(unittest.TestCase):
    def test_startup_no_frame_hang(self):
        with GameSession(clear_care=False) as gs:
            res = gs.step_frames(60)
            self.assertLess(res["maxFrameMs"], 150.0, "frame hang at startup")
            gs.assert_no_errors()

    def test_care_needs_expire_and_clear(self):
        with GameSession() as gs:
            gs.advance_care_clock(1000 * 60 * 60 * 24)
            gs.step_frames(5)
            care = gs.snapshot()["care"]
            self.assertTrue(care["isHungry"], "dog not hungry after 24h")
            self.assertTrue(care["needsGrooming"], "dog not dirty after 24h")
            self.assertTrue(care["isTired"], "dog not tired after 24h")

            gs.clear_care_needs()
            gs.step_frames(5)
            care = gs.snapshot()["care"]
            self.assertFalse(care["isHungry"], "hunger not cleared")
            self.assertFalse(care["needsGrooming"], "grooming need not cleared")
            self.assertFalse(care["isTired"], "tiredness not cleared")
            gs.assert_no_errors()

    def test_home_lock_freezes_owner_until_unlocked(self):
        with GameSession(unlock_home=False) as gs:
            gs.set_home_locked(True)
            gs.set_heading(0.0)
            gs.set_gait("WALK")
            start = gs.snapshot()["owner"]
            gs.step_frames(30)
            owner = gs.snapshot()["owner"]
            dist = math.hypot(owner["x"] - start["x"], owner["y"] - start["y"])
            self.assertLess(dist, 2.0, f"locked owner moved {dist:.1f}px")
            self.assertEqual(owner["gait"], "STAND", "locked owner should stand")

            gs.set_home_locked(False)
            gs.set_heading(0.0)
            gs.set_gait("WALK")
            start = gs.snapshot()["owner"]
            gs.step_frames(45)
            owner = gs.snapshot()["owner"]
            dist = math.hypot(owner["x"] - start["x"], owner["y"] - start["y"])
            self.assertGreater(dist, 30, f"unlocked owner only moved {dist:.1f}px")
            gs.assert_no_errors()

    @staticmethod
    def _measure_zoomies_distance(gs, frames=60):
        """Sum ground distance traveled during an off-leash zoomies burst."""
        gs.set_leash(False)
        gs.trigger_zoomies("FIGURE_EIGHT")
        prev = gs.snapshot()["dog"]
        total = 0.0
        for _ in range(frames):
            snap = gs.step_frames(1)["snapshot"]
            dog = snap["dog"]
            total += math.hypot(dog["x"] - prev["x"], dog["y"] - prev["y"])
            prev = dog
        return total

    def test_unmet_care_reduces_dog_speed_and_clearing_restores_it(self):
        with GameSession(clear_care=True) as gs:
            healthy_dist = self._measure_zoomies_distance(gs)
            self.assertGreater(healthy_dist, 0.0, "healthy dog never moved")
            gs.assert_no_errors()

        with GameSession(clear_care=False) as gs:
            gs.advance_care_clock(1000 * 60 * 60 * 24)
            gs.step_frames(5)
            unmet_dist = self._measure_zoomies_distance(gs)
            self.assertLess(
                unmet_dist,
                healthy_dist * 0.7,
                f"unmet care did not slow dog ({unmet_dist:.1f} vs {healthy_dist:.1f})",
            )

            gs.clear_care_needs()
            gs.step_frames(5)
            recovered_dist = self._measure_zoomies_distance(gs)
            self.assertGreater(
                recovered_dist,
                unmet_dist * 1.5,
                f"dog speed did not recover ({recovered_dist:.1f} vs {unmet_dist:.1f})",
            )
            gs.assert_no_errors()


if __name__ == "__main__":
    unittest.main()
