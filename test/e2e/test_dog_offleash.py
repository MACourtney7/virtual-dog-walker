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


if __name__ == "__main__":
    unittest.main()
