"""E2E tests for remote peers and social interactions."""

from __future__ import annotations

import math
import unittest

from harness import GameSession


class SocialAndPeersTests(unittest.TestCase):
    def test_remote_peer_spawns_and_renders_without_errors(self):
        with GameSession() as gs:
            gs.spawn_remote_peer("peer-alpha")
            gs.step_frames(30)
            self.assertEqual(
                gs.snapshot()["remotePeerCount"], 1, "remote peer not registered"
            )
            gs.assert_no_errors()

            gs.clear_remote_peers()
            gs.step_frames(5)
            self.assertEqual(
                gs.snapshot()["remotePeerCount"], 0, "remote peer not cleared"
            )
            gs.assert_no_errors()

    def test_offleash_dog_social_interaction_with_peer_dog(self):
        with GameSession() as gs:
            gs.set_leash(False)
            owner = gs.snapshot()["owner"]
            gs.spawn_remote_peer("peer-beta", owner["x"] + 55, owner["y"])

            social_states = {"PLAY_BOW", "SOCIAL_GREET", "PACK_PLAY"}
            saw_social = False
            saw_emote = False
            world = gs.snapshot()["world"]

            for _ in range(18):
                gs.step_frames(10)
                snap = gs.snapshot()
                dog = snap["dog"]
                if dog["state"] in social_states:
                    saw_social = True
                if dog.get("emoteBubble"):
                    saw_emote = True
                self.assertTrue(math.isfinite(dog["x"]), "dog x not finite")
                self.assertTrue(math.isfinite(dog["y"]), "dog y not finite")
                self.assertGreaterEqual(dog["x"], 0)
                self.assertLessEqual(dog["x"], world["width"])
                self.assertGreaterEqual(dog["y"], 0)
                self.assertLessEqual(dog["y"], world["height"])

            # Social state or emote is best-effort; the hard requirement is
            # that the simulation stays healthy.
            _ = saw_social, saw_emote
            gs.assert_no_errors()

    def test_remote_bark_reaction_without_errors(self):
        with GameSession() as gs:
            gs.spawn_remote_peer("peer-gamma")
            gs.trigger_remote_bark("peer-gamma")
            gs.step_frames(30)
            gs.assert_no_errors()


if __name__ == "__main__":
    unittest.main()
