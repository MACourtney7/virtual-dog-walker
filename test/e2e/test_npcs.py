"""E2E tests for ambient NPC spawning and locomotion cadence."""

from __future__ import annotations

import math
import unittest

from harness import GameSession


class NpcTests(unittest.TestCase):
    def test_npc_spawning_no_duplicate_overlap(self):
        with GameSession() as gs:
            gs.step_frames(60)
            npcs = gs.snapshot()["npcs"]
            self.assertGreaterEqual(len(npcs), 4, "too few ambient NPCs")

            ids = [n["id"] for n in npcs]
            self.assertEqual(len(ids), len(set(ids)), "duplicate NPC ids")

            for i in range(len(npcs)):
                for j in range(i + 1, len(npcs)):
                    a, b = npcs[i], npcs[j]
                    dist = math.hypot(a["x"] - b["x"], a["y"] - b["y"])
                    self.assertGreater(dist, 2.0, f"NPCs {a['id']} & {b['id']} stacked")
            gs.assert_no_errors()

    def test_npc_joggers_and_walkers_limb_cadence(self):
        with GameSession() as gs:
            gs.step_frames(30)
            initial = {n["id"]: n for n in gs.snapshot()["npcs"]}

            gs.step_frames(90)
            final = {n["id"]: n for n in gs.snapshot()["npcs"]}

            survivors = [nid for nid in initial if nid in final]
            self.assertGreaterEqual(
                len(survivors),
                max(1, len(initial) // 2),
                "NPCs mass-despawned mid-path",
            )

            for nid in survivors:
                a = initial[nid]
                b = final[nid]
                moved = math.hypot(b["x"] - a["x"], b["y"] - a["y"])
                if moved > 5.0:
                    self.assertGreater(
                        abs(b["walkPhase"] - a["walkPhase"]),
                        0.5,
                        f"NPC {nid} walkPhase did not advance",
                    )

            for nid, npc in final.items():
                if npc.get("type") == "jogger":
                    self.assertTrue(npc.get("isJogger"), f"jogger {nid} not flagged")
                    self.assertGreater(npc["speed"], 35, f"jogger {nid} too slow")
            gs.assert_no_errors()


if __name__ == "__main__":
    unittest.main()
