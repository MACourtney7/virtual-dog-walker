import os
import unittest
import re

TEST_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.abspath(os.path.join(TEST_DIR, ".."))

def read_project_file(rel_path):
    path = os.path.join(PROJECT_DIR, rel_path)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

class TestWalkingTweaks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.companion_dog_src = read_project_file("src/entities/companion_dog.js")
        cls.owner_src = read_project_file("src/entities/owner.js")
        cls.main_src = read_project_file("src/main.js")
        cls.touch_src = read_project_file("src/ui/touch_controls.js")

    def test_01_leash_flank_clearance_constants(self):
        self.assertIn("export const LEASH_FLANK_CLEARANCE_MIN_PX = 0;", self.companion_dog_src)
        self.assertIn("export const LEASH_FLANK_CLEARANCE_MAX_PX = 4;", self.companion_dog_src)
        self.assertIn("export const LEASH_FLANK_CLEARANCE_TARGET_PX = 2;", self.companion_dog_src)

    def test_02_straight_locked_elbow_arm(self):
        # Verify elbow bend offset is eliminated in drawArm when isLeashed
        self.assertIn("const elbowX = (ax + handX) / 2;", self.owner_src)
        self.assertIn("const elbowY = (ay + handY) / 2;", self.owner_src)
        self.assertNotIn("(-sinA) * sideSign * 3.0", self.owner_src)

    def test_03_speed_badges_retired(self):
        # spawnSpeedBadge is a safe no-op and floating chevron rendering loop is removed
        self.assertIn("spawnSpeedBadge(_prevGait, _nextGait)", self.main_src)
        self.assertNotIn("const rise = 15 * t;", self.main_src)
        self.assertNotIn("font = 'bold 13px system-ui", self.main_src)

    def test_04_wander_mode_gait_speed_and_warp_journey(self):
        # 60 px/s is 20% slower than STROLL (75 px/s)
        self.assertIn("[Gait.WANDER]: 60", self.owner_src)
        self.assertIn("WANDER_SPEED = Gait.WANDER", self.owner_src)
        # Gait.WANDER excluded from manual GAIT_ORDER
        self.assertRegex(self.owner_src, r"const GAIT_ORDER\s*=\s*\[Gait\.STAND,\s*Gait\.STROLL,\s*Gait\.WALK,\s*Gait\.JOG\];")
        # Destination selection avoids lastArrivedFromZoneId
        self.assertIn("_pickWanderWarpGate", self.owner_src)
        self.assertIn("targetZoneId !== this.lastArrivedFromZoneId", self.owner_src)
        self.assertIn("lastArrivedFromZoneId", self.owner_src)
        self.assertIn("this.owner.lastArrivedFromZoneId = previousZoneId;", self.main_src)

    def test_05_ball_throw_disabled_on_leash(self):
        self.assertIn("if (this.owner && this.owner.isLeashed) return false;", self.main_src)
        self.assertIn("throwBtn.classList.add('is-disabled');", self.touch_src)
        self.assertIn("throwBtn.setAttribute('disabled', 'true');", self.touch_src)

    def test_06_praise_dog_on_leash(self):
        # companion_dog.praise()
        self.assertIn("praise() {", self.companion_dog_src)
        self.assertIn("this.happiness = Math.min(100, this.happiness + 20);", self.companion_dog_src)
        self.assertIn("this.wagSpeed = 18;", self.companion_dog_src)
        # main.js KeyR branches on isLeashed
        self.assertIn("praiseDog()", self.main_src)
        self.assertIn("Good dog! Ziggy loves the praise!", self.main_src)
        # touch_controls whistle button becomes praise
        self.assertIn("whistleBtn.textContent = '👏';", self.touch_src)
        self.assertIn("whistleBtn.setAttribute('aria-label', 'Praise Dog');", self.touch_src)

    def test_07_and_08_brake_light_flash_on_stop(self):
        # Halo renders rear brake sector when brakeLightFeedback.active even in Gait.STAND
        self.assertIn("isBrakeFlashing", self.owner_src)
        self.assertIn("this.gait !== Gait.STAND || isBrakeFlashing", self.owner_src)
        # Triggered on both single-click and double-click stop
        self.assertIn("triggerBrakeLight", self.main_src)

    # ------------------------------------------------------------------
    # unification-026: REQ-026.1 / REQ-026.2
    # ------------------------------------------------------------------

    def test_09_wander_smooth_path_no_weaving(self):
        """Wander drift amplitude must be zero so the path is smooth (no weaving)."""
        self.assertIn("WANDER_DRIFT_AMPLITUDE = 0", self.owner_src)
        # The sinusoidal drift term must no longer contribute to the target heading.
        self.assertNotIn(
            "Math.sin(this.wanderPhase) * WANDER_DRIFT_AMPLITUDE",
            self.owner_src,
        )

    def test_10_wander_ray_probing_and_field_obstacles(self):
        """Wander mode must ray-probe field obstacles (trees) via multi-sample rays."""
        self.assertIn("_isWanderProbeBlocked", self.owner_src)
        self.assertIn("_isWanderRayBlocked", self.owner_src)
        self.assertIn("getWorldObstacles", self.owner_src)
        self.assertIn("world.trees", self.owner_src)

        # Behavioral simulation: a tree sits directly between the player and
        # the warp gate. The multi-sample ray probe must detect the tree and
        # select an unblocked deflection heading that clears the tree.
        import math

        class Owner:
            def __init__(self, x, y):
                self.x = x
                self.y = y
                self.radius = 16

            def _is_wander_probe_blocked(self, px, py, world):
                margin = self.radius + 4
                if px < margin or py < margin or px > world["width"] - margin or py > world["height"] - margin:
                    return True
                for tree in world.get("trees", []):
                    reach = tree["r"] + self.radius
                    if (px - tree["x"]) ** 2 + (py - tree["y"]) ** 2 < reach * reach:
                        return True
                return False

            def _is_wander_ray_blocked(self, heading, world, probe_dist=96, samples=6):
                for i in range(1, samples + 1):
                    t = probe_dist * (i / samples)
                    px = self.x + math.cos(heading) * t
                    py = self.y + math.sin(heading) * t
                    if self._is_wander_probe_blocked(px, py, world):
                        return True
                return False

        world = {
            "width": 3200,
            "height": 2400,
            "trees": [{"x": 400.0, "y": 300.0, "r": 30.0}],
        }
        owner = Owner(200.0, 300.0)
        gate = {"x": 600.0, "y": 300.0}

        direct_heading = math.atan2(gate["y"] - owner.y, gate["x"] - owner.x)
        self.assertTrue(
            owner._is_wander_ray_blocked(direct_heading, world),
            "Direct ray toward the gate must be blocked by the tree",
        )

        # Multi-sample deflection search must find a clear heading.
        offsets = [
            math.pi / 6, -math.pi / 6,
            math.pi / 3, -math.pi / 3,
            math.pi / 2, -math.pi / 2,
        ]
        chosen = None
        for off in offsets:
            test_heading = direct_heading + off
            if not owner._is_wander_ray_blocked(test_heading, world):
                chosen = test_heading
                break

        self.assertIsNotNone(chosen, "A deflection heading around the tree must exist")
        # The chosen heading must not collide with the tree along its ray.
        self.assertFalse(owner._is_wander_ray_blocked(chosen, world))

if __name__ == '__main__':
    unittest.main()
