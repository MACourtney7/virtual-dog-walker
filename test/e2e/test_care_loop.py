"""E2E tests for the care loop: startup stability and need expiry."""

from __future__ import annotations

import unittest

from harness import GameSession


class CareLoopTests(unittest.TestCase):
    def test_startup_no_frame_hang(self):
        with GameSession(clear_care=False) as gs:
            res = gs.step_frames(60)
            self.assertLess(res["maxFrameMs"], 50.0, "frame hang at startup")
            self.assertTrue(
                res["snapshot"].get("wasmReady"),
                "Wasm simulation engine must be active",
            )
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


if __name__ == "__main__":
    unittest.main()
