"""E2E tests for off-leash dog behavior: exploration, zoomies, bounds."""

from __future__ import annotations

import math
import unittest

from harness import GameSession


class DogOffLeashTests(unittest.TestCase):
    def test_offleash_explores_independently_when_owner_stands(self):
        with GameSession() as gs:
            gs.set_leash(False)
            gs.set_keys()
            gs.step_frames(5)

            owner = gs.snapshot()["owner"]
            prev = gs.snapshot()["dog"]
            total_path = 0.0
            radii = []
            angles = []
            for _ in range(36):
                gs.step_frames(10)
                dog = gs.snapshot()["dog"]
                total_path += math.hypot(dog["x"] - prev["x"], dog["y"] - prev["y"])
                dx = dog["x"] - owner["x"]
                dy = dog["y"] - owner["y"]
                radii.append(math.hypot(dx, dy))
                angles.append(math.atan2(dy, dx))
                prev = dog

            self.assertGreater(total_path, 80, "dog did not explore")
            self.assertGreater(max(radii), 40, "dog stayed glued to owner heel")

            # Reject pure fixed-radius circular orbiting.
            mean_r = sum(radii) / len(radii)
            var_r = sum((r - mean_r) ** 2 for r in radii) / len(radii)
            std_r = math.sqrt(var_r)
            self.assertGreater(std_r, 2.0, "dog orbiting at constant radius")

            # Reject >2 monotonic revolutions at constant radius.
            unwrapped = [angles[0]]
            for a in angles[1:]:
                delta = a - unwrapped[-1]
                while delta > math.pi:
                    delta -= 2 * math.pi
                while delta <= -math.pi:
                    delta += 2 * math.pi
                unwrapped.append(unwrapped[-1] + delta)
            sweep = abs(unwrapped[-1] - unwrapped[0])
            self.assertLess(sweep, 4 * math.pi, "dog swept >2 full revolutions")
            gs.assert_no_errors()

    def test_offleash_zoomies_smooth_no_jitter(self):
        with GameSession() as gs:
            gs.set_leash(False)
            gs.step_frames(5)
            gs.trigger_zoomies()

            prev = gs.snapshot()["dog"]
            max_speed = 0.0
            reversals = 0
            prev_v = None
            for _ in range(60):
                gs.step_frames(2)
                dog = gs.snapshot()["dog"]
                vx = dog["x"] - prev["x"]
                vy = dog["y"] - prev["y"]
                speed = math.hypot(vx, vy) * 30.0  # px/s at 2-frame sample
                max_speed = max(max_speed, speed)
                if prev_v is not None and speed > 40:
                    dot = prev_v[0] * vx + prev_v[1] * vy
                    norm = math.hypot(*prev_v) * math.hypot(vx, vy)
                    if norm > 0 and dot / norm < -0.2:
                        reversals += 1
                prev_v = (vx, vy)
                prev = dog

            self.assertGreater(max_speed, 140, f"zoomies peak {max_speed:.1f}px/s too low")
            self.assertLessEqual(reversals, 4, f"{reversals} sharp reversals during zoomies")
            gs.assert_no_errors()

    def test_offleash_world_bounds(self):
        with GameSession() as gs:
            gs.set_leash(False)
            world = gs.snapshot()["world"]
            gs.step_frames(120)
            gs.trigger_zoomies()
            gs.step_frames(120)
            dog = gs.snapshot()["dog"]
            self.assertGreaterEqual(dog["x"], 0)
            self.assertLessEqual(dog["x"], world["width"])
            self.assertGreaterEqual(dog["y"], 0)
            self.assertLessEqual(dog["y"], world["height"])
            gs.assert_no_errors()

    def test_offleash_multi_state_behavioral_variety(self):
        with GameSession() as gs:
            gs.set_leash(False)
            gs.set_keys()
            gs.step_frames(5)

            states = set()
            speeds = []
            total_path = 0.0
            prev = gs.snapshot()["dog"]

            # 1500 frames / 15 = 100 chunks of 15 frames (25s simulated).
            for _ in range(100):
                gs.step_frames(15)
                dog = gs.snapshot()["dog"]
                states.add(dog["state"])
                speeds.append(dog["speed"])
                total_path += math.hypot(dog["x"] - prev["x"], dog["y"] - prev["y"])
                prev = dog

            active_states = {
                "SNIFFING_TRAIL",
                "IDLE_SNIFF",
                "SITTING",
                "LYING_DOWN",
                "ROLLING",
                "ZOOMIES",
                "POOPING",
            }
            self.assertGreaterEqual(
                len(states),
                2,
                f"dog stuck in single state; only saw {sorted(states)}",
            )
            self.assertTrue(
                states & active_states,
                f"dog never entered an active off-leash state; saw {sorted(states)}",
            )
            self.assertGreater(total_path, 200, f"dog barely moved ({total_path:.1f}px)")
            self.assertLess(min(speeds), 20, "dog never paused/sniffed/rested")
            self.assertGreater(max(speeds), 80, "dog never roamed actively")
            gs.assert_no_errors()

    def test_offleash_whistle_recall_returns_dog_to_owner(self):
        with GameSession() as gs:
            gs.set_leash(False)
            owner = gs.snapshot()["owner"]
            gs.set_dog_position(owner["x"] + 300, owner["y"])
            gs.step_frames(5)

            gs.press_key("KeyR")
            gs.step_frames(5)
            self.assertEqual(
                gs.snapshot()["dog"]["state"],
                "RECALLED",
                "whistle did not trigger RECALLED state",
            )

            for _ in range(48):
                gs.step_frames(5)
                snap = gs.snapshot()
                dog = snap["dog"]
                owner = snap["owner"]
                dist = math.hypot(dog["x"] - owner["x"], dog["y"] - owner["y"])
                if dist < 140:
                    break

            self.assertLess(dist, 140, f"dog did not recall to owner ({dist:.1f}px)")
            gs.assert_no_errors()

    def test_offleash_sniff_animation_and_emote_bubbles(self):
        with GameSession() as gs:
            gs.set_leash(False)
            gs.set_keys()
            gs.step_frames(5)

            max_abs_nose_twitch = 0.0
            max_sniff_time = 0.0
            saw_sniff_state = False
            saw_sniffing_trail = False
            saw_emote_bubble = False

            for _ in range(120):
                gs.step_frames(10)
                dog = gs.snapshot()["dog"]
                state = dog["state"]
                sniffing = state in ("SNIFFING_TRAIL", "IDLE_SNIFF")
                if sniffing:
                    saw_sniff_state = True
                if state == "SNIFFING_TRAIL":
                    saw_sniffing_trail = True
                nose_twitch = abs(dog.get("noseTwitch", 0.0) or 0.0)
                sniff_time = dog.get("sniffTime", 0.0) or 0.0
                max_abs_nose_twitch = max(max_abs_nose_twitch, nose_twitch)
                max_sniff_time = max(max_sniff_time, sniff_time)
                bubble = dog.get("emoteBubble")
                if bubble:
                    saw_emote_bubble = True

            gs.trigger_zoomies("FIGURE_EIGHT")
            for _ in range(30):
                gs.step_frames(10)
                dog = gs.snapshot()["dog"]
                bubble = dog.get("emoteBubble")
                if bubble:
                    saw_emote_bubble = True

            self.assertTrue(
                saw_sniff_state,
                "dog never entered a sniffing state (SNIFFING_TRAIL or IDLE_SNIFF)",
            )
            if saw_sniffing_trail:
                self.assertTrue(
                    max_abs_nose_twitch > 0.05 or max_sniff_time > 0.05,
                    f"sniff animation not alive (noseTwitch={max_abs_nose_twitch:.3f}, "
                    f"sniffTime={max_sniff_time:.3f}, sawSniffState={saw_sniff_state})",
                )
            self.assertTrue(
                saw_emote_bubble,
                "no emote bubble observed during sniffing or zoomies",
            )
            gs.assert_no_errors()

    def test_offleash_zoomies_patterns_and_expiry(self):
        with GameSession() as gs:
            gs.set_leash(False)
            gs.trigger_zoomies("FIGURE_EIGHT")
            gs.step_frames(10)

            dog = gs.snapshot()["dog"]
            self.assertEqual(dog["state"], "ZOOMIES", "FIGURE_EIGHT zoomies not active")
            self.assertGreater(dog["zoomiesTimer"], 0, "zoomiesTimer not counting down")

            gs.step_frames(360)
            dog = gs.snapshot()["dog"]
            self.assertNotEqual(dog["state"], "ZOOMIES", "zoomies did not expire")
            self.assertLessEqual(
                dog["zoomiesTimer"], 0.01, "zoomiesTimer did not reset after expiry"
            )
            gs.assert_no_errors()


if __name__ == "__main__":
    unittest.main()
