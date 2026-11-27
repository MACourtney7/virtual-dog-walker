"""E2E tests for biome traversal, coastal rendering, and canvas visuals."""

from __future__ import annotations

import unittest

from harness import GameSession


class ZonesAndCoastalTests(unittest.TestCase):
    def test_traverse_all_three_biomes_parkland_woodland_coastal(self):
        with GameSession() as gs:
            snap = gs.snapshot()
            self.assertEqual(snap["zoneId"], "clifton-commons")
            self.assertEqual(snap["biome"], "parkland")

            gs.warp_to("the-woodland", 3000, 1200)
            gs.step_frames(10)
            snap = gs.snapshot()
            self.assertEqual(snap["zoneId"], "the-woodland")
            self.assertEqual(snap["biome"], "woodland")

            gs.warp_to("the-beach", 1200, 1000)
            gs.step_frames(10)
            snap = gs.snapshot()
            self.assertEqual(snap["zoneId"], "the-beach")
            self.assertEqual(snap["biome"], "coastal")

            gs.warp_to("clifton-commons", 1350, 1000)
            gs.step_frames(10)
            snap = gs.snapshot()
            self.assertEqual(snap["zoneId"], "clifton-commons")
            self.assertEqual(snap["biome"], "parkland")
            gs.assert_no_errors()

    def test_coastal_zone_shallow_water_runs_cleanly(self):
        with GameSession() as gs:
            gs.set_leash(False)
            gs.warp_to("the-beach", 1200, 1000)
            gs.step_frames(120)
            snap = gs.snapshot()
            self.assertLess(
                snap.get("maxFrameMs", 0.0),
                50.0,
                f"frame time too high: {snap.get('maxFrameMs')}",
            )
            gs.assert_no_errors()

    def test_canvas_renders_non_blank_and_updates_on_movement(self):
        with GameSession() as gs:
            gs.step_frames(5)
            p0 = gs.canvas_pixel_stats()
            self.assertGreater(p0["width"], 0, "canvas width is zero")
            self.assertGreater(p0["height"], 0, "canvas height is zero")
            self.assertGreater(p0["nonZeroCount"], 0, "canvas is blank")

            gs.set_keys(right=True)
            gs.step_frames(60)
            p1 = gs.canvas_pixel_stats()
            self.assertNotEqual(
                p1["checksum"], p0["checksum"], "canvas did not update on movement"
            )
            gs.assert_no_errors()

    def test_warp_changes_rendered_canvas_visuals(self):
        with GameSession() as gs:
            gs.step_frames(5)
            p0 = gs.canvas_pixel_stats()

            gs.warp_to("the-beach", 1200, 1000)
            gs.step_frames(10)
            p1 = gs.canvas_pixel_stats()
            self.assertGreater(p1["nonZeroCount"], 0, "canvas blank after warp")
            self.assertNotEqual(
                p1["checksum"], p0["checksum"], "canvas did not change after warp"
            )
            gs.assert_no_errors()


if __name__ == "__main__":
    unittest.main()
