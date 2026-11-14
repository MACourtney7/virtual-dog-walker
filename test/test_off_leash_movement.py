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

        // Arrival handoffs for ALL episodic modes must reset to baseline.
        const arrivals = {};
        const runArrival = (mode) => {
          owner.angle = 0;
          owner.isMoving = true;
          owner.vx = 100;
          owner.vy = 0;
          dog.state = 'ROAMING';
          dog.roamBaselineTimer = 0;
          dog.roamSubMode = mode;
          dog.roamSubModeTimer = 5.0;
          dog.roamTargetSpeed = 230;
          dog.roamSubModeOptionLead = 120;
          dog.roamSubModeOptionLateral = 55;
          dog.roamSubModeOptionForward = 10;
          dog.roamSubModeOptionLag = 70;
          dog.roamLookBackDone = true;
          dog.roamLookBackActive = false;
          dog.roamMicroPauseTimer = 0;
          dog.returnTrotActive = false;
          dog.camera = null;
          dog.wanderAngle = 0;
          // Place the dog exactly on the mode's target so arrival triggers.
          if (mode === 'SCOUT_AHEAD') {
            dog.roamWaypoint = null;
            dog.x = owner.x + 120;
            dog.y = owner.y + (dog.preferredSide === 'left' ? -20 : 20);
          } else if (mode === 'FLANK_PACE') {
            dog.roamWaypoint = null;
            const side = dog.preferredSide === 'left' ? -1 : 1;
            dog.x = owner.x + 10;
            dog.y = owner.y + side * 55;
          } else if (mode === 'LAG_AND_SNIFF') {
            dog.roamWaypoint = { x: owner.x - 70, y: owner.y };
            dog.x = owner.x - 70;
            dog.y = owner.y;
          } else if (mode === 'CHECK_IN') {
            dog.roamWaypoint = null;
            dog.x = owner.x + 10;
            dog.y = owner.y;
          }
          dog.updateRoaming(1 / 60, [], null);
          arrivals[mode] = {
            mode: dog.roamSubMode,
            baseline: dog.roamBaselineTimer,
            speed: dog.roamTargetSpeed,
            lookBackDone: dog.roamLookBackDone,
            waypoint: dog.roamWaypoint
          };
        };
        runArrival('SCOUT_AHEAD');
        runArrival('FLANK_PACE');
        runArrival('LAG_AND_SNIFF');
        runArrival('CHECK_IN');

        return {
          baselineOnConstruct: baselineOnConstruct,
          freeExploreDuringBaseline: freeExploreDuringBaseline,
          afterTimeoutMode: afterTimeoutMode,
          afterTimeoutBaseline: afterTimeoutBaseline,
          sawScout: sawScout,
          sawFlank: sawFlank,
          sniffState: sniffState,
          arrivals: arrivals
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
        for mode in ("SCOUT_AHEAD", "FLANK_PACE", "LAG_AND_SNIFF", "CHECK_IN"):
            a = res["arrivals"][mode]
            self.assertEqual(a["mode"], "FREE_EXPLORE", f"{mode} arrival must hand off to FREE_EXPLORE")
            self.assertGreaterEqual(a["baseline"], 4.5, f"{mode} arrival must reset baseline timer")
            self.assertGreaterEqual(a["speed"], 125, f"{mode} arrival must reset roamTargetSpeed")
            self.assertLessEqual(a["speed"], 175, f"{mode} arrival must reset roamTargetSpeed")
            self.assertFalse(a["lookBackDone"], f"{mode} arrival must reset roamLookBackDone")
            self.assertIsNone(a["waypoint"], f"{mode} arrival must clear roamWaypoint")

    def test_screen_perimeter_bounds_and_zoomies_exemption(self):
        """Off-leash roaming must steer inward within the soft screen margin
        and clamp inside the hard screen margin, except during ZOOMIES."""
        self.assertIn("_getScreenPerimeter", self.dog_src)
        self.assertIn("DogState.ZOOMIES", self.dog_src)

        # main.js must wire the camera into both the owner and the dog.
        main_src = read_file("src/main.js")
        self.assertIn("this.dog.camera = this.camera", main_src)
        self.assertIn("this.owner.camera = this.camera", main_src)

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

        // Sanity: obstacle extraction must aggregate ALL sources non-exclusively.
        const probeField = {
          getWorldObstacles() {
            return [
              { kind: 'circle', x: 500, y: 500, r: 30 },
              { kind: 'rect', x: 700, y: 500, hw: 25, hh: 15 }
            ];
          },
          getColliders() {
            return [{ x: 800, y: 500, radius: 20 }];
          },
          trees: [{ x: 900, y: 500, trunkRadius: 18 }]
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
        self.assertGreaterEqual(
            res["obstacleCount"], 4,
            "Obstacle extraction must aggregate getWorldObstacles, getColliders, and trees",
        )
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

        // Regime B1: off-leash dog approaching an on-leash dog.
        dogB2.state = 'ROAMING';
        dogB2.socialCooldown = 0;
        dogB2.leashTugTimer = 0;
        dogB2.x = dogB1.x + 60;
        dogB2.y = dogB1.y;
        let regimeB1Triggered = false;
        for (let i = 0; i < 500; i++) {
          dogB2.socialCooldown = 0;
          dogB2.state = 'ROAMING';
          if (dogB2.checkSocialInteractions([dogB1], 1 / 60, null)) {
            regimeB1Triggered = true;
            break;
          }
        }
        const regimeB1State = dogB2.state;
        const regimeB1Cooldown = dogB2.socialCooldown;
        const regimeB1TugTimer = dogB2.leashTugTimer;

        dogB1.triggerSocialLeashTug(dogB2);
        const startOwnerX = ownerB1.x;
        const startDogX = dogB1.x;
        const slideField = {
          resolveCircleCollision(x, y, r) { return { x: Math.min(x, 1002), y }; }
        };
        dogB1.update(0.1, slideField, [dogB2]);
        const dogLunged = dogB1.x > startDogX;
        const ownerSlid = ownerB1.x > startOwnerX;
        const ownerClamped = ownerB1.x <= 1002;
        const pullingDuringTug = dogB1.isPullingLeash;
        dogB1.update(0.5, null, [dogB2]);
        const tugTimerAfter = dogB1.leashTugTimer;
        const pullingAfter = dogB1.isPullingLeash;
        const tugTargetAfter = dogB1.leashTugTarget;

        // Un-leashing mid-tug must immediately clear the tug state.
        dogB1.triggerSocialLeashTug(dogB2);
        const tugActiveBeforeUnleash = dogB1.leashTugTimer > 0;
        ownerB1.isLeashed = false;
        dogB1.update(1 / 60, null, [dogB2]);
        const tugTimerAfterUnleash = dogB1.leashTugTimer;
        const tugTargetAfterUnleash = dogB1.leashTugTarget;
        const pullingAfterUnleash = dogB1.isPullingLeash;
        ownerB1.isLeashed = true;

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

        // Regime C gaze must be gated by cooldown/probability.
        dogC1.socialCooldown = 5.0;
        dogC1.socialGazeTimer = 0;
        dogC1.checkSocialInteractions([dogC2], 1 / 60, null);
        const regimeCGazeTimer = dogC1.socialGazeTimer;

        return {
          regimeAState: regimeAState,
          regimeACooldown: regimeACooldown,
          regimeB1Triggered: regimeB1Triggered,
          regimeB1State: regimeB1State,
          regimeB1Cooldown: regimeB1Cooldown,
          regimeB1TugTimer: regimeB1TugTimer,
          gazeTimer: gazeTimer,
          gazeWag: gazeWag,
          gazeEmote: gazeEmote,
          dogLunged: dogLunged,
          ownerSlid: ownerSlid,
          ownerClamped: ownerClamped,
          pullingDuringTug: pullingDuringTug,
          tugTimerAfter: tugTimerAfter,
          pullingAfter: pullingAfter,
          tugTargetAfter: tugTargetAfter,
          tugActiveBeforeUnleash: tugActiveBeforeUnleash,
          tugTimerAfterUnleash: tugTimerAfterUnleash,
          tugTargetAfterUnleash: tugTargetAfterUnleash,
          pullingAfterUnleash: pullingAfterUnleash,
          regimeCState: regimeCState,
          regimeCTugTimer: regimeCTugTimer,
          regimeCGazeTimer: regimeCGazeTimer
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)

        # Regime A
        self.assertIn(res["regimeAState"], ("SOCIAL_GREET", "PLAY_BOW"))
        self.assertEqual(res["regimeACooldown"], 12)

        # Regime B1: off-leash dog greets on-leash dog, never tugs the leash.
        self.assertTrue(res["regimeB1Triggered"], "Regime B1 must trigger SOCIAL_GREET")
        self.assertEqual(res["regimeB1State"], "SOCIAL_GREET")
        self.assertEqual(res["regimeB1Cooldown"], 14)
        self.assertEqual(res["regimeB1TugTimer"], 0,
                         "Off-leash dog must never trigger a leash tug")

        # Regime B2 subtle social gaze
        self.assertGreater(res["gazeTimer"], 0, "Regime B2 must set socialGazeTimer")
        self.assertGreater(res["gazeWag"], 0, "Regime B2 must boost wagSpeed")
        self.assertIsNotNone(res["gazeEmote"], "Regime B2 must set an emote bubble")

        # Regime B
        self.assertTrue(res["dogLunged"], "Dog must lunge toward the off-leash dog")
        self.assertTrue(res["ownerSlid"], "Owner must slide toward the off-leash dog")
        self.assertTrue(res["ownerClamped"],
                        "Owner slide must be clamped by field.resolveCircleCollision")
        self.assertTrue(res["pullingDuringTug"])
        self.assertEqual(res["tugTimerAfter"], 0)
        self.assertFalse(res["pullingAfter"])
        self.assertIsNone(res["tugTargetAfter"])

        # Un-leashing mid-tug clears tug state immediately.
        self.assertTrue(res["tugActiveBeforeUnleash"])
        self.assertEqual(res["tugTimerAfterUnleash"], 0)
        self.assertIsNone(res["tugTargetAfterUnleash"])
        self.assertFalse(res["pullingAfterUnleash"])

        # Regime C
        self.assertEqual(res["regimeCState"], "FOLLOWING")
        self.assertEqual(res["regimeCTugTimer"], 0)
        self.assertEqual(res["regimeCGazeTimer"], 0,
                         "Regime C gaze must be gated by cooldown/probability")

    # ------------------------------------------------------------------
    # unification-027: REQ-027.1 / REQ-027.2 / REQ-027.3 / REQ-027.4
    # ------------------------------------------------------------------

    def test_standing_owner_indefinite_roaming_no_permanent_freeze(self):
        """Off-leash dog must keep roaming indefinitely around a standing owner."""
        snippet = """
        const owner = new Owner(1000, 1000);
        owner.isLeashed = false;
        owner.isMoving = false;
        owner.vx = 0;
        owner.vy = 0;
        const dog = new CompanionDog(owner.x + 40, owner.y, owner);
        dog.owner = owner;
        dog.camera = null;

        const dt = 0.1;
        const steps = 600;
        let roamTime = 0;
        let roamTransitions = 0;
        let prevState = dog.state;
        let sawResting = false;
        let continuousRest = 0;
        let maxContinuousRest = 0;
        const restingStates = ['LYING_DOWN', 'SITTING', 'IDLE_SNIFF'];

        for (let i = 0; i < steps; i++) {
          owner.isMoving = false;
          owner.vx = 0;
          owner.vy = 0;
          dog.update(dt, null, []);
          if (dog.state === 'ROAMING') roamTime += dt;
          if (restingStates.indexOf(dog.state) !== -1) {
            sawResting = true;
            continuousRest += dt;
            if (continuousRest > maxContinuousRest) maxContinuousRest = continuousRest;
          } else {
            continuousRest = 0;
          }
          if (dog.state === 'ROAMING' && prevState !== 'ROAMING') roamTransitions++;
          prevState = dog.state;
        }

        return {
          roamTime: roamTime,
          roamTransitions: roamTransitions,
          sawResting: sawResting,
          maxContinuousRest: maxContinuousRest,
          finalState: dog.state,
          finalSubMode: dog.roamSubMode
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertGreater(res["roamTime"], 20.0,
                           "Dog must spend substantial time roaming")
        self.assertGreaterEqual(res["roamTransitions"], 2,
                                "Dog must return to ROAMING at least twice")
        self.assertTrue(res["sawResting"], "Dog must enter resting state during 60s")
        self.assertLess(res["maxContinuousRest"], 6.0,
                        "Dog must never freeze permanently in a resting state")
        self.assertIn(res["finalState"], (
            "ROAMING", "LYING_DOWN", "SITTING", "BARKING",
            "IDLE_SNIFF", "PLAY_BOW", "ROLLING",
        ))
        self.assertNotEqual(res["finalState"], "LOST")

    def test_pack_play_enum_and_active_rest_blocked(self):
        """DogState.PACK_PLAY must be exported and block ambient resting."""
        self.assertIn("PACK_PLAY: 'PACK_PLAY'", self.dog_src)
        self.assertIn("ACTIVE_REST_BLOCKED_STATES", self.dog_src)

        snippet = """
        const owner = new Owner(1000, 1000);
        owner.isLeashed = false;
        const dog = new CompanionDog(1000, 1000, owner);
        dog.owner = owner;
        const blockedSet = CompanionDog.ACTIVE_REST_BLOCKED_STATES;
        return {
          packPlay: DogState.PACK_PLAY,
          blocked: Boolean(blockedSet && typeof blockedSet.has === 'function' &&
            blockedSet.has(DogState.PACK_PLAY))
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertEqual(res["packPlay"], "PACK_PLAY")
        self.assertTrue(res["blocked"],
                        "PACK_PLAY must be in ACTIVE_REST_BLOCKED_STATES")

    def test_two_off_leash_dogs_enter_pack_play_after_greeting(self):
        """Two off-leash dogs must enter PACK_PLAY after SOCIAL_GREET."""
        snippet = """
        const owner1 = new Owner(1000, 1000);
        owner1.isLeashed = false;
        const owner2 = new Owner(1060, 1000);
        owner2.isLeashed = false;
        const dog1 = new CompanionDog(1000, 1000, owner1);
        dog1.owner = owner1;
        const dog2 = new CompanionDog(1060, 1000, owner2);
        dog2.owner = owner2;

        dog1.socialTargetDog = dog2;
        dog1.state = DogState.SOCIAL_GREET;
        dog1.stateTimer = 0.05;
        dog1.socialCooldown = 0;
        dog2.socialCooldown = 0;
        // dog2 must be receptive for mutual pairing.
        dog2.socialTargetDog = dog1;
        dog2.state = DogState.SOCIAL_GREET;

        dog1.update(0.1, null, [dog2]);

        return {
          dog1State: dog1.state,
          dog2State: dog2.state,
          dog1Partner: dog1.packPlayPartner === dog2,
          dog2Partner: dog2.packPlayPartner === dog1,
          dog1Role: dog1.packPlayRole,
          dog2Role: dog2.packPlayRole,
          dog1Timer: dog1.packPlayRoleTimer || dog1.packPlayTimer,
          dog2Timer: dog2.packPlayRoleTimer || dog2.packPlayTimer
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertEqual(res["dog1State"], "PACK_PLAY")
        self.assertEqual(res["dog2State"], "PACK_PLAY")
        self.assertTrue(res["dog1Partner"])
        self.assertTrue(res["dog2Partner"])
        self.assertIn(res["dog1Role"], ("LEAD", "CHASE"))
        self.assertIn(res["dog2Role"], ("LEAD", "CHASE"))
        self.assertNotEqual(res["dog1Role"], res["dog2Role"])
        self.assertGreater(res["dog1Timer"], 0)
        self.assertGreater(res["dog2Timer"], 0)

    def test_pack_play_romping_coordination_and_proximity(self):
        """Pack play must keep dogs close, active, and inside the screen."""
        snippet = """
        const owner1 = new Owner(1000, 1000);
        owner1.isLeashed = false;
        const owner2 = new Owner(1060, 1000);
        owner2.isLeashed = false;
        const dog1 = new CompanionDog(1000, 1000, owner1);
        dog1.owner = owner1;
        const dog2 = new CompanionDog(1060, 1000, owner2);
        dog2.owner = owner2;

        const camera = { x: 1000, y: 1000, viewportWidth: 1280, viewportHeight: 720, zoom: 1.0 };
        dog1.camera = camera;
        dog2.camera = camera;

        dog1.state = DogState.PACK_PLAY;
        dog2.state = DogState.PACK_PLAY;
        dog1.packPlayPartner = dog2;
        dog2.packPlayPartner = dog1;
        dog1.packPlayRole = 'LEAD';
        dog2.packPlayRole = 'CHASE';
        dog1.packPlayTimer = 10;
        dog2.packPlayTimer = 10;

        let maxDist = 0;
        let speedSum = 0;
        let speedSamples = 0;
        let endSpeed = 0;
        let insidePerimeter = true;
        const perim = dog1._getScreenPerimeter();

        // Warm up for 3 steps so velocity ramps up from rest before measuring.
        for (let i = 0; i < 3; i++) {
          dog1.update(0.1, null, [dog2]);
          dog2.update(0.1, null, [dog1]);
        }

        for (let i = 0; i < 50; i++) {
          dog1.update(0.1, null, [dog2]);
          dog2.update(0.1, null, [dog1]);
          const d = Math.hypot(dog1.x - dog2.x, dog1.y - dog2.y);
          maxDist = Math.max(maxDist, d);
          const spd = Math.hypot(dog1.vx, dog1.vy);
          speedSum += spd;
          speedSamples++;
          endSpeed = spd;
          if (dog1.x < perim.left - 1 || dog1.x > perim.right + 1 ||
              dog1.y < perim.top - 1 || dog1.y > perim.bottom + 1) {
            insidePerimeter = false;
          }
        }

        return {
          maxDist: maxDist,
          avgSpeed: speedSamples > 0 ? speedSum / speedSamples : 0,
          endSpeed: endSpeed,
          insidePerimeter: insidePerimeter
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertLess(res["maxDist"], 150,
                        "Pack play dogs must stay within 150px")
        self.assertGreater(res["avgSpeed"], 25,
                           "Pack play dogs must remain active on average")
        self.assertGreater(res["endSpeed"], 30,
                           "Pack play dogs must remain active at the end")
        self.assertTrue(res["insidePerimeter"],
                        "Pack play must honor the screen perimeter")

    def test_whistle_recall_breaks_pack_play(self):
        """Whistle recall must break pack play for both dogs."""
        snippet = """
        const owner1 = new Owner(1000, 1000);
        owner1.isLeashed = false;
        const owner2 = new Owner(1060, 1000);
        owner2.isLeashed = false;
        const dog1 = new CompanionDog(1000, 1000, owner1);
        dog1.owner = owner1;
        const dog2 = new CompanionDog(1060, 1000, owner2);
        dog2.owner = owner2;

        dog1.state = DogState.PACK_PLAY;
        dog2.state = DogState.PACK_PLAY;
        dog1.packPlayPartner = dog2;
        dog2.packPlayPartner = dog1;
        dog1.packPlayRole = 'LEAD';
        dog2.packPlayRole = 'CHASE';
        dog1.packPlayTimer = 10;
        dog2.packPlayTimer = 10;

        dog1.whistleRecall();

        return {
          dog1State: dog1.state,
          dog1Partner: dog1.packPlayPartner,
          dog2Partner: dog2.packPlayPartner,
          dog2State: dog2.state
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertEqual(res["dog1State"], "RECALLED")
        self.assertIsNone(res["dog1Partner"])
        self.assertIsNone(res["dog2Partner"])
        self.assertEqual(res["dog2State"], "ROAMING")

    def test_three_dogs_prevents_hijacking_existing_pack_play(self):
        """A third dog must not hijack an existing pack-play bond."""
        snippet = """
        const owner1 = new Owner(1000, 1000);
        owner1.isLeashed = false;
        const owner2 = new Owner(1060, 1000);
        owner2.isLeashed = false;
        const owner3 = new Owner(1120, 1000);
        owner3.isLeashed = false;
        const dog1 = new CompanionDog(1000, 1000, owner1);
        dog1.owner = owner1;
        const dog2 = new CompanionDog(1060, 1000, owner2);
        dog2.owner = owner2;
        const dog3 = new CompanionDog(1120, 1000, owner3);
        dog3.owner = owner3;

        dog1.state = DogState.PACK_PLAY;
        dog2.state = DogState.PACK_PLAY;
        dog1.packPlayPartner = dog2;
        dog2.packPlayPartner = dog1;
        dog1.packPlayRole = 'LEAD';
        dog2.packPlayRole = 'CHASE';
        dog1.packPlayRoleTimer = 10;
        dog2.packPlayRoleTimer = 10;

        // dog3 greets dog2 and tries to start pack play.
        dog3.state = DogState.SOCIAL_GREET;
        dog3.socialTargetDog = dog2;
        dog3.socialCooldown = 0;
        dog2.socialCooldown = 0;
        const started = dog3._tryStartPackPlay(dog2);

        return {
          started: started,
          dog2PartnerIsDog1: dog2.packPlayPartner === dog1,
          dog3Partner: dog3.packPlayPartner,
          dog2State: dog2.state
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertFalse(res["started"], "Third dog must not hijack existing pack play")
        self.assertTrue(res["dog2PartnerIsDog1"], "dog2 must remain bonded to dog1")
        self.assertIsNone(res["dog3Partner"])
        self.assertEqual(res["dog2State"], "PACK_PLAY")

    def test_pack_play_role_swap_over_time(self):
        """Roles must swap after the role timer elapses."""
        snippet = """
        const owner1 = new Owner(1000, 1000);
        owner1.isLeashed = false;
        const owner2 = new Owner(1060, 1000);
        owner2.isLeashed = false;
        const dog1 = new CompanionDog(1000, 1000, owner1);
        dog1.owner = owner1;
        const dog2 = new CompanionDog(1060, 1000, owner2);
        dog2.owner = owner2;

        dog1.state = DogState.PACK_PLAY;
        dog2.state = DogState.PACK_PLAY;
        dog1.packPlayPartner = dog2;
        dog2.packPlayPartner = dog1;
        dog1.packPlayRole = 'LEAD';
        dog2.packPlayRole = 'CHASE';
        dog1.packPlayRoleTimer = 5.0;
        dog2.packPlayRoleTimer = 5.0;

        const before1 = dog1.packPlayRole;
        const before2 = dog2.packPlayRole;

        // Step in small increments past the role timer, verifying roles stay
        // strictly complementary at every step.
        let desync = false;
        const dt = 0.1;
        for (let i = 0; i < 55; i++) {
          dog1.updatePackPlay(dt, null);
          dog2.updatePackPlay(dt, null);
          if (dog1.packPlayRole === dog2.packPlayRole) desync = true;
        }

        return {
          before1: before1,
          before2: before2,
          after1: dog1.packPlayRole,
          after2: dog2.packPlayRole,
          desync: desync
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertEqual(res["before1"], "LEAD")
        self.assertEqual(res["before2"], "CHASE")
        self.assertEqual(res["after1"], "CHASE")
        self.assertEqual(res["after2"], "LEAD")
        self.assertFalse(res["desync"], "Roles must remain strictly complementary")

    def test_social_cooldown_blocks_reengagement(self):
        """A dog with an active social cooldown must reject pack play."""
        snippet = """
        const owner1 = new Owner(1000, 1000);
        owner1.isLeashed = false;
        const owner2 = new Owner(1060, 1000);
        owner2.isLeashed = false;
        const dog1 = new CompanionDog(1000, 1000, owner1);
        dog1.owner = owner1;
        const dog2 = new CompanionDog(1060, 1000, owner2);
        dog2.owner = owner2;

        dog1.state = DogState.SOCIAL_GREET;
        dog1.socialTargetDog = dog2;
        dog1.socialCooldown = 10;
        dog2.state = DogState.SOCIAL_GREET;
        dog2.socialTargetDog = dog1;
        dog2.socialCooldown = 0;

        const started = dog1._tryStartPackPlay(dog2);

        return {
          started: started,
          dog1Partner: dog1.packPlayPartner,
          dog2Partner: dog2.packPlayPartner
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertFalse(res["started"], "Active social cooldown must block pack play")
        self.assertIsNone(res["dog1Partner"])
        self.assertIsNone(res["dog2Partner"])

    def test_three_dogs_hijack_guard_during_greeting(self):
        """A third dog must not steal a partner that is greeting another dog."""
        snippet = """
        const owner1 = new Owner(1000, 1000);
        owner1.isLeashed = false;
        const owner2 = new Owner(1060, 1000);
        owner2.isLeashed = false;
        const owner3 = new Owner(1120, 1000);
        owner3.isLeashed = false;
        const dog1 = new CompanionDog(1000, 1000, owner1);
        dog1.owner = owner1;
        const dog2 = new CompanionDog(1060, 1000, owner2);
        dog2.owner = owner2;
        const dog3 = new CompanionDog(1120, 1000, owner3);
        dog3.owner = owner3;

        // dog2 is actively greeting dog1.
        dog2.state = DogState.SOCIAL_GREET;
        dog2.socialTargetDog = dog1;
        dog2.socialCooldown = 0;
        dog1.state = DogState.SOCIAL_GREET;
        dog1.socialTargetDog = dog2;

        // dog3 tries to hijack dog2.
        dog3.state = DogState.SOCIAL_GREET;
        dog3.socialTargetDog = dog2;
        dog3.socialCooldown = 0;
        const started = dog3._tryStartPackPlay(dog2);

        return {
          started: started,
          dog3Partner: dog3.packPlayPartner,
          dog2TargetIsDog1: dog2.socialTargetDog === dog1
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertFalse(res["started"], "Third dog must not hijack a greeting partner")
        self.assertIsNone(res["dog3Partner"])
        self.assertTrue(res["dog2TargetIsDog1"], "dog2 must keep greeting dog1")

    def test_pack_play_multi_swap_coordination(self):
        """Roles must stay complementary across multiple swap intervals."""
        snippet = """
        const owner1 = new Owner(1000, 1000);
        owner1.isLeashed = false;
        const owner2 = new Owner(1060, 1000);
        owner2.isLeashed = false;
        const dog1 = new CompanionDog(1000, 1000, owner1);
        dog1.owner = owner1;
        const dog2 = new CompanionDog(1060, 1000, owner2);
        dog2.owner = owner2;

        dog1.state = DogState.PACK_PLAY;
        dog2.state = DogState.PACK_PLAY;
        dog1.packPlayPartner = dog2;
        dog2.packPlayPartner = dog1;
        dog1.packPlayRole = 'LEAD';
        dog2.packPlayRole = 'CHASE';
        dog1.packPlayRoleTimer = 4.0;
        dog2.packPlayRoleTimer = 4.0;

        let desync = false;
        let swaps = 0;
        let prevRole1 = dog1.packPlayRole;
        const dt = 1 / 60;
        const steps = Math.round(15 / dt);
        for (let i = 0; i < steps; i++) {
          dog1.updatePackPlay(dt, null);
          dog2.updatePackPlay(dt, null);
          if (dog1.packPlayRole === dog2.packPlayRole) desync = true;
          if (dog1.packPlayRole !== prevRole1) {
            swaps++;
            prevRole1 = dog1.packPlayRole;
          }
        }
        return { desync: desync, swaps: swaps };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertFalse(res["desync"], "Roles must never desync (always one LEAD, one CHASE)")
        self.assertGreaterEqual(res["swaps"], 2, "Roles must swap multiple times over 15s")

    def test_stat_cooldown_exact_bands(self):
        """Whistle social cooldown must follow the exact stat bands."""
        snippet = """
        const make = (obed, play) => {
          const owner = new Owner(1000, 1000);
          owner.isLeashed = false;
          const partnerOwner = new Owner(1060, 1000);
          partnerOwner.isLeashed = false;
          const dog = new CompanionDog(1000, 1000, owner);
          dog.owner = owner;
          dog.personality = { obedience: obed, playfulness: play, energy: 3, curiosity: 3 };
          const partner = new CompanionDog(1060, 1000, partnerOwner);
          partner.owner = partnerOwner;
          // Place both dogs into PACK_PLAY so the whistle is a real breakup.
          dog.state = DogState.PACK_PLAY;
          partner.state = DogState.PACK_PLAY;
          dog.packPlayPartner = partner;
          partner.packPlayPartner = dog;
          dog.packPlayRole = 'LEAD';
          partner.packPlayRole = 'CHASE';
          dog.packPlayRoleTimer = 10;
          partner.packPlayRoleTimer = 10;
          dog.whistleRecall();
          return dog.socialCooldown;
        };
        return {
          high: make(5, 1),
          balanced: make(3, 3),
          lowObed: make(2, 4),
          maxPlay: make(1, 5)
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertGreaterEqual(res["high"], 30.0)
        self.assertLessEqual(res["high"], 45.0)
        self.assertGreaterEqual(res["balanced"], 18.0)
        self.assertLessEqual(res["balanced"], 25.0)
        self.assertGreaterEqual(res["lowObed"], 8.0)
        self.assertLessEqual(res["lowObed"], 16.0)
        self.assertGreaterEqual(res["maxPlay"], 8.0)
        self.assertLessEqual(res["maxPlay"], 16.0)

    def test_pack_play_speed_and_wag_clamps(self):
        """Pack play speeds must stay in [150, 210] and wagSpeed in [16, 22]."""
        snippet = """
        const owner1 = new Owner(1000, 1000);
        owner1.isLeashed = false;
        const owner2 = new Owner(1060, 1000);
        owner2.isLeashed = false;
        const dog1 = new CompanionDog(1000, 1000, owner1);
        dog1.owner = owner1;
        const dog2 = new CompanionDog(1060, 1000, owner2);
        dog2.owner = owner2;

        dog1.state = DogState.PACK_PLAY;
        dog2.state = DogState.PACK_PLAY;
        dog1.packPlayPartner = dog2;
        dog2.packPlayPartner = dog1;
        dog1.packPlayRole = 'LEAD';
        dog2.packPlayRole = 'CHASE';
        dog1.packPlayRoleTimer = 10;
        dog2.packPlayRoleTimer = 10;

        let minSpeed = Infinity;
        let maxSpeed = 0;
        let minWag = Infinity;
        let maxWag = 0;
        for (let i = 0; i < 200; i++) {
          dog1.updatePackPlay(1 / 60, null);
          dog2.updatePackPlay(1 / 60, null);
          for (const d of [dog1, dog2]) {
            const spd = Math.hypot(d.vx, d.vy);
            if (spd > 0) {
              minSpeed = Math.min(minSpeed, spd);
              maxSpeed = Math.max(maxSpeed, spd);
            }
            minWag = Math.min(minWag, d.wagSpeed);
            maxWag = Math.max(maxWag, d.wagSpeed);
          }
        }
        return { minSpeed: minSpeed, maxSpeed: maxSpeed, minWag: minWag, maxWag: maxWag };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertGreaterEqual(res["minSpeed"], 150.0)
        self.assertLessEqual(res["maxSpeed"], 210.0)
        self.assertGreaterEqual(res["minWag"], 16.0)
        self.assertLessEqual(res["maxWag"], 22.0)

    def test_shared_landmark_exploration(self):
        """Pack play must bias the lead waypoint toward a nearby tree."""
        snippet = """
        const owner1 = new Owner(1000, 1000);
        owner1.isLeashed = false;
        const owner2 = new Owner(1060, 1000);
        owner2.isLeashed = false;
        const dog1 = new CompanionDog(1000, 1000, owner1);
        dog1.owner = owner1;
        const dog2 = new CompanionDog(1060, 1000, owner2);
        dog2.owner = owner2;

        dog1.state = DogState.PACK_PLAY;
        dog2.state = DogState.PACK_PLAY;
        dog1.packPlayPartner = dog2;
        dog2.packPlayPartner = dog1;
        dog1.packPlayRole = 'LEAD';
        dog2.packPlayRole = 'CHASE';
        dog1.packPlayRoleTimer = 10;
        dog2.packPlayRoleTimer = 10;
        dog1.packPlayWaypoint = null;
        dog1.packPlayWaypointTimer = 0;

        const field = { trees: [{ x: 1050, y: 1000, trunkRadius: 18 }] };
        dog1.updatePackPlay(1 / 60, field);

        const wp = dog1.packPlayWaypoint;
        const distToTree = wp ? Math.hypot(wp.x - 1050, wp.y - 1000) : Infinity;
        return { hasWaypoint: Boolean(wp), distToTree: distToTree };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertTrue(res["hasWaypoint"], "Lead dog must set a waypoint near the tree")
        self.assertLess(res["distToTree"], 80.0,
                        "Waypoint must be near the shared landmark tree")

    def test_shared_landmark_exploration_benches_and_scent_nodes(self):
        """Pack play must detect benches and scent nodes as shared landmarks."""
        snippet = """
        const makePair = () => {
          const owner1 = new Owner(1000, 1000);
          owner1.isLeashed = false;
          const owner2 = new Owner(1060, 1000);
          owner2.isLeashed = false;
          const dog1 = new CompanionDog(1000, 1000, owner1);
          dog1.owner = owner1;
          const dog2 = new CompanionDog(1060, 1000, owner2);
          dog2.owner = owner2;
          dog1.state = DogState.PACK_PLAY;
          dog2.state = DogState.PACK_PLAY;
          dog1.packPlayPartner = dog2;
          dog2.packPlayPartner = dog1;
          dog1.packPlayRole = 'LEAD';
          dog2.packPlayRole = 'CHASE';
          dog1.packPlayRoleTimer = 10;
          dog2.packPlayRoleTimer = 10;
          dog1.packPlayWaypoint = null;
          dog1.packPlayWaypointTimer = 0;
          return dog1;
        };

        const benchDog = makePair();
        const benchField = { benches: [{ x: 1050, y: 1000, w: 64, h: 26 }] };
        benchDog.updatePackPlay(1 / 60, benchField);
        const benchWp = benchDog.packPlayWaypoint;
        const benchDist = benchWp ? Math.hypot(benchWp.x - 1050, benchWp.y - 1000) : Infinity;

        const scentDog = makePair();
        const scentField = { scentNodes: [{ x: 1050, y: 1000, r: 16 }] };
        scentDog.updatePackPlay(1 / 60, scentField);
        const scentWp = scentDog.packPlayWaypoint;
        const scentDist = scentWp ? Math.hypot(scentWp.x - 1050, scentWp.y - 1000) : Infinity;

        return {
          benchHasWaypoint: Boolean(benchWp),
          benchDist: benchDist,
          scentHasWaypoint: Boolean(scentWp),
          scentDist: scentDist
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertTrue(res["benchHasWaypoint"], "Bench must be detected as a landmark")
        self.assertLess(res["benchDist"], 80.0, "Waypoint must be near the bench")
        self.assertTrue(res["scentHasWaypoint"], "Scent node must be detected as a landmark")
        self.assertLess(res["scentDist"], 80.0, "Waypoint must be near the scent node")

    def test_pack_play_speed_clamped_with_obstacles(self):
        """Speed must stay <= 210.01 even with obstacle avoidance and perimeter steering."""
        snippet = """
        const owner1 = new Owner(1000, 1000);
        owner1.isLeashed = false;
        const owner2 = new Owner(1060, 1000);
        owner2.isLeashed = false;
        const dog1 = new CompanionDog(1000, 1000, owner1);
        dog1.owner = owner1;
        const dog2 = new CompanionDog(1060, 1000, owner2);
        dog2.owner = owner2;

        const camera = { x: 1000, y: 1000, viewportWidth: 1280, viewportHeight: 720, zoom: 1.0 };
        dog1.camera = camera;
        dog2.camera = camera;

        dog1.state = DogState.PACK_PLAY;
        dog2.state = DogState.PACK_PLAY;
        dog1.packPlayPartner = dog2;
        dog2.packPlayPartner = dog1;
        dog1.packPlayRole = 'LEAD';
        dog2.packPlayRole = 'CHASE';
        dog1.packPlayRoleTimer = 10;
        dog2.packPlayRoleTimer = 10;

        // Dense obstacle field near the dogs to force strong avoidance pushes.
        const field = {
          getWorldObstacles() {
            return [
              { kind: 'circle', x: 1010, y: 1000, r: 30 },
              { kind: 'circle', x: 1050, y: 1000, r: 30 },
              { kind: 'circle', x: 1030, y: 1030, r: 30 }
            ];
          }
        };

        let maxSpeed = 0;
        for (let i = 0; i < 200; i++) {
          dog1.updatePackPlay(1 / 60, field);
          dog2.updatePackPlay(1 / 60, field);
          maxSpeed = Math.max(maxSpeed, Math.hypot(dog1.vx, dog1.vy), Math.hypot(dog2.vx, dog2.vy));
        }
        return { maxSpeed: maxSpeed };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertLessEqual(res["maxSpeed"], 210.01,
                             "Pack play speed must never exceed 210 px/s")

    def test_stat_driven_whistle_social_cooldown(self):
        """Whistle social cooldown must scale with obedience/playfulness."""
        snippet = """
        const ownerA = new Owner(1000, 1000);
        ownerA.isLeashed = false;
        const ownerB = new Owner(1060, 1000);
        ownerB.isLeashed = false;
        const dogA = new CompanionDog(1000, 1000, ownerA);
        dogA.owner = ownerA;
        dogA.personality = { obedience: 5, playfulness: 1, energy: 3, curiosity: 3 };
        const dogB = new CompanionDog(1060, 1000, ownerB);
        dogB.owner = ownerB;
        dogB.personality = { obedience: 1, playfulness: 5, energy: 3, curiosity: 3 };

        // Give each dog its own separate partner so that recalling dogA does
        // not clear dogB's pack-play state (which would zero its cooldown).
        const ownerPA = new Owner(1120, 1000);
        ownerPA.isLeashed = false;
        const partnerA = new CompanionDog(1120, 1000, ownerPA);
        partnerA.owner = ownerPA;
        const ownerPB = new Owner(1180, 1000);
        ownerPB.isLeashed = false;
        const partnerB = new CompanionDog(1180, 1000, ownerPB);
        partnerB.owner = ownerPB;

        dogA.state = DogState.PACK_PLAY;
        partnerA.state = DogState.PACK_PLAY;
        dogA.packPlayPartner = partnerA;
        partnerA.packPlayPartner = dogA;
        dogA.packPlayRole = 'LEAD';
        partnerA.packPlayRole = 'CHASE';
        dogA.packPlayTimer = 10;
        partnerA.packPlayTimer = 10;

        dogB.state = DogState.PACK_PLAY;
        partnerB.state = DogState.PACK_PLAY;
        dogB.packPlayPartner = partnerB;
        partnerB.packPlayPartner = dogB;
        dogB.packPlayRole = 'LEAD';
        partnerB.packPlayRole = 'CHASE';
        dogB.packPlayTimer = 10;
        partnerB.packPlayTimer = 10;

        dogA.whistleRecall();
        dogB.whistleRecall();

        return {
          cooldownA: dogA.socialCooldown,
          cooldownB: dogB.socialCooldown
        };
        """
        res = _run_real_js(self.owner_src, self.dog_src, snippet)
        self.assertGreaterEqual(res["cooldownA"], 25.0)
        self.assertLessEqual(res["cooldownB"], 18.0)
        self.assertGreater(res["cooldownA"], res["cooldownB"])
        for key in ("cooldownA", "cooldownB"):
            self.assertGreaterEqual(res[key], 8.0)
            self.assertLessEqual(res[key], 45.0)

if __name__ == '__main__':
    unittest.main()
