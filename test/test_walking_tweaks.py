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
        self.assertIn("export const LEASH_FLANK_CLEARANCE_MIN_PX = 12;", self.companion_dog_src)
        self.assertIn("export const LEASH_FLANK_CLEARANCE_MAX_PX = 16;", self.companion_dog_src)
        self.assertIn("export const LEASH_FLANK_CLEARANCE_TARGET_PX = 14;", self.companion_dog_src)

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

if __name__ == '__main__':
    unittest.main()
