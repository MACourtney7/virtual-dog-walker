import os
import unittest
import re

TEST_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.abspath(os.path.join(TEST_DIR, ".."))

def read_project_file(rel_path):
    path = os.path.join(PROJECT_DIR, rel_path)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _run_real_js(owner_src: str, dog_src: str, snippet: str):
    """Execute a JS snippet against the real Owner/CompanionDog classes.

    Strips ESM import/export lines, provides minimal bridge stubs, wraps each
    module in an IIFE, and runs the snippet via osascript (JavaScriptCore) or
    node. Returns the JSON-decoded result of the snippet.
    """
    import json
    import shutil
    import subprocess

    clean_owner = re.sub(r"^\s*import\s+.*?;?\s*$", "", owner_src, flags=re.M)
    clean_owner = re.sub(r"\bexport\s+(default\s+)?", "", clean_owner)
    clean_dog = re.sub(r"^\s*import\s+.*?;?\s*$", "", dog_src, flags=re.M)
    clean_dog = re.sub(r"\bexport\s+(default\s+)?", "", clean_dog)

    dog_iife = ""
    if clean_dog.strip():
        dog_iife = (
            "const { CompanionDog, DogState, RoamSubMode, ZoomiePath } = "
            f"(() => {{ {clean_dog}\nreturn {{ CompanionDog, DogState, RoamSubMode, ZoomiePath }}; }})();"
        )

    harness = f"""
function resolveFieldCollision(ent, r, field) {{
  if (field && typeof field.resolveCircleCollision === "function") {{
    const res = field.resolveCircleCollision(ent.x, ent.y, r || 12);
    ent.x = res.x; ent.y = res.y;
  }}
}}
function stepLeashConstraint(dog, owner, restLen, k, damp, dt) {{}}
function stepEarSpringsToTargets(l, r, tl, tr, k, d, dt) {{}}
class PoopPile {{ constructor(id, x, y) {{ this.x = x; this.y = y; }} }}
const {{ Owner, Gait }} = (() => {{ {clean_owner}\nreturn {{ Owner, Gait }}; }})();
{dog_iife}
const __res = (() => {{ {snippet} }})();
JSON.stringify(__res);
"""

    if shutil.which("osascript"):
        out = subprocess.check_output(
            ["osascript", "-l", "JavaScript", "-e", harness], text=True
        ).strip()
        return json.loads(out)
    if shutil.which("node"):
        out = subprocess.check_output(
            ["node", "-e", f"console.log({harness})"], text=True
        ).strip()
        return json.loads(out)
    raise unittest.SkipTest("No JS runtime (osascript or node) available")

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

        # Execute the real Owner class in JS.
        snippet = """
        const o = new Owner(200, 300);
        o.angle = 0.35;
        const world = {
          width: 3200,
          height: 2400,
          warpGates: [{ x: 800, y: 300, targetZoneId: 'z2' }]
        };
        o.wanderMode = true;
        o.wanderBaseHeading = o.angle;
        o.setGait(Gait.WANDER);
        const errors = [];
        for (let i = 0; i < 90; i++) {
          o.update(1 / 60, world);
          errors.push(Math.abs(o.angle));
        }
        return {
          driftAmplitude: Owner.WANDER_DRIFT_AMPLITUDE,
          errors: errors
        };
        """
        res = _run_real_js(self.owner_src, "", snippet)
        self.assertEqual(res["driftAmplitude"], 0)
        errors = res["errors"]
        self.assertEqual(len(errors), 90)
        # Angular error to the gate (0.0 rad) must decrease monotonically
        # without sinusoidal sign reversals.
        for i in range(1, len(errors)):
            self.assertLessEqual(
                errors[i],
                errors[i - 1] + 1e-6,
                f"Angular error increased at frame {i}: {errors[i - 1]} -> {errors[i]}",
            )
        self.assertLess(errors[-1], errors[0])

    def test_10_wander_ray_probing_and_field_obstacles(self):
        """Wander mode must ray-probe field obstacles (trees) via multi-sample rays."""
        self.assertIn("_isWanderProbeBlocked", self.owner_src)
        self.assertIn("_isWanderRayBlocked", self.owner_src)
        self.assertIn("getWorldObstacles", self.owner_src)
        self.assertIn("world.trees", self.owner_src)

        # Execute the real Owner class in JS against a world with a tree and
        # a rectangular obstacle directly between the owner and the gate.
        snippet = """
        const world = {
          width: 3200,
          height: 2400,
          trees: [{ x: 300, y: 300, trunkRadius: 24 }],
          getWorldObstacles() {
            return [
              { kind: 'circle', x: 300, y: 300, r: 24 },
              { kind: 'rect', x: 450, y: 300, hw: 30, hh: 20 }
            ];
          },
          getColliders() {
            return [{ x: 350, y: 500, radius: 20 }];
          },
          warpGates: [{ x: 700, y: 300, targetZoneId: 'z2' }]
        };
        const o = new Owner(200, 300);
        const directBlocked = o._isWanderRayBlocked(0, 120, world);
        const colliderBlocked = o._isWanderProbeBlocked(350, 500, world);
        o.wanderMode = true;
        o.wanderBaseHeading = o.angle;
        o.setGait(Gait.WANDER);
        let minTreeDist = Infinity;
        let maxAbsY = 0;
        for (let i = 0; i < 240; i++) {
          o.update(1 / 60, world);
          minTreeDist = Math.min(minTreeDist, Math.hypot(o.x - 300, o.y - 300));
          maxAbsY = Math.max(maxAbsY, Math.abs(o.y - 300));
        }
        return {
          directBlocked: directBlocked,
          colliderBlocked: colliderBlocked,
          minTreeDist: minTreeDist,
          maxAbsY: maxAbsY,
          finalX: o.x,
          radius: o.radius
        };
        """
        res = _run_real_js(self.owner_src, "", snippet)
        self.assertTrue(res["directBlocked"], "Direct ray toward the gate must be blocked")
        self.assertTrue(res["colliderBlocked"], "getColliders() collider must block the probe")
        self.assertGreaterEqual(
            res["minTreeDist"],
            24 + res["radius"],
            "Owner must never collide with the tree",
        )
        self.assertGreater(res["maxAbsY"], 15, "Owner must steer laterally around the tree")
        self.assertGreater(res["finalX"], 310, "Owner must make forward progress")

if __name__ == '__main__':
    unittest.main()
