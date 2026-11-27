"""E2E tests for ball throwing physics and off-leash fetch behavior."""

from __future__ import annotations

import math
import unittest

from harness import GameSession


class FetchAndBallTests(unittest.TestCase):
    def test_throw_ball_physics_and_offleash_fetch_return(self):
        with GameSession() as gs:
            gs.set_leash(False)
            gs.step_frames(5)
            snap = gs.snapshot()
            self.assertTrue(
                snap["ball"]["inOwnerPossession"],
                "ball should start in owner possession",
            )

            gs.throw_ball(-1.0, 0.0)
            gs.step_frames(10)
            snap = gs.snapshot()
            ball = snap["ball"]
            owner = snap["owner"]
            self.assertTrue(
                ball["isThrown"] or not ball["inOwnerPossession"],
                "ball should be in flight after throw",
            )
            dist = math.hypot(ball["x"] - owner["x"], ball["y"] - owner["y"])
            self.assertGreater(dist, 30, f"ball only {dist:.1f}px from owner")
            self.assertGreater(ball["z"], 0, "ball should be airborne during flight")

            saw_fetching = False
            saw_has_ball = False
            returned_to_owner = False
            for _ in range(48):  # 48 * 10 = 480 frames = 8.0s
                snap = gs.step_frames(10)["snapshot"]
                dog = snap["dog"]
                ball = snap["ball"]
                if dog["state"] == "FETCHING":
                    saw_fetching = True
                if dog.get("hasBall"):
                    saw_has_ball = True
                if ball["inOwnerPossession"]:
                    returned_to_owner = True
                    break

            self.assertTrue(saw_fetching, "dog never entered FETCHING state")
            self.assertTrue(
                saw_has_ball or returned_to_owner,
                "dog never retrieved/returned the ball",
            )
            gs.assert_no_errors()

    def test_onleash_dog_does_not_chase_thrown_ball(self):
        with GameSession() as gs:
            gs.set_leash(True)
            gs.throw_ball(1.0, 0.0)
            gs.step_frames(60)
            snap = gs.snapshot()
            dog = snap["dog"]
            self.assertNotEqual(dog["state"], "FETCHING", "leashed dog chased ball")
            self.assertFalse(dog["hasBall"], "leashed dog picked up ball")
            gs.assert_no_errors()


if __name__ == "__main__":
    unittest.main()
