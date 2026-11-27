"""E2E tests for warp gates: owner/dog alignment and off-leash carry."""

from __future__ import annotations

import math
import unittest

from harness import GameSession


class WarpTests(unittest.TestCase):
    def test_warp_aligns_owner_and_onleash_dog(self):
        with GameSession() as gs:
            gates = gs.get_warp_gates()
            self.assertTrue(gates, "no warp gates available")
            gate = gates[0]

            gs.set_leash(True)
            gs.warp_to(gate["targetZoneId"], gate["targetX"], gate["targetY"])
            gs.step_frames(10)
            snap = gs.snapshot()

            self.assertEqual(snap["zoneId"], gate["targetZoneId"])
            if "wasmReady" in snap:
                self.assertTrue(
                    snap["wasmReady"], "Wasm simulation engine must be active"
                )
            owner = snap["owner"]
            dog = snap["dog"]
            if "camera" in snap:
                cam = snap["camera"]
                self.assertTrue(
                    cam["x"] - 100 <= owner["x"] <= cam["x"] + 1380,
                    f"camera did not snap to warped owner (cam.x={cam['x']}, owner.x={owner['x']})",
                )
            owner_dist = math.hypot(owner["x"] - gate["targetX"], owner["y"] - gate["targetY"])
            self.assertLess(owner_dist, 40, f"owner {owner_dist:.1f}px from warp target")
            dog_dist = math.hypot(dog["x"] - owner["x"], dog["y"] - owner["y"])
            self.assertLess(dog_dist, 140, f"dog {dog_dist:.1f}px from owner after warp")
            gs.assert_no_errors()

    def test_warp_carries_offleash_dog(self):
        with GameSession() as gs:
            gates = gs.get_warp_gates()
            self.assertTrue(gates, "no warp gates available")
            gate = gates[0]

            gs.set_leash(False)
            gs.step_frames(60)
            gs.warp_to(gate["targetZoneId"], gate["targetX"], gate["targetY"])
            gs.step_frames(10)
            snap = gs.snapshot()

            owner = snap["owner"]
            dog = snap["dog"]
            owner_dist = math.hypot(owner["x"] - gate["targetX"], owner["y"] - gate["targetY"])
            self.assertLess(owner_dist, 40, f"owner {owner_dist:.1f}px from warp target")
            dog_dist = math.hypot(dog["x"] - owner["x"], dog["y"] - owner["y"])
            self.assertLess(dog_dist, 160, f"dog {dog_dist:.1f}px from owner after warp")
            gs.assert_no_errors()

    def test_all_clifton_commons_gates_warp_cleanly(self):
        with GameSession() as gs:
            gates = gs.get_warp_gates()
            self.assertGreaterEqual(
                len(gates), 2, "expected at least 2 clifton-commons warp gates"
            )

        for gate in gates:
            with GameSession() as gs:
                gs.set_leash(True)
                gs.warp_to(gate["targetZoneId"], gate["targetX"], gate["targetY"])
                gs.step_frames(10)
                snap = gs.snapshot()

                self.assertEqual(
                    snap["zoneId"],
                    gate["targetZoneId"],
                    "warp did not change zone",
                )
                self.assertGreater(
                    snap.get("warpCooldown", 0), 0, "warp cooldown not set"
                )
                owner = snap["owner"]
                dog = snap["dog"]
                owner_dist = math.hypot(
                    owner["x"] - gate["targetX"], owner["y"] - gate["targetY"]
                )
                self.assertLess(
                    owner_dist, 40, f"owner {owner_dist:.1f}px from warp target"
                )
                dog_dist = math.hypot(dog["x"] - owner["x"], dog["y"] - owner["y"])
                self.assertLess(
                    dog_dist, 140, f"dog {dog_dist:.1f}px from owner after warp"
                )
                self.assertTrue(
                    snap["ball"]["inOwnerPossession"],
                    "ball not returned to owner after warp",
                )
                gs.assert_no_errors()


if __name__ == "__main__":
    unittest.main()
