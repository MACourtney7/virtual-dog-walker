"""E2E tests for dog pooping, poop piles, and owner cleanup."""

from __future__ import annotations

import unittest

from harness import GameSession


class PoopAndWasteTests(unittest.TestCase):
    def test_dog_pooping_spawns_pile_and_owner_cleans_up(self):
        with GameSession() as gs:
            gs.set_leash(True)
            snap = gs.snapshot()
            self.assertEqual(snap["poopPilesCount"], 0, "unexpected initial poop piles")
            self.assertFalse(snap["hasPoopBag"], "owner should start without poop bag")

            gs.trigger_poop()
            gs.step_frames(5)
            snap = gs.snapshot()
            dog = snap["dog"]
            self.assertEqual(dog["state"], "POOPING", "dog did not enter POOPING state")
            self.assertLess(dog["speed"], 15.0, "dog should freeze while squatting")

            gs.step_frames(180)
            snap = gs.snapshot()
            self.assertNotEqual(snap["dog"]["state"], "POOPING", "dog still pooping")
            self.assertGreaterEqual(
                snap["poopPilesCount"], 1, "no poop pile spawned after pooping"
            )

            gs.pick_up_nearest_poop()
            gs.step_frames(5)
            snap = gs.snapshot()
            self.assertTrue(snap["hasPoopBag"], "owner did not get poop bag")
            self.assertEqual(snap["poopPilesCount"], 0, "poop pile not removed")

            gs.dispose_poop_at_nearest_bin()
            gs.step_frames(5)
            snap = gs.snapshot()
            self.assertFalse(snap["hasPoopBag"], "poop bag not disposed")
            gs.assert_no_errors()


if __name__ == "__main__":
    unittest.main()
