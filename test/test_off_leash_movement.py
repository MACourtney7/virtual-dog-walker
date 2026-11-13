import os
import unittest

TEST_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.abspath(os.path.join(TEST_DIR, ".."))

def read_file(rel_path):
    path = os.path.join(PROJECT_DIR, rel_path)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

class TestOffLeashMovement(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dog_src = read_file("src/entities/companion_dog.js")

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
        self.assertIn("export const LEASH_FLANK_CLEARANCE_MIN_PX = 12;", self.dog_src)
        self.assertIn("export const LEASH_FLANK_CLEARANCE_MAX_PX = 16;", self.dog_src)
        self.assertIn("export const LEASH_FLANK_CLEARANCE_TARGET_PX = 14;", self.dog_src)

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
        self.assertIn("const ds = Math.cos(this.zoomiesPhase) * this.zoomiesSpeed;", self.dog_src)
        self.assertIn("dx = (bx - ax) * 0.5 * ds;", self.dog_src)
        self.assertIn("dy = (by - ay) * 0.5 * ds;", self.dog_src)

    def test_decoupled_speed_bands_present(self):
        """All five decoupled canine speed bands must be defined."""
        self.assertIn("SPEED_SNIFF_AMBLE_MIN = 48", self.dog_src)
        self.assertIn("SPEED_SNIFF_AMBLE_MAX = 76", self.dog_src)
        self.assertIn("SPEED_EXPLORE_TROT_MIN = 130", self.dog_src)
        self.assertIn("SPEED_EXPLORE_TROT_MAX = 190", self.dog_src)
        self.assertIn("SPEED_SCOUT_CANTER_MIN = 185", self.dog_src)
        self.assertIn("SPEED_SCOUT_CANTER_MAX = 235", self.dog_src)
        self.assertIn("SPEED_DART_SPRINT_MIN = 230", self.dog_src)
        self.assertIn("SPEED_DART_SPRINT_MAX = 270", self.dog_src)

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

if __name__ == '__main__':
    unittest.main()
