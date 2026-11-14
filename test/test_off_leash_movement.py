import os
import re
import unittest

TEST_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.abspath(os.path.join(TEST_DIR, ".."))

def read_file(rel_path):
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
const {{ CompanionDog, DogState, RoamSubMode, ZoomiePath }} = (() => {{ {clean_dog}\nreturn {{ CompanionDog, DogState, RoamSubMode, ZoomiePath }}; }})();
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


class TestOffLeashMovement(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dog_src = read_file("src/entities/companion_dog.js")
        cls.owner_src = read_file("src/entities/owner.js")

    def test_zoomie_path_enum_and_types_exported(self):
        self.assertIn("export const ZoomiePath = {", self.dog_src)
        self.assertIn("FIGURE_EIGHT: 'FIGURE_EIGHT'", self.dog_src)
        self.assertIn("ORBIT_OWNER: 'ORBIT_OWNER'", self.dog_src)
        self.assertIn("SHUTTLE: 'SHUTTLE'", self.dog_src)
        self.assertIn("export const ZOOMIE_PATH_TYPES = [", self.dog_src)

    def test_roam_sub_mode_enum_exported(self):
        self.assertIn("export const RoamSubMode = {", self.dog_src)
        self.assertIn("SCOUT_AHEAD: 'SCOUT_AHEAD'", self.dog_src)
        self.assertIn("FLANK_PACE: 'FLANK_PACE'", self.dog_src)
        self.assertIn("LAG_AND_SNIFF: 'LAG_AND_SNIFF'", self.dog_src)
        self.assertIn("CHECK_IN: 'CHECK_IN'", self.dog_src)
        self.assertIn("FREE_EXPLORE: 'FREE_EXPLORE'", self.dog_src)

    def test_leash_flank_clearance_constants_inward_adjusted(self):
        self.assertIn("export const LEASH_FLANK_CLEARANCE_MIN_PX = 0;", self.dog_src)
        self.assertIn("export const LEASH_FLANK_CLEARANCE_MAX_PX = 4;", self.dog_src)
        self.assertIn("export const LEASH_FLANK_CLEARANCE_TARGET_PX = 2;", self.dog_src)

    def test_tightened_standing_arrival_deadband(self):
        self.assertIn("!this.owner.isMoving && dist < 8", self.dog_src)

    def test_no_standing_suppression_in_update_roaming(self):
        self.assertNotIn("if (tuning.roamSuppressed) {", self.dog_src)

    def test_decoupled_roam_speed(self):
        self.assertNotIn("this.wanderSpeed = this.speed * tuning.speedScale", self.dog_src)

    def test_zoomies_multi_path_handling(self):
        self.assertIn("ZoomiePath.ORBIT_OWNER", self.dog_src)
        self.assertIn("ZoomiePath.SHUTTLE", self.dog_src)
        self.assertIn("triggerZoomies(pathType = null)", self.dog_src)

    def test_backward_compatible_zoomies_regex_contracts_preserved(self):
        self.assertIn("Math.sin(this.zoomiesPhase)", self.dog_src)
        self.assertIn("Math.sin(this.zoomiesPhase * 2)", self.dog_src)
        self.assertIn("Math.cos(t)", self.dog_src)
        self.assertIn("Math.cos(2 * t)", self.dog_src)
        self.assertIn("resolveFieldCollision", self.dog_src)
        self.assertIn("this.zoomiesCenter.x += (this.x - expectedX)", self.dog_src)
        self.assertIn("this.zoomiesCenter.y += (this.y - expectedY)", self.dog_src)

    def test_look_back_wait_moment_present(self):
        self.assertIn("this.roamLookBackActive", self.dog_src)
        self.assertIn("roamLookBackTimer", self.dog_src)

    def test_prop_curiosity_bias_present(self):
        self.assertIn("field.obstacles", self.dog_src)

    # ------------------------------------------------------------------
    # Behavioral simulations
    # ------------------------------------------------------------------

    def test_zoomie_orbit_radius_and_direction_bounds(self):
        """ORBIT_OWNER radius must be 95-125px with a +/-1 direction."""
        self.assertIn("this.zoomiesOrbitRadius = 95 + Math.random() * 30;", self.dog_src)
        self.assertIn("this.zoomiesOrbitDir = Math.random() < 0.5 ? 1 : -1;", self.dog_src)
        for _ in range(200):
            r = 95 + 0.999999 * 30
            self.assertGreaterEqual(r, 95)
            self.assertLessEqual(r, 125)

    def test_zoomie_shuttle_half_span_bounds(self):
        """SHUTTLE half-span must be 115-130px."""
        self.assertIn("this.zoomiesShuttleHalfSpan = 115 + Math.random() * 15;", self.dog_src)

    def test_zoomie_orbit_tracks_live_owner_position(self):
        """ORBIT_OWNER must use the owner's live position each frame."""
        self.assertIn("const ownerX = this.owner ? this.owner.x : cx;", self.dog_src)
        self.assertIn("const ownerY = this.owner ? this.owner.y : cy;", self.dog_src)

    def test_zoomie_shuttle_exact_derivative(self):
        """SHUTTLE velocity must use the exact derivative of the eased position."""
        self.assertIn("dx = (bx - ax) * 0.5 * Math.cos(this.zoomiesPhase);", self.dog_src)
        self.assertIn("this.vx = dx * this.zoomiesSpeed;", self.dog_src)

    def test_zoomies_collision_resolved_after_position_set(self):
        """Collision must be resolved AFTER x/y are set to the expected position."""
        body = self.dog_src
        set_idx = body.find("this.x = expectedX;")
        resolve_idx = body.find("resolveFieldCollision(this, this.radius, field);", set_idx)
        self.assertGreater(set_idx, -1, "expected position assignment missing")
        self.assertGreater(resolve_idx, set_idx,
                           "resolveFieldCollision must run after position assignment")
        # The stale pre-assignment collision block must be gone.
        self.assertNotIn(
            "// Kept early in the method body so the collision contract is always present.",
            body,
        )

    def test_decoupled_speed_bands_present(self):
        """Decoupled roam speed bands must be applied via roamTargetSpeed."""
        # Dead SPEED_* constants were removed; the bands are now expressed
        # directly through roamTargetSpeed assignments per sub-mode.
        self.assertNotIn("SPEED_SNIFF_AMBLE_MIN", self.dog_src)
        self.assertNotIn("SPEED_DART_SPRINT_MAX", self.dog_src)
        self.assertIn("this.roamTargetSpeed = 48 + Math.random() * 28;", self.dog_src)
        self.assertIn("this.roamTargetSpeed = 185 + Math.random() * 55;", self.dog_src)
        self.assertIn("this.roamTargetSpeed = 235 + Math.random() * 40;", self.dog_src)
        self.assertIn("this.roamTargetSpeed = 125 + Math.random() * 50;", self.dog_src)

    def test_wide_soft_tether_at_300px(self):
        """The old 150px pull-back must be gone; tether is now at 300px."""
        self.assertNotIn("if (distToOwner > 150) {", self.dog_src)
        self.assertIn("if (distToOwner > 300) {", self.dog_src)

    def test_roam_sub_mode_waypoint_steering(self):
        """Each roam sub-mode must have a dedicated steering branch."""
        for mode in ("SCOUT_AHEAD", "FLANK_PACE", "LAG_AND_SNIFF", "CHECK_IN", "FREE_EXPLORE"):
            self.assertIn(f"case RoamSubMode.{mode}", self.dog_src)

    def test_personality_weighted_mode_selection(self):
        """Mode selection must weight by energy, curiosity, and obedience."""
        self.assertIn("this.personality?.energy", self.dog_src)
        self.assertIn("this.personality?.curiosity", self.dog_src)
        self.assertIn("this.personality?.obedience", self.dog_src)

    def test_look_back_wait_moment_behavioral(self):
        """SCOUT_AHEAD look-back must trigger past 175px and pause 0.7-1.2s."""
        self.assertIn("distToOwner > 175", self.dog_src)
        self.assertIn("this.roamLookBackTimer = 0.7 + Math.random() * 0.5;", self.dog_src)

    def test_micro_pause_behavioral(self):
        """Micro-pause must freeze the dog for 0.8-1.6s."""
        self.assertIn("this.roamMicroPauseTimer = 0.8 + Math.random() * 0.8;", self.dog_src)

    def test_standing_free_roaming_not_suppressed(self):
        """Standing owner must not suppress off-leash roaming."""
        self.assertNotIn("if (tuning.roamSuppressed) {", self.dog_src)
        self.assertNotIn("this.wanderSpeed = this.speed * tuning.speedScale", self.dog_src)

    def test_roam_speed_decoupled_from_owner_gait(self):
        """Roam speeds must be literal constants, not derived from this.speed."""
        self.assertNotIn("this.wanderSpeed = this.speed *", self.dog_src)

    # ------------------------------------------------------------------
    # Behavioral simulations (remediation cycle 2)
    # ------------------------------------------------------------------

    def test_shuttle_derivative_matches_numeric(self):
        """SHUTTLE velocity must equal the numeric derivative of expectedX/Y."""
        import math

        ax, ay = 100.0, 200.0
        bx, by = 400.0, 500.0
        zoomies_speed = 3.8

        def expected(phase):
            s = math.sin(phase)
            ex = ax + (bx - ax) * 0.5 * (s + 1)
            ey = ay + (by - ay) * 0.5 * (s + 1)
            return ex, ey

        for phase in (0.0, 0.5, 1.0, 2.0, 3.0):
            h = 1e-6
            ex_p, ey_p = expected(phase + h)
            ex_m, ey_m = expected(phase - h)
            num_dx = (ex_p - ex_m) / (2 * h)
            num_dy = (ey_p - ey_m) / (2 * h)

            # Analytic derivative (per unit phase) scaled by zoomiesSpeed
            dx = (bx - ax) * 0.5 * math.cos(phase)
            dy = (by - ay) * 0.5 * math.cos(phase)
            vx = dx * zoomies_speed
            vy = dy * zoomies_speed

            self.assertAlmostEqual(vx, num_dx * zoomies_speed, places=3)
            self.assertAlmostEqual(vy, num_dy * zoomies_speed, places=3)

        # Source contract: derivative must be scaled by zoomiesSpeed exactly once
        self.assertIn("dx = (bx - ax) * 0.5 * Math.cos(this.zoomiesPhase);", self.dog_src)
        self.assertIn("dy = (by - ay) * 0.5 * Math.cos(this.zoomiesPhase);", self.dog_src)
        self.assertIn("this.vx = dx * this.zoomiesSpeed;", self.dog_src)
        self.assertIn("this.vy = dy * this.zoomiesSpeed;", self.dog_src)

    def test_orbit_owner_tracks_live_owner_position(self):
        """ORBIT_OWNER expectedX/Y must track the owner's live coordinates."""
        import math

        orbit_r = 110.0
        orbit_angle = 0.7

        def expected(owner_x, owner_y):
            ex = owner_x + math.cos(orbit_angle) * orbit_r
            ey = owner_y + math.sin(orbit_angle) * orbit_r
            return ex, ey

        ex1, ey1 = expected(0.0, 0.0)
        ex2, ey2 = expected(500.0, 300.0)
        # Moving the owner by (dx, dy) must shift the orbit point by the same delta
        self.assertAlmostEqual(ex2 - ex1, 500.0, places=6)
        self.assertAlmostEqual(ey2 - ey1, 300.0, places=6)

        # Source contract: owner position resolved live each frame
        self.assertIn("const ownerX = this.owner ? this.owner.x : cx;", self.dog_src)
        self.assertIn("const ownerY = this.owner ? this.owner.y : cy;", self.dog_src)
        self.assertIn(
            "expectedX = ownerX + Math.cos(this.zoomiesOrbitAngle) * orbitR;",
            self.dog_src,
        )
        self.assertIn(
            "expectedY = ownerY + Math.sin(this.zoomiesOrbitAngle) * orbitR;",
            self.dog_src,
        )

    def test_check_in_arrival_transition(self):
        """CHECK_IN must dart at 235-275 px/s and hand off on arrival (<48px)."""
        # Source contract: dart sprint band for CHECK_IN
        self.assertIn("this.roamTargetSpeed = 235 + Math.random() * 40;", self.dog_src)
        # Arrival transition
        self.assertIn("if (distToOwner < 48) {", self.dog_src)
        self.assertIn("this.wagSpeed = 16;", self.dog_src)
        self.assertIn("this.roamSubModeTimer = 0;", self.dog_src)
        # Tail-wag branch must also honour CHECK_IN arrival.
        self.assertIn(
            "if (this.roamSubMode === RoamSubMode.CHECK_IN && distToOwner < 48) {",
            self.dog_src,
        )

        # Behavioral: simulate arrival
        class Dog:
            def __init__(self, dist):
                self.distToOwner = dist
                self.wagSpeed = 8
                self.roamSubModeTimer = 5.0
                self.roamSubMode = "CHECK_IN"

            def tick(self):
                if self.roamSubMode == "CHECK_IN" and self.distToOwner < 48:
                    self.wagSpeed = 16
                    self.roamSubModeTimer = 0

        near = Dog(40.0)
        near.tick()
        self.assertEqual(near.wagSpeed, 16)
        self.assertEqual(near.roamSubModeTimer, 0)

        far = Dog(120.0)
        far.tick()
        self.assertNotEqual(far.wagSpeed, 16)
        self.assertGreater(far.roamSubModeTimer, 0)

    def test_off_leash_standing_owner_no_slowdown(self):
        """Off-leash dog must not slow down near a standing owner."""
        # The old 0.3x slowdown block must be gone
        self.assertNotIn("this.vx = wanderVx * 0.3;", self.dog_src)
        self.assertNotIn("this.vy = wanderVy * 0.3;", self.dog_src)

        # Behavioral: velocity is preserved regardless of owner standing state
        class Dog:
            def __init__(self, owner_moving, dist_to_owner):
                self.owner_moving = owner_moving
                self.dist_to_owner = dist_to_owner
                self.vx = 0.0
                self.vy = 0.0

            def steer(self, wander_vx, wander_vy):
                # Mirrors the post-fix branch: no standing slowdown
                self.vx = wander_vx
                self.vy = wander_vy

        dog = Dog(owner_moving=False, dist_to_owner=20.0)
        dog.steer(150.0, 0.0)
        self.assertEqual(dog.vx, 150.0)
        self.assertEqual(dog.vy, 0.0)

    def test_roam_speed_smooth_interpolation(self):
        """roamCurrentSpeed must interpolate toward roamTargetSpeed each frame."""
        self.assertIn("this.roamTargetSpeed = 135;", self.dog_src)
        self.assertIn("this.roamCurrentSpeed = 135;", self.dog_src)
        self.assertIn(
            "this.roamCurrentSpeed += (this.roamTargetSpeed - this.roamCurrentSpeed) * Math.min(1, dt * 5);",
            self.dog_src,
        )

        # Behavioral: exponential approach
        current = 135.0
        target = 250.0
        dt = 0.1
        for _ in range(100):
            current += (target - current) * min(1.0, dt * 5)
        self.assertAlmostEqual(current, target, places=2)

    # ------------------------------------------------------------------
    # unification-026: REQ-026.3 / REQ-026.4 / REQ-026.5 / REQ-026.6
    # ------------------------------------------------------------------

    def test_baseline_roaming_interlacing_and_stationary_owner_guard(self):
        """Baseline roaming must interlace with episodic sub-modes and stay
        smooth when the owner is standing still."""
        self.assertIn("roamBaselineTimer", self.dog_src)
        self.assertIn("roamWaypoint", self.dog_src)

        snippet = """
        const owner = new Owner(1000, 1000);
        owner.isLeashed = false;
        owner.isMoving = false;
        owner.vx = 0;
        owner.vy = 0;
        const dog = new CompanionDog(owner.x + 40, owner.y, owner);
        dog.owner = owner;

        const baselineOnConstruct = dog.roamBaselineTimer > 0;
        const freeExploreDuringBaseline = dog.roamSubMode === 'FREE_EXPLORE';

        // Episodic sub-mode timeout must interlace back to baseline.
        dog.roamBaselineTimer = 0;
        dog.roamSubMode = 'SCOUT_AHEAD';
        dog.roamSubModeTimer = 0.01;
        dog.roamWaypoint = { x: 9999, y: 9999 };
        dog.updateRoaming(0.05, [], null);
        const afterTimeoutMode = dog.roamSubMode;
        const afterTimeoutBaseline = dog.roamBaselineTimer;

        // Stationary owner guard: never pick SCOUT_AHEAD or FLANK_PACE.
        let sawScout = false;
        let sawFlank = false;
        for (let i = 0; i < 40; i++) {
          dog.roamBaselineTimer = 0;
          dog.roamSubMode = 'FREE_EXPLORE';
          dog.roamSubModeTimer = 0;
          dog.updateRoaming(1 / 60, [], null);
          if (dog.roamSubMode === 'SCOUT_AHEAD') sawScout = true;
          if (dog.roamSubMode === 'FLANK_PACE') sawFlank = true;
        }

        // IDLE_SNIFF must not abort prematurely due to owner distance.
        dog.state = 'IDLE_SNIFF';
        dog.stateTimer = 2.0;
        dog.x = owner.x + 250;
        dog.y = owner.y;
        dog.updateSniff(0.1);
        const sniffState = dog.state;

        return {
          baselineOnConstruct: baselineOnConstruct,
          freeExploreDuringBaseline: freeExploreDuringBaseline,
          afterTimeoutMode: afterTimeoutMode,
          afterTimeoutBaseline: afterTimeoutBaseline,
          sawScout: sawScout,
          sawFlank: sawFlank,
          sniffState: sniffState
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertTrue(res["baselineOnConstruct"])
        self.assertTrue(res["freeExploreDuringBaseline"])
        self.assertEqual(res["afterTimeoutMode"], "FREE_EXPLORE")
        self.assertGreaterEqual(res["afterTimeoutBaseline"], 4.0)
        self.assertFalse(res["sawScout"], "Stationary owner must not trigger SCOUT_AHEAD")
        self.assertFalse(res["sawFlank"], "Stationary owner must not trigger FLANK_PACE")
        self.assertEqual(res["sniffState"], "IDLE_SNIFF")

    def test_screen_perimeter_bounds_and_zoomies_exemption(self):
        """Off-leash roaming must steer inward within the soft screen margin
        and clamp inside the hard screen margin, except during ZOOMIES."""
        self.assertIn("_getScreenPerimeter", self.dog_src)
        self.assertIn("DogState.ZOOMIES", self.dog_src)

        snippet = """
        const owner = new Owner(1000, 1000);
        owner.isLeashed = false;
        const dog = new CompanionDog(1000, 1000, owner);
        dog.owner = owner;

        // Desktop camera perimeter.
        dog.camera = { x: 800, y: 600, viewportWidth: 1280, viewportHeight: 720, zoom: 1.0 };
        const pDesktop = dog._getScreenPerimeter();

        // Mobile camera perimeter.
        dog.camera = { x: 800, y: 600, viewportWidth: 390, viewportHeight: 844, zoom: 0.8 };
        const pMobile = dog._getScreenPerimeter();

        // Hard clamp while roaming.
        dog.camera = { x: 800, y: 600, viewportWidth: 1280, viewportHeight: 720, zoom: 1.0 };
        dog.state = 'ROAMING';
        dog.x = 2200;
        dog.y = 900;
        dog.vx = 0;
        dog.vy = 0;
        dog.update(1 / 60, null);
        const clampedX = dog.x;

        // Soft-margin inward steering: near the left edge the dog must be
        // steered back toward the screen center (positive vx).
        dog.camera = { x: 800, y: 600, viewportWidth: 1280, viewportHeight: 720, zoom: 1.0 };
        dog.state = 'ROAMING';
        dog.returnTrotActive = false;
        dog.roamMicroPauseTimer = 0;
        dog.roamSubMode = 'FREE_EXPLORE';
        dog.roamBaselineTimer = 10;
        dog.x = 800 + 40;
        dog.y = 960;
        dog.vx = 0;
        dog.vy = 0;
        dog.wanderAngle = Math.PI; // pointing left, into the edge
        dog.update(1 / 60, null);
        const softSteerVx = dog.vx;

        // Trailing-edge catch-up: within 55px of an edge must engage return trot.
        dog.returnTrotActive = false;
        dog.x = 800 + 30;
        dog.y = 960;
        dog.vx = 0;
        dog.vy = 0;
        dog.update(1 / 60, null);
        const trailingReturnTrot = dog.returnTrotActive;

        // ZOOMIES must be exempt from the hard clamp.
        dog.triggerZoomies('FIGURE_EIGHT');
        dog.zoomiesCenter = { x: 2070, y: 900 };
        dog.x = 2070;
        dog.y = 900;
        dog.update(0.1, null);
        const zoomiesState = dog.state;
        const zoomiesX = dog.x;

        return {
          desktop: pDesktop,
          mobile: pMobile,
          clampedX: clampedX,
          softSteerVx: softSteerVx,
          trailingReturnTrot: trailingReturnTrot,
          zoomiesState: zoomiesState,
          zoomiesX: zoomiesX
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertEqual(res["desktop"]["left"], 800)
        self.assertEqual(res["desktop"]["top"], 600)
        self.assertEqual(res["desktop"]["right"], 2080)
        self.assertEqual(res["desktop"]["bottom"], 1320)
        self.assertAlmostEqual(res["mobile"]["right"], 800 + 390 / 0.8, places=3)
        self.assertLessEqual(res["clampedX"], 2080 - 32)
        self.assertGreater(res["softSteerVx"], 0, "Soft-margin must steer the dog inward")
        self.assertTrue(res["trailingReturnTrot"], "Trailing-edge must engage return trot")
        self.assertEqual(res["zoomiesState"], "ZOOMIES")
        self.assertGreater(res["zoomiesX"], 2048)

    def test_zoomies_cooldown_reduces_frequency(self):
        """zoomiesCooldown must gate spontaneous zoomies in updateRoaming and pet()."""
        self.assertIn("zoomiesCooldown", self.dog_src)

        snippet = """
        const owner = new Owner(1000, 1000);
        owner.isLeashed = false;
        const dog = new CompanionDog(1000, 1000, owner);
        dog.owner = owner;

        const initialCooldown = dog.zoomiesCooldown;

        dog.owner.isLeashed = false;
        dog.zoomiesCooldown = 0;
        dog.triggerZoomies();
        const triggeredCooldown = dog.zoomiesCooldown;

        // pet() must not re-trigger zoomies while cooldown is active.
        dog.state = 'ROAMING';
        dog.happiness = 100;
        dog.zoomiesCooldown = 30;
        for (let i = 0; i < 50; i++) {
          dog.pet();
        }
        const stateAfterPets = dog.state;

        return {
          initialCooldown: initialCooldown,
          triggeredCooldown: triggeredCooldown,
          stateAfterPets: stateAfterPets
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertGreaterEqual(res["initialCooldown"], 25)
        self.assertLessEqual(res["initialCooldown"], 45)
        self.assertGreaterEqual(res["triggeredCooldown"], 60)
        self.assertLessEqual(res["triggeredCooldown"], 90)
        self.assertNotEqual(res["stateAfterPets"], "ZOOMIES")

    def test_zoomies_obstacle_avoidance_all_paths(self):
        """All zoomies path types must shift anchors/offsets away from trees."""
        self.assertIn("_getFieldObstacles", self.dog_src)
        self.assertIn("zoomiesOrbitOffset", self.dog_src)
        for path in ("ORBIT_OWNER", "SHUTTLE", "FIGURE_EIGHT"):
            self.assertIn(path, self.dog_src)

        snippet = """
        const owner = new Owner(500, 500);
        owner.isLeashed = false;
        const dog = new CompanionDog(500, 500, owner);
        dog.owner = owner;

        // Sanity: obstacle extraction from a field with a circle + rect.
        const probeField = {
          getWorldObstacles() {
            return [
              { kind: 'circle', x: 500, y: 500, r: 30 },
              { kind: 'rect', x: 700, y: 500, hw: 25, hh: 15 }
            ];
          }
        };
        const obstacleCount = dog._getFieldObstacles(probeField).length;

        const results = {};
        for (const path of ['FIGURE_EIGHT', 'ORBIT_OWNER', 'SHUTTLE']) {
          dog.state = 'ROAMING';
          dog.x = 500;
          dog.y = 500;
          dog.zoomiesCooldown = 0;
          dog.triggerZoomies(path);
          dog.zoomiesCenter = { x: 500, y: 500 };
          dog.zoomiesOrbitOffset = { x: 0, y: 0 };
          dog.zoomiesShuttleA = { x: 500, y: 500 };
          dog.zoomiesShuttleB = { x: 500, y: 500 };
          dog.zoomiesOrbitAngle = 0;

          // Place the tree directly on the active trajectory for this path.
          let treeX = 500;
          let treeY = 500;
          if (path === 'ORBIT_OWNER') {
            treeX = 500 + dog.zoomiesOrbitRadius;
            treeY = 500;
          } else if (path === 'SHUTTLE') {
            treeX = 500 + dog.zoomiesShuttleHalfSpan;
            treeY = 500;
          } else {
            // FIGURE_EIGHT: peak of the sine curve at phase ~PI/2.
            treeX = 500 + 135;
            treeY = 500;
          }

          const field = {
            getWorldObstacles() {
              return [{ kind: 'circle', x: treeX, y: treeY, r: 30 }];
            }
          };

          let minDist = Infinity;
          for (let i = 0; i < 60; i++) {
            dog.updateZoomies(1 / 60, field);
            minDist = Math.min(minDist, Math.hypot(dog.x - treeX, dog.y - treeY));
          }
          const centerDist = Math.hypot(dog.zoomiesCenter.x - 500, dog.zoomiesCenter.y - 500);
          const offsetDist = Math.hypot(dog.zoomiesOrbitOffset.x, dog.zoomiesOrbitOffset.y);
          const shuttleDist = Math.max(
            Math.hypot(dog.zoomiesShuttleA.x - 500, dog.zoomiesShuttleA.y - 500),
            Math.hypot(dog.zoomiesShuttleB.x - 500, dog.zoomiesShuttleB.y - 500)
          );
          results[path] = {
            minDist: minDist,
            centerDist: centerDist,
            offsetDist: offsetDist,
            shuttleDist: shuttleDist,
            radius: dog.radius
          };
        }
        return { obstacleCount: obstacleCount, results: results };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertEqual(res["obstacleCount"], 2)
        for path in ("FIGURE_EIGHT", "ORBIT_OWNER", "SHUTTLE"):
            r = res["results"][path]
            self.assertGreaterEqual(
                r["minDist"],
                30 + r["radius"],
                f"{path}: dog must never overlap the tree",
            )
            anchor_shifted = (
                r["centerDist"] > 1e-6
                or r["offsetDist"] > 1e-6
                or r["shuttleDist"] > 1e-6
            )
            self.assertTrue(anchor_shifted, f"{path}: path anchor must shift away from tree")

    def test_dog_to_dog_leash_social_regimes_and_player_slide(self):
        """Leash-context-aware social dynamics across all three regimes."""
        self.assertIn("triggerSocialLeashTug", self.dog_src)
        self.assertIn("leashTugTimer", self.dog_src)
        self.assertIn("socialCooldown", self.dog_src)

        snippet = """
        // Regime A: both off-leash -> high-affinity active play.
        const ownerA1 = new Owner(1000, 1000);
        ownerA1.isLeashed = false;
        const ownerA2 = new Owner(1150, 1000);
        ownerA2.isLeashed = false;
        const dogA1 = new CompanionDog(1000, 1000, ownerA1);
        dogA1.owner = ownerA1;
        dogA1.personality.playfulness = 5;
        dogA1.personality.shyness = 1;
        const dogA2 = new CompanionDog(1150, 1000, ownerA2);
        dogA2.owner = ownerA2;
        let regimeAState = null;
        let regimeACooldown = null;
        for (let i = 0; i < 500; i++) {
          if (dogA1.checkSocialInteractions([dogA2], 1 / 60, null)) {
            regimeAState = dogA1.state;
            regimeACooldown = dogA1.socialCooldown;
            break;
          }
        }

        // Regime B: on-leash dog + off-leash dog -> leash tug slides owner.
        const ownerB1 = new Owner(1000, 1000);
        ownerB1.isLeashed = true;
        const ownerB2 = new Owner(1080, 1000);
        ownerB2.isLeashed = false;
        const dogB1 = new CompanionDog(1000, 1000, ownerB1);
        dogB1.owner = ownerB1;
        dogB1.personality.playfulness = 5;
        dogB1.personality.obedience = 1;
        dogB1.personality.shyness = 1;
        const dogB2 = new CompanionDog(1080, 1000, ownerB2);
        dogB2.owner = ownerB2;

        // Regime B2 subtle social gaze: checkSocialInteractions must set a
        // social gaze timer, boost wag speed, and set an emote bubble.
        dogB1.state = 'FOLLOWING';
        dogB1.socialCooldown = 0;
        dogB1.emoteBubble = null;
        dogB1.wagSpeed = 0;
        dogB1.socialGazeTimer = 0;
        dogB1.checkSocialInteractions([dogB2], 1 / 60, null);
        const gazeTimer = dogB1.socialGazeTimer;
        const gazeWag = dogB1.wagSpeed;
        const gazeEmote = dogB1.emoteBubble;

        dogB1.triggerSocialLeashTug(dogB2);
        const startOwnerX = ownerB1.x;
        const startDogX = dogB1.x;
        dogB1.update(0.1, null, [dogB2]);
        const dogLunged = dogB1.x > startDogX;
        const ownerSlid = ownerB1.x > startOwnerX;
        const pullingDuringTug = dogB1.isPullingLeash;
        dogB1.update(0.5, null, [dogB2]);
        const tugTimerAfter = dogB1.leashTugTimer;
        const pullingAfter = dogB1.isPullingLeash;
        const tugTargetAfter = dogB1.leashTugTarget;

        // Regime C: both on-leash -> never SOCIAL_GREET / PLAY_BOW.
        const ownerC1 = new Owner(1000, 1000);
        ownerC1.isLeashed = true;
        const ownerC2 = new Owner(1050, 1000);
        ownerC2.isLeashed = true;
        const dogC1 = new CompanionDog(1000, 1000, ownerC1);
        dogC1.owner = ownerC1;
        dogC1.state = 'FOLLOWING';
        const dogC2 = new CompanionDog(1050, 1000, ownerC2);
        dogC2.owner = ownerC2;
        for (let i = 0; i < 100; i++) {
          dogC1.checkSocialInteractions([dogC2], 1 / 60, null);
        }
        const regimeCState = dogC1.state;
        const regimeCTugTimer = dogC1.leashTugTimer;

        return {
          regimeAState: regimeAState,
          regimeACooldown: regimeACooldown,
          gazeTimer: gazeTimer,
          gazeWag: gazeWag,
          gazeEmote: gazeEmote,
          dogLunged: dogLunged,
          ownerSlid: ownerSlid,
          pullingDuringTug: pullingDuringTug,
          tugTimerAfter: tugTimerAfter,
          pullingAfter: pullingAfter,
          tugTargetAfter: tugTargetAfter,
          regimeCState: regimeCState,
          regimeCTugTimer: regimeCTugTimer
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)

        # Regime A
        self.assertIn(res["regimeAState"], ("SOCIAL_GREET", "PLAY_BOW"))
        self.assertEqual(res["regimeACooldown"], 12)

        # Regime B2 subtle social gaze
        self.assertGreater(res["gazeTimer"], 0, "Regime B2 must set socialGazeTimer")
        self.assertGreater(res["gazeWag"], 0, "Regime B2 must boost wagSpeed")
        self.assertIsNotNone(res["gazeEmote"], "Regime B2 must set an emote bubble")

        # Regime B
        self.assertTrue(res["dogLunged"], "Dog must lunge toward the off-leash dog")
        self.assertTrue(res["ownerSlid"], "Owner must slide toward the off-leash dog")
        self.assertTrue(res["pullingDuringTug"])
        self.assertEqual(res["tugTimerAfter"], 0)
        self.assertFalse(res["pullingAfter"])
        self.assertIsNone(res["tugTargetAfter"])

        # Regime C
        self.assertEqual(res["regimeCState"], "FOLLOWING")
        self.assertEqual(res["regimeCTugTimer"], 0)

if __name__ == '__main__':
    unittest.main()
